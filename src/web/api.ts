/**
 * Read-only JSON API behind the UI. Nothing here changes review state: every
 * confirmation still goes through a tool call and `ctx.approval` in the
 * conversation, so the UI cannot become a way around the user's approval.
 */
import { qualityReport } from '../core/quality.js'
import type { OntologySchema } from '../core/schema.js'
import type { ObjectRecord, Status, Store } from '../core/store.js'
import { diffSchemas } from '../dsh/tools.js'

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

const STATUSES: readonly Status[] = ['candidate', 'confirmed', 'rejected']
const GRAPH_LIMIT = 2000

function statuses(value: string | null): Status[] {
  const list = (value ?? 'candidate,confirmed').split(',').filter((s): s is Status => STATUSES.includes(s as Status))
  return list.length ? list : ['candidate', 'confirmed']
}

function required(params: URLSearchParams, name: string): string {
  const value = params.get(name)
  if (!value) throw new ApiError(400, `Missing query parameter "${name}".`)
  return value
}

/** Answer one API request. `endpoint` is the path below `/api/`. */
export function handleApi(store: Store, endpoint: string, params: URLSearchParams): unknown {
  if (endpoint === 'projects') return store.listProjects()
  let project
  try {
    project = store.project(required(params, 'project'))
  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError(404, (error as Error).message)
  }
  const id = project.id
  const published = () => {
    const version = store.published(id)
    if (!version) throw new ApiError(409, 'No published schema yet.')
    return version
  }

  switch (endpoint) {
    // Cheap change marker the UI polls to refresh while the conversation builds.
    case 'seq': return { seq: store.auditLog(id, 1)[0]?.seq ?? 0 }
    case 'overview': {
      const all = store.objects(id, { status: [...STATUSES] })
      const links = store.links(id, { status: [...STATUSES] })
      const count = (items: Array<{ status: Status }>) => Object.fromEntries(STATUSES.map(s => [s, items.filter(i => i.status === s).length]))
      return {
        project,
        versions: store.schemaVersions(id).map(v => ({ version: v.version, note: v.note, hash: v.hash, createdAt: v.createdAt })),
        objects: count(all),
        links: count(links),
        materials: store.listMaterials(id).length,
        snapshot: store.latestSnapshot(id) ?? null
      }
    }
    case 'schema': {
      const version = params.get('version') ?? 'draft'
      if (version === 'draft') return { version: 'draft', schema: store.draft(id) }
      const found = store.schemaVersions(id).find(v => String(v.version) === version)
      if (!found) throw new ApiError(404, `Schema version ${version} not found.`)
      return { version: found.version, schema: found.schema }
    }
    case 'diff': {
      // from/to: a version number or "draft"; from may be empty (diff against nothing).
      const pick = (v: string | null): OntologySchema | undefined => {
        if (!v) return undefined
        if (v === 'draft') return store.draft(id)
        const found = store.schemaVersions(id).find(x => String(x.version) === v)
        if (!found) throw new ApiError(404, `Schema version ${v} not found.`)
        return found.schema
      }
      const to = pick(params.get('to') ?? 'draft')!
      return diffSchemas(pick(params.get('from')), to)
    }
    case 'graph': {
      const wanted = statuses(params.get('status'))
      const type = params.get('type') || undefined
      const objects = store.objects(id, { type, status: wanted }).slice(0, GRAPH_LIMIT)
      const ids = new Set(objects.map(o => o.id))
      const links = store.links(id, { status: wanted }).filter(l => ids.has(l.fromId) && ids.has(l.toId))
      return { objects, links, truncated: objects.length === GRAPH_LIMIT }
    }
    case 'neighbors': {
      const target = required(params, 'id')
      const wanted = statuses(params.get('status'))
      const links = store.links(id, { status: wanted }).filter(l => l.fromId === target || l.toId === target)
      const ids = new Set([target, ...links.flatMap(l => [l.fromId, l.toId])])
      return { objects: store.objects(id, { status: wanted }).filter(o => ids.has(o.id)), links }
    }
    case 'search': {
      const text = (params.get('q') ?? '').toLowerCase()
      const matches = (o: ObjectRecord) => o.key.toLowerCase().includes(text) || JSON.stringify(o.properties).toLowerCase().includes(text)
      return store.objects(id, { type: params.get('type') || undefined, status: statuses(params.get('status')) }).filter(matches).slice(0, 50)
    }
    case 'item': {
      const target = required(params, 'id')
      const record = target.startsWith('obj_')
        ? store.objects(id, { status: [...STATUSES] }).find(o => o.id === target)
        : target.startsWith('cln_')
          ? store.codeLinks(id, { status: [...STATUSES] }).find(c => c.id === target)
          : store.links(id, { status: [...STATUSES] }).find(l => l.id === target)
      if (!record) throw new ApiError(404, `Item ${target} not found.`)
      const code = 'codeRef' in record ? store.codeElement(id, record.codeRef) ?? null : null
      const ends = 'fromId' in record ? [record.fromId, record.toId] : 'objectId' in record ? [record.objectId] : []
      const objects = store.objects(id, { status: [...STATUSES] })
      return {
        record,
        endpoints: ends.map(e => objects.find(o => o.id === e)).filter(Boolean),
        evidence: store.evidence(id, target),
        conflicts: store.conflicts(id, target),
        codeLinks: target.startsWith('obj_') ? store.codeLinks(id, { objectId: target, status: [...STATUSES] }) : [],
        code
      }
    }
    case 'review': {
      const keys = new Map(store.objects(id, { status: [...STATUSES] }).map(o => [o.id, `${o.type}:${o.key}`]))
      const label = (objectId: string) => keys.get(objectId) ?? objectId
      const candidates = [
        ...store.objects(id, { status: ['candidate'] }).map(o => ({ id: o.id, kind: 'object', type: o.type, label: o.key, batchId: o.batchId })),
        ...store.links(id, { status: ['candidate'] }).map(l => ({ id: l.id, kind: 'link', type: l.linkType, label: `${label(l.fromId)} → ${label(l.toId)}`, batchId: l.batchId })),
        ...store.codeLinks(id, { status: ['candidate'] }).map(c => ({ id: c.id, kind: 'code-link', type: c.relation, label: `${label(c.objectId)} → ${c.codeRef}`, batchId: c.batchId }))
      ]
      const preview = store.published(id) ? store.previewConfirm(id, candidates.map(c => c.id)) : null
      const blocked = new Map(preview?.blocked.map(b => [b.id, b.issues]) ?? [])
      return {
        published: Boolean(preview),
        items: candidates.map(c => ({ ...c, issues: blocked.get(c.id) ?? [] })),
        conflicts: store.conflicts(id),
        samples: store.pendingSamples(id),
        rules: store.rules(id)
      }
    }
    case 'materials': return store.listMaterials(id)
    case 'material': {
      const materialId = required(params, 'id')
      let material
      try {
        material = store.material(id, materialId)
      } catch (error) {
        throw new ApiError(404, (error as Error).message)
      }
      return { material, evidence: store.materialEvidence(id, materialId) }
    }
    case 'quality':
      published()
      return qualityReport(store, id)
    case 'audit': return store.auditLog(id, Math.min(Number(params.get('limit')) || 100, 500))
    default: throw new ApiError(404, `Unknown endpoint "${endpoint}".`)
  }
}
