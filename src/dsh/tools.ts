/** DSH tool definitions. Tools that change review state ask the user through `ctx.approval` first. */
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { searchLines } from '../core/evidence.js'
import { toJsonLd, toTurtle } from '../core/export.js'
import { type ObjectSetQuery, runQuery } from '../core/query.js'
import { BASE_TYPES, CARDINALITIES, type OntologySchema } from '../core/schema.js'
import type { Authorization, LinkRecord, ObjectRecord, Status, Store } from '../core/store.js'

/** The parts of a DSH tool execution this plugin uses. */
export interface Exec { agent?: unknown; callId?: string; signal?: AbortSignal }
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
export interface Approval {
  request(req: { agent: unknown; toolName: string; callId?: string; reason?: string; signal?: AbortSignal }): Promise<ApprovalOutcome>
}
export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(args: any, exec: Exec): Promise<unknown>
}
export interface ToolEnv {
  store: () => Store
  approval: Approval
  /** Directory that file paths resolve against and must stay inside. */
  workspace: string
}

const MAX_MATERIAL_BYTES = 5 * 1024 * 1024
const MAX_INLINE_EXPORT = 200_000

const str = (description: string) => ({ type: 'string', description })
const obj = (properties: Record<string, unknown>, required: string[] = [], description?: string) => ({ type: 'object', properties, required, additionalProperties: false, ...(description ? { description } : {}) })
const arr = (items: Record<string, unknown>, description?: string) => ({ type: 'array', items, ...(description ? { description } : {}) })
const project = str('Project id or name.')
const statusList = arr({ type: 'string', enum: ['candidate', 'confirmed', 'rejected'] }, 'Statuses to include.')
const evidenceList = arr(obj({
  materialId: str('Stored material id.'),
  quote: str('Exact text copied from the material. Quotes not found verbatim are rejected.'),
  field: str('Property this quote supports; omit when it supports the whole object or link.'),
  role: { type: 'string', enum: ['specified', 'observed', 'correspondence', 'inferred'], description: 'specified: the text states it; observed: seen in data/code; correspondence: matched across sources; inferred: your conclusion (never auto-confirmed).' }
}, ['materialId', 'quote']), 'At least one quote per item.')
const propertySchema = obj({
  apiName: str('Identifier: letter first, then letters, digits or _.'), displayName: str('Human label.'), description: str('Meaning of the property.'),
  type: { type: 'string', enum: [...BASE_TYPES] }, required: { type: 'boolean' }, enum: arr({ type: 'string' }, 'Allowed values (string properties only).'), pattern: str('Regular expression values must match.')
}, ['apiName', 'type'])
const schemaParam = obj({
  questions: arr(obj({ id: str('Stable id, e.g. q1.'), text: str('A question the ontology must answer.'), priority: { type: 'string', enum: ['must', 'should', 'could'] } }, ['id', 'text', 'priority']), 'Competency questions.'),
  objectTypes: arr(obj({
    apiName: str('PascalCase type name.'), displayName: str('Human label.'), description: str('What one instance is.'),
    primaryKey: str('Property whose value identifies an instance.'), titleProperty: str('Property shown as the label.'),
    properties: arr(propertySchema), questions: arr({ type: 'string' }, 'Ids of questions this type serves.')
  }, ['apiName', 'primaryKey', 'properties'])),
  linkTypes: arr(obj({
    apiName: str('Traversal name from the source side, e.g. employer.'), inverseApiName: str('Traversal name from the target side, e.g. employees.'),
    from: str('Source object type.'), to: str('Target object type.'), cardinality: { type: 'string', enum: [...CARDINALITIES] },
    description: str('Meaning of the link.'), questions: arr({ type: 'string' })
  }, ['apiName', 'inverseApiName', 'from', 'to', 'cardinality']))
}, ['objectTypes'], 'The complete schema draft; it replaces the previous draft.')
const filterParam = { description: 'Filter: {property, op, value} with op in eq|neq|gt|gte|lt|lte|contains|in|exists, or {and:[...]}, {or:[...]}, {not:{...}}.' }

export function createTools(env: ToolEnv): ToolSpec[] {
  const { store } = env

  /** Ask the user. Anything but an explicit one-time grant aborts the change. */
  async function approve(toolName: string, exec: Exec, reason: string): Promise<Authorization> {
    if (!exec.agent) throw new Error('This change needs user approval, but the call has no agent to ask through.')
    const outcome = await env.approval.request({ agent: exec.agent, toolName, callId: exec.callId, reason, signal: exec.signal })
    if (outcome !== 'allowed-once') throw new Error(`Not approved (${outcome}). Nothing was changed.`)
    return { kind: 'approval', outcome, toolCallId: exec.callId, reason }
  }

  function inWorkspace(path: string): string {
    const full = resolve(env.workspace, path)
    const rel = relative(env.workspace, full)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Path must stay inside the workspace (${env.workspace}).`)
    return full
  }

  function summary(projectId: string) {
    const s = store()
    const published = s.published(projectId)
    const count = (rows: Array<{ status: Status }>) => ({ candidate: rows.filter(r => r.status === 'candidate').length, confirmed: rows.filter(r => r.status === 'confirmed').length })
    const check = s.publishCheck(projectId)
    return {
      project: s.project(projectId),
      published: published ? { version: published.version, hash: published.hash, createdAt: published.createdAt } : null,
      draft: { publishable: !check.blocking.length && !check.unchanged, unchanged: check.unchanged, blocking: check.blocking, warnings: check.warnings },
      materials: s.listMaterials(projectId).length,
      objects: count(s.objects(projectId)),
      links: count(s.links(projectId))
    }
  }

  return [
    {
      name: 'ontology_project',
      description: 'Create, list or inspect ontology projects. `get` shows the published version, draft issues and review counts.',
      parameters: obj({ action: { type: 'string', enum: ['create', 'list', 'get'] }, name: str('Project name (create).'), description: str('What the ontology is for (create).'), project }, ['action']),
      async execute(args) {
        const s = store()
        if (args.action === 'list') return { projects: s.listProjects() }
        if (args.action === 'create') return { project: s.createProject(String(args.name ?? ''), String(args.description ?? '')) }
        return summary(s.project(String(args.project)).id)
      }
    },
    {
      name: 'ontology_schema',
      description: 'Read the schema (`get`), replace the draft with a full schema (`draft`), or diff draft vs published (`diff`). Drafting returns structure, logic and coverage issues; fix blocking ones before publishing. Start from competency questions.',
      parameters: obj({ action: { type: 'string', enum: ['get', 'draft', 'diff'] }, project, schema: schemaParam }, ['action', 'project']),
      async execute(args) {
        const s = store()
        const id = s.project(String(args.project)).id
        if (args.action === 'draft') return { ...s.setDraft(id, args.schema), published: s.published(id)?.version ?? null }
        if (args.action === 'diff') return diffSchemas(s.published(id)?.schema, s.draft(id))
        const published = s.published(id)
        return { draft: s.draft(id), published: published ?? null }
      }
    },
    {
      name: 'ontology_schema_publish',
      description: 'Publish the current draft as a new immutable schema version. Asks the user for approval. Warnings require a note explaining why they are accepted.',
      parameters: obj({ project, note: str('Why this version is ready; required when the draft has warnings.') }, ['project']),
      async execute(args, exec) {
        const s = store()
        const id = s.project(String(args.project)).id
        const note = String(args.note ?? '')
        const check = s.publishCheck(id, note)
        if (check.blocking.length) return { published: false, blocking: check.blocking }
        if (check.unchanged) return { published: false, reason: 'Draft is identical to the latest published version.' }
        const diff = diffSchemas(s.published(id)?.schema, s.draft(id))
        const auth = await approve('ontology_schema_publish', exec, `Publish schema v${(s.published(id)?.version ?? 0) + 1} of "${s.project(id).name}": ${diff.summary}.${check.warnings.length ? ` ${check.warnings.length} warning(s) accepted: ${note}` : ''}`)
        const version = s.publish(id, note, auth)
        return { published: true, version: version.version, hash: version.hash }
      }
    },
    {
      name: 'ontology_material_add',
      description: 'Store a source text (file inside the workspace, or inline text) as read-only material with a SHA-256 hash. Evidence quotes must come from stored materials.',
      parameters: obj({ project, path: str('Text file path inside the workspace.'), text: str('Inline text, when there is no file.'), name: str('Display name; defaults to the path.') }, ['project']),
      async execute(args) {
        const s = store()
        const id = s.project(String(args.project)).id
        let text: string
        let name = args.name ? String(args.name) : ''
        if (args.path) {
          const full = inWorkspace(String(args.path))
          if ((await stat(full)).size > MAX_MATERIAL_BYTES) throw new Error('File is larger than 5 MB; split it first.')
          text = await readFile(full, 'utf8')
          if (text.includes('\u0000')) throw new Error('File is not text. Convert it to text first.')
          name ||= relative(env.workspace, full)
        } else if (typeof args.text === 'string' && args.text.length) {
          text = args.text
          name ||= 'inline'
        } else throw new Error('Give either path or text.')
        const { material, created } = s.addMaterial(id, name, text)
        return { created, material: { id: material.id, name: material.name, sha256: material.sha256, length: material.text.length, lines: text.split('\n').length } }
      }
    },
    {
      name: 'ontology_material_read',
      description: 'List materials, or read numbered lines from one (by line range or by search). Copy quotes exactly from what this returns.',
      parameters: obj({ project, materialId: str('Omit to list materials.'), query: str('Return lines containing this text.'), fromLine: { type: 'integer' }, toLine: { type: 'integer' } }, ['project']),
      async execute(args) {
        const s = store()
        const id = s.project(String(args.project)).id
        if (!args.materialId) return { materials: s.listMaterials(id) }
        const material = s.material(id, String(args.materialId))
        if (args.query) return { materialId: material.id, matches: searchLines(material.text, String(args.query), 50) }
        const lines = material.text.split('\n')
        const from = Math.max(1, Math.floor(Number(args.fromLine ?? 1)))
        const to = Math.min(lines.length, Math.floor(Number(args.toLine ?? from + 199)), from + 499)
        return { materialId: material.id, totalLines: lines.length, lines: lines.slice(from - 1, to).map((text, i) => ({ line: from + i, text })) }
      }
    },
    {
      name: 'ontology_assert',
      description: 'Record extracted objects and links as candidates in one batch, against the published schema. Every item needs a verbatim quote; failed items are reported and not stored. Links refer to objects by type and primary key. Candidates are never confirmed by this tool.',
      parameters: obj({
        project,
        extractor: str('Who produced this batch, e.g. "agent:manual" or "agent:doc-pass-1".'),
        objects: arr(obj({ type: str('Object type apiName.'), properties: { type: 'object', description: 'Property values keyed by apiName; must include the primary key.' }, evidence: evidenceList }, ['type', 'properties', 'evidence'])),
        links: arr(obj({
          linkType: str('Link type apiName.'),
          from: obj({ type: str('Object type.'), key: { description: 'Primary key value.' } }, ['type', 'key']),
          to: obj({ type: str('Object type.'), key: { description: 'Primary key value.' } }, ['type', 'key']),
          evidence: evidenceList
        }, ['linkType', 'from', 'to', 'evidence']))
      }, ['project', 'extractor']),
      async execute(args) {
        const s = store()
        const result = s.assertCandidates(s.project(String(args.project)).id, String(args.extractor ?? 'agent'), { objects: args.objects, links: args.links })
        const failed = [...result.objects, ...result.links].filter(r => r.outcome === 'failed').length
        return { ...result, failed }
      }
    },
    {
      name: 'ontology_review_preview',
      description: 'Show candidates with their evidence and whether each can be confirmed now. Use before ontology_review_commit so the user sees exactly what will change.',
      parameters: obj({ project, ids: arr({ type: 'string' }, 'Specific object/link ids; omit for all candidates.'), batchId: str('Only candidates from this batch.'), limit: { type: 'integer' } }, ['project']),
      async execute(args) {
        const s = store()
        const id = s.project(String(args.project)).id
        let records: Array<ObjectRecord | LinkRecord> = [...s.objects(id, { status: ['candidate'] }), ...s.links(id, { status: ['candidate'] })]
        if (Array.isArray(args.ids) && args.ids.length) records = records.filter(r => (args.ids as string[]).includes(r.id))
        if (args.batchId) records = records.filter(r => r.batchId === args.batchId)
        const limit = Math.min(Math.max(1, Math.floor(Number(args.limit ?? 50))), 200)
        const shown = records.slice(0, limit)
        const check = s.previewConfirm(id, shown.map(r => r.id))
        const blocked = new Map(check.blocked.map(b => [b.id, b.issues]))
        return {
          total: records.length,
          items: shown.map(r => ({ ...r, ready: !blocked.has(r.id), issues: blocked.get(r.id) ?? [], evidence: s.evidence(id, r.id).map(e => ({ materialId: e.materialId, line: e.line, field: e.field, role: e.role, quote: e.quote })) }))
        }
      }
    },
    {
      name: 'ontology_review_commit',
      description: 'Confirm or reject candidates by id. Asks the user for approval, showing the count and a sample. Only candidates that pass the preview checks are confirmed; the rest are returned with reasons.',
      parameters: obj({ project, decision: { type: 'string', enum: ['confirm', 'reject'] }, ids: arr({ type: 'string' }), note: str('Reason, recorded in the audit log (required for reject).') }, ['project', 'decision', 'ids']),
      async execute(args, exec) {
        const s = store()
        const id = s.project(String(args.project)).id
        const ids: string[] = Array.isArray(args.ids) ? [...new Set<string>(args.ids.map(String))] : []
        if (!ids.length) throw new Error('No ids given.')
        const label = (rid: string) => {
          const o = s.objects(id, { status: ['candidate'] }).find(x => x.id === rid)
          return o ? `${o.type} "${o.key}"` : rid
        }
        const sample = (list: string[]) => list.slice(0, 5).map(label).join(', ') + (list.length > 5 ? ` and ${list.length - 5} more` : '')
        if (args.decision === 'reject') {
          const note = String(args.note ?? '').trim()
          if (!note) throw new Error('A note is required when rejecting.')
          const auth = await approve('ontology_review_commit', exec, `Reject ${ids.length} candidate(s) in "${s.project(id).name}": ${sample(ids)}. Reason: ${note}`)
          return s.reject(id, ids, note, auth)
        }
        const preview = s.previewConfirm(id, ids)
        if (!preview.ready.length) return { confirmed: [], blocked: preview.blocked }
        const auth = await approve('ontology_review_commit', exec, `Confirm ${preview.ready.length} candidate(s) in "${s.project(id).name}": ${sample(preview.ready)}.${preview.blocked.length ? ` ${preview.blocked.length} not ready and left as candidates.` : ''}`)
        const done = s.confirm(id, preview.ready, auth)
        return { confirmed: done.ready, blocked: done.blocked }
      }
    },
    {
      name: 'ontology_batch_rollback',
      description: 'Undo one extraction batch: remove the candidates and evidence it added and restore merged values. Refused if the batch touched confirmed records or a later batch builds on it.',
      parameters: obj({ project, batchId: str('Batch id returned by ontology_assert.') }, ['project', 'batchId']),
      async execute(args) {
        const s = store()
        return s.rollbackBatch(s.project(String(args.project)).id, String(args.batchId))
      }
    },
    {
      name: 'ontology_query',
      description: 'Query objects with an ObjectSet: start from one object type, filter, follow links by traversal name, optionally aggregate. Confirmed records only unless status says otherwise.',
      parameters: obj({
        project,
        objectType: str('Starting object type.'),
        where: filterParam,
        traverse: arr(obj({ link: str('Link apiName (from source side) or inverseApiName (from target side).'), where: filterParam }, ['link'])),
        status: statusList,
        limit: { type: 'integer', description: 'Max objects returned (default 50, max 500).' },
        aggregate: obj({ groupBy: str('Property to group by.'), metric: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] }, property: str('Numeric property for sum/avg/min/max.') }, ['metric'])
      }, ['project', 'objectType']),
      async execute(args) {
        const s = store()
        const id = s.project(String(args.project)).id
        const published = s.published(id)
        if (!published) throw new Error('No published schema.')
        const statuses: Status[] = Array.isArray(args.status) && args.status.length ? args.status : ['confirmed']
        const { project: _p, ...query } = args
        return runQuery({ schema: published.schema, objects: s.objects(id, { status: statuses }), links: s.links(id, { status: statuses }) }, { ...query, status: statuses } as ObjectSetQuery)
      }
    },
    {
      name: 'ontology_export',
      description: 'Export the published schema (OWL classes/properties + SHACL shapes) and confirmed instances with provenance, as Turtle or JSON-LD. Writes to a workspace file, or returns the text when no path is given.',
      parameters: obj({ project, format: { type: 'string', enum: ['turtle', 'jsonld'] }, base: str('Namespace IRI ending in / or #; defaults to urn:ontology:<project>/.'), path: str('Output file inside the workspace.'), includeCandidates: { type: 'boolean', description: 'Also export unconfirmed candidates. The RDF does not mark them, so do not use this for publication.' } }, ['project', 'format']),
      async execute(args) {
        const s = store()
        const p = s.project(String(args.project))
        const published = s.published(p.id)
        if (!published) throw new Error('No published schema.')
        const base = String(args.base ?? `urn:ontology:${encodeURIComponent(p.name)}/`)
        if (!/[/#]$/.test(base)) throw new Error('base must end with / or #.')
        const status: Status[] = args.includeCandidates ? ['confirmed', 'candidate'] : ['confirmed']
        const objects = s.objects(p.id, { status })
        const data = { base, version: published.version, schema: published.schema, objects, links: s.links(p.id, { status }), evidence: objects.flatMap(o => s.evidence(p.id, o.id)) }
        const text = args.format === 'jsonld' ? JSON.stringify(toJsonLd(data), null, 2) : toTurtle(data)
        if (args.path) {
          const full = inWorkspace(String(args.path))
          await mkdir(dirname(full), { recursive: true })
          await writeFile(full, text)
          return { path: full, bytes: Buffer.byteLength(text), objects: objects.length, links: data.links.length }
        }
        if (text.length > MAX_INLINE_EXPORT) throw new Error('Export is too large to return inline; give a path.')
        return { text, objects: objects.length, links: data.links.length }
      }
    },
    {
      name: 'ontology_audit',
      description: 'Show the append-only audit log of a project, newest first.',
      parameters: obj({ project, limit: { type: 'integer' } }, ['project']),
      async execute(args) {
        const s = store()
        return { entries: s.auditLog(s.project(String(args.project)).id, Math.min(Math.max(1, Math.floor(Number(args.limit ?? 50))), 500)) }
      }
    }
  ]
}

/** Names added, removed or changed between two schemas, plus a one-line summary for approval prompts. */
export function diffSchemas(before: OntologySchema | undefined, after: OntologySchema) {
  const section = <T extends { apiName: string }>(a: T[] = [], b: T[] = []) => {
    const left = new Map(a.map(x => [x.apiName, JSON.stringify(x)]))
    const right = new Map(b.map(x => [x.apiName, JSON.stringify(x)]))
    return {
      added: [...right.keys()].filter(k => !left.has(k)),
      removed: [...left.keys()].filter(k => !right.has(k)),
      changed: [...right.keys()].filter(k => left.has(k) && left.get(k) !== right.get(k))
    }
  }
  const objectTypes = section(before?.objectTypes, after.objectTypes)
  const linkTypes = section(before?.linkTypes, after.linkTypes)
  const part = (label: string, d: ReturnType<typeof section>) => d.added.length + d.removed.length + d.changed.length ? `${label} +${d.added.length} -${d.removed.length} ~${d.changed.length}` : ''
  const summary = [part('object types', objectTypes), part('link types', linkTypes)].filter(Boolean).join(', ') || 'no type changes'
  return { objectTypes, linkTypes, summary }
}
