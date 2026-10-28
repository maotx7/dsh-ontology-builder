import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { findQuote } from './evidence.js'
import { type Issue, type LinkTypeDef, type ObjectTypeDef, type OntologySchema, emptySchema, normalizeSchema, validateProperties, validateSchema } from './schema.js'

export type Status = 'candidate' | 'confirmed' | 'rejected'
export type EvidenceRole = 'specified' | 'observed' | 'correspondence' | 'inferred'
export const EVIDENCE_ROLES: readonly EvidenceRole[] = ['specified', 'observed', 'correspondence', 'inferred']

/** Proof that a person allowed a state change. Every confirmation and publication stores one. */
export interface Authorization {
  kind: 'approval'
  outcome: 'allowed-once'
  /** Tool call the approval was asked for. */
  toolCallId?: string
  /** What the user was shown when asked. */
  reason: string
}

export interface Project { id: string; name: string; description: string; createdAt: string }
export interface SchemaVersion { version: number; schema: OntologySchema; hash: string; note: string; createdAt: string }
export interface Material { id: string; name: string; sha256: string; text: string; createdAt: string }
export interface ObjectRecord { id: string; type: string; key: string; properties: Record<string, unknown>; status: Status; batchId: string }
export interface LinkRecord { id: string; linkType: string; fromId: string; toId: string; status: Status; batchId: string }
export interface EvidenceRecord { id: string; targetId: string; field: string | null; materialId: string; start: number; end: number; line: number; quote: string; match: string; role: EvidenceRole; batchId: string }

export interface EvidenceInput { materialId: string; quote: string; field?: string; role?: EvidenceRole }
export interface ObjectInput { type: string; properties: Record<string, unknown>; evidence: EvidenceInput[] }
export interface ObjectRef { type: string; key: string | number }
export interface LinkInput { linkType: string; from: ObjectRef; to: ObjectRef; evidence: EvidenceInput[] }
export interface ItemResult { index: number; outcome: 'created' | 'merged' | 'failed'; id?: string; issues: Issue[] }
export interface AssertResult { batchId: string; schemaVersion: number; objects: ItemResult[]; links: ItemResult[] }
export interface ConfirmPreview { ready: string[]; blocked: Array<{ id: string; issues: Issue[] }> }

const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL, draft TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS schema_versions (project_id TEXT NOT NULL REFERENCES projects(id), version INTEGER NOT NULL, schema TEXT NOT NULL, hash TEXT NOT NULL, note TEXT NOT NULL, authorization TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (project_id, version));
CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, sha256 TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (project_id, sha256));
CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), extractor TEXT NOT NULL, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), type TEXT NOT NULL, key TEXT NOT NULL, properties TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'confirmed', 'rejected')), batch_id TEXT NOT NULL REFERENCES batches(id), decision TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (project_id, type, key));
CREATE TABLE IF NOT EXISTS links (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), link_type TEXT NOT NULL, from_id TEXT NOT NULL REFERENCES objects(id), to_id TEXT NOT NULL REFERENCES objects(id),
  status TEXT NOT NULL CHECK (status IN ('candidate', 'confirmed', 'rejected')), batch_id TEXT NOT NULL REFERENCES batches(id), decision TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (project_id, link_type, from_id, to_id));
CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), target_id TEXT NOT NULL, field TEXT, material_id TEXT NOT NULL REFERENCES materials(id),
  start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, line INTEGER NOT NULL, quote TEXT NOT NULL, match TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('specified', 'observed', 'correspondence', 'inferred')), batch_id TEXT NOT NULL REFERENCES batches(id), created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS evidence_target ON evidence (target_id);
CREATE TABLE IF NOT EXISTS merges (batch_id TEXT NOT NULL REFERENCES batches(id), object_id TEXT NOT NULL REFERENCES objects(id), before TEXT NOT NULL, PRIMARY KEY (batch_id, object_id));
CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, at TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS versions_no_update BEFORE UPDATE ON schema_versions BEGIN SELECT RAISE(ABORT, 'published schema versions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS versions_no_delete BEFORE DELETE ON schema_versions BEGIN SELECT RAISE(ABORT, 'published schema versions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS materials_no_update BEFORE UPDATE ON materials BEGIN SELECT RAISE(ABORT, 'materials are read-only'); END;
`

type Row = Record<string, unknown>
const now = () => new Date().toISOString()
const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const issue = (code: string, path: string, message: string, severity: Issue['severity'] = 'blocking'): Issue => ({ severity, code, path, message })

/** JSON with sorted object keys, so equal schemas hash equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v))
}

function assertAuthorized(auth: Authorization) {
  if (auth?.kind !== 'approval' || auth.outcome !== 'allowed-once' || typeof auth.reason !== 'string') throw new Error('A user approval record is required for this change.')
}

export class Store {
  readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(DDL)
  }

  close() { this.db.close() }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private get(sql: string, ...params: Array<string | number | null>) { return this.db.prepare(sql).get(...params) as Row | undefined }
  private all(sql: string, ...params: Array<string | number | null>) { return this.db.prepare(sql).all(...params) as Row[] }
  private run(sql: string, ...params: Array<string | number | null>) { this.db.prepare(sql).run(...params) }
  private audit(projectId: string, action: string, detail: unknown) {
    this.run('INSERT INTO audit (project_id, at, action, detail) VALUES (?, ?, ?, ?)', projectId, now(), action, JSON.stringify(detail))
  }

  createProject(name: string, description = ''): Project {
    if (!name.trim()) throw new Error('Project name is required.')
    if (this.get('SELECT 1 FROM projects WHERE name = ?', name)) throw new Error(`Project "${name}" already exists.`)
    const project = { id: newId('prj'), name, description, createdAt: now() }
    this.tx(() => {
      this.run('INSERT INTO projects (id, name, description, draft, created_at) VALUES (?, ?, ?, ?, ?)', project.id, name, description, JSON.stringify(emptySchema()), project.createdAt)
      this.audit(project.id, 'project.create', { name })
    })
    return project
  }

  listProjects(): Project[] {
    return this.all('SELECT id, name, description, created_at FROM projects ORDER BY created_at').map(toProject)
  }

  /** Resolve a project by id or name. */
  project(idOrName: string): Project {
    const row = this.get('SELECT id, name, description, created_at FROM projects WHERE id = ? OR name = ?', idOrName, idOrName)
    if (!row) throw new Error(`Unknown project "${idOrName}".`)
    return toProject(row)
  }

  draft(projectId: string): OntologySchema {
    return JSON.parse(String(this.get('SELECT draft FROM projects WHERE id = ?', projectId)?.draft))
  }

  /** Replace the working draft. Drafts may contain issues; publishing may not. */
  setDraft(projectId: string, input: unknown): { schema: OntologySchema; issues: Issue[] } {
    const schema = normalizeSchema(input)
    this.tx(() => {
      this.run('UPDATE projects SET draft = ? WHERE id = ?', JSON.stringify(schema), projectId)
      this.audit(projectId, 'schema.draft', { hash: sha256(canonicalJson(schema)) })
    })
    return { schema, issues: validateSchema(schema) }
  }

  published(projectId: string): SchemaVersion | undefined {
    const row = this.get('SELECT version, schema, hash, note, created_at FROM schema_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1', projectId)
    return row && { version: Number(row.version), schema: JSON.parse(String(row.schema)), hash: String(row.hash), note: String(row.note), createdAt: String(row.created_at) }
  }

  /** Checks that decide whether the draft may be published; empty `blocking` means it may. */
  publishCheck(projectId: string, note = ''): { blocking: Issue[]; warnings: Issue[]; hash: string; unchanged: boolean } {
    const schema = this.draft(projectId)
    const issues = validateSchema(schema)
    const hash = sha256(canonicalJson(schema))
    const blocking = issues.filter(i => i.severity === 'blocking')
    const warnings = issues.filter(i => i.severity === 'warning')
    if (!schema.objectTypes.length) blocking.push(issue('EMPTY_SCHEMA', 'objectTypes', 'Define at least one object type before publishing.'))
    if (warnings.length && !note.trim()) blocking.push(issue('NOTE_REQUIRED', 'note', 'The draft has warnings; publishing needs a note explaining why they are accepted.'))
    return { blocking, warnings, hash, unchanged: this.published(projectId)?.hash === hash }
  }

  publish(projectId: string, note: string, auth: Authorization): SchemaVersion {
    assertAuthorized(auth)
    return this.tx(() => {
      const check = this.publishCheck(projectId, note)
      if (check.blocking.length) throw new Error(`Draft cannot be published: ${check.blocking.map(i => i.message).join(' ')}`)
      if (check.unchanged) throw new Error('Draft is identical to the latest published version.')
      const version = (this.published(projectId)?.version ?? 0) + 1
      this.run('INSERT INTO schema_versions (project_id, version, schema, hash, note, authorization, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        projectId, version, JSON.stringify(this.draft(projectId)), check.hash, note, JSON.stringify(auth), now())
      this.audit(projectId, 'schema.publish', { version, hash: check.hash, note, authorization: auth })
      return this.published(projectId)!
    })
  }

  /** Store source text. Identical content is stored once and keeps its first id. */
  addMaterial(projectId: string, name: string, text: string): { material: Material; created: boolean } {
    const hash = sha256(text)
    const existing = this.get('SELECT id FROM materials WHERE project_id = ? AND sha256 = ?', projectId, hash)
    if (existing) return { material: this.material(projectId, String(existing.id)), created: false }
    const id = newId('mat')
    this.tx(() => {
      this.run('INSERT INTO materials (id, project_id, name, sha256, text, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, projectId, name, hash, text, now())
      this.audit(projectId, 'material.add', { id, name, sha256: hash, length: text.length })
    })
    return { material: this.material(projectId, id), created: true }
  }

  material(projectId: string, id: string): Material {
    const row = this.get('SELECT id, name, sha256, text, created_at FROM materials WHERE project_id = ? AND id = ?', projectId, id)
    if (!row) throw new Error(`Unknown material "${id}".`)
    return { id: String(row.id), name: String(row.name), sha256: String(row.sha256), text: String(row.text), createdAt: String(row.created_at) }
  }

  listMaterials(projectId: string): Array<Omit<Material, 'text'> & { length: number }> {
    return this.all('SELECT id, name, sha256, length(text) AS length, created_at FROM materials WHERE project_id = ? ORDER BY created_at', projectId)
      .map(r => ({ id: String(r.id), name: String(r.name), sha256: String(r.sha256), length: Number(r.length), createdAt: String(r.created_at) }))
  }
  /**
   * Record extracted objects and links as candidates in one batch, checked
   * against the latest published schema. Every item needs at least one quote
   * that is found verbatim in a stored material; items failing any check are
   * reported and not stored. Nothing here can produce a confirmed record.
   */
  assertCandidates(projectId: string, extractor: string, input: { objects?: ObjectInput[]; links?: LinkInput[] }): AssertResult {
    const published = this.published(projectId)
    if (!published) throw new Error('Publish a schema version before recording instances.')
    const types = new Map(published.schema.objectTypes.map(t => [t.apiName, t]))
    const linkTypes = new Map(published.schema.linkTypes.map(l => [l.apiName, l]))
    const batchId = newId('bat')
    const at = now()
    return this.tx(() => {
      this.run('INSERT INTO batches (id, project_id, extractor, schema_version, created_at) VALUES (?, ?, ?, ?, ?)', batchId, projectId, extractor, published.version, at)
      const objects = (input.objects ?? []).map((item, index) => this.assertObject(projectId, batchId, types, item, index, at))
      const links = (input.links ?? []).map((item, index) => this.assertLink(projectId, batchId, linkTypes, item, index, at))
      this.audit(projectId, 'batch.assert', { batchId, extractor, schemaVersion: published.version, objects: tally(objects), links: tally(links) })
      return { batchId, schemaVersion: published.version, objects, links }
    })
  }

  private assertObject(projectId: string, batchId: string, types: Map<string, ObjectTypeDef>, item: ObjectInput, index: number, at: string): ItemResult {
    const type = types.get(item?.type)
    if (!type) return { index, outcome: 'failed', issues: [issue('UNKNOWN_TYPE', 'type', `"${item?.type}" is not an object type in the published schema.`)] }
    const properties = item.properties && typeof item.properties === 'object' ? item.properties : {}
    const issues = validateProperties(type, properties)
    const fields = new Set(type.properties.map(p => p.apiName))
    const evidence = this.checkEvidence(projectId, item.evidence, field => field === undefined || fields.has(field), issues)
    if (issues.some(i => i.severity === 'blocking')) return { index, outcome: 'failed', issues }
    const key = String(properties[type.primaryKey])
    const existing = this.get('SELECT id, properties, status FROM objects WHERE project_id = ? AND type = ? AND key = ?', projectId, type.apiName, key)
    let id: string
    if (existing) {
      id = String(existing.id)
      if (existing.status === 'rejected') return { index, outcome: 'failed', id, issues: [issue('PREVIOUSLY_REJECTED', 'properties', `${type.apiName} "${key}" was rejected before.`)] }
      const merged: Record<string, unknown> = JSON.parse(String(existing.properties))
      for (const [field, value] of Object.entries(properties)) {
        if (value === null || value === undefined) continue
        if (merged[field] === undefined || merged[field] === null) merged[field] = value
        else if (canonicalJson(merged[field]) !== canonicalJson(value)) issues.push(issue('CONFLICTING_VALUE', field, `Kept existing value ${JSON.stringify(merged[field])}; this batch says ${JSON.stringify(value)}.`, 'warning'))
      }
      if (existing.status === 'confirmed' && canonicalJson(merged) !== canonicalJson(JSON.parse(String(existing.properties)))) {
        issues.push(issue('CONFIRMED_UNCHANGED', 'properties', 'Object is confirmed; new values were not applied.', 'warning'))
      } else {
        this.run('INSERT OR IGNORE INTO merges (batch_id, object_id, before) VALUES (?, ?, ?)', batchId, id, String(existing.properties))
        this.run('UPDATE objects SET properties = ?, updated_at = ? WHERE id = ?', JSON.stringify(merged), at, id)
      }
    } else {
      id = newId('obj')
      this.run('INSERT INTO objects (id, project_id, type, key, properties, status, batch_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, projectId, type.apiName, key, JSON.stringify(properties), 'candidate', batchId, at, at)
    }
    this.insertEvidence(projectId, batchId, id, evidence, at)
    return { index, outcome: existing ? 'merged' : 'created', id, issues }
  }

  private assertLink(projectId: string, batchId: string, linkTypes: Map<string, LinkTypeDef>, item: LinkInput, index: number, at: string): ItemResult {
    const def = linkTypes.get(item?.linkType)
    if (!def) return { index, outcome: 'failed', issues: [issue('UNKNOWN_LINK_TYPE', 'linkType', `"${item?.linkType}" is not a link type in the published schema.`)] }
    const issues: Issue[] = []
    const resolve = (ref: ObjectRef | undefined, expected: string, side: 'from' | 'to') => {
      if (ref?.type !== expected) { issues.push(issue('WRONG_ENDPOINT_TYPE', side, `${def.apiName}.${side} must be a ${expected}.`)); return }
      const row = this.get("SELECT id, status FROM objects WHERE project_id = ? AND type = ? AND key = ?", projectId, expected, String(ref.key))
      if (!row) issues.push(issue('UNKNOWN_ENDPOINT', side, `${expected} "${ref.key}" does not exist; record the object first.`))
      else if (row.status === 'rejected') issues.push(issue('REJECTED_ENDPOINT', side, `${expected} "${ref.key}" was rejected.`))
      else return String(row.id)
    }
    const fromId = resolve(item.from, def.from, 'from')
    const toId = resolve(item.to, def.to, 'to')
    const evidence = this.checkEvidence(projectId, item.evidence, field => field === undefined, issues)
    if (!fromId || !toId || issues.some(i => i.severity === 'blocking')) return { index, outcome: 'failed', issues }
    const existing = this.get('SELECT id, status FROM links WHERE project_id = ? AND link_type = ? AND from_id = ? AND to_id = ?', projectId, def.apiName, fromId, toId)
    if (existing?.status === 'rejected') return { index, outcome: 'failed', id: String(existing.id), issues: [issue('PREVIOUSLY_REJECTED', 'link', 'This link was rejected before.')] }
    const id = existing ? String(existing.id) : newId('lnk')
    if (!existing) {
      issues.push(...this.cardinalityIssues(projectId, def, fromId, toId, ['candidate', 'confirmed'], 'warning'))
      this.run('INSERT INTO links (id, project_id, link_type, from_id, to_id, status, batch_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, projectId, def.apiName, fromId, toId, 'candidate', batchId, at, at)
    }
    this.insertEvidence(projectId, batchId, id, evidence, at)
    return { index, outcome: existing ? 'merged' : 'created', id, issues }
  }

  /** Locate each quote in its material. Unlocatable quotes are blocking: the model may not cite text that is not there. */
  private checkEvidence(projectId: string, input: EvidenceInput[] | undefined, fieldAllowed: (field: string | undefined) => boolean, issues: Issue[]) {
    const located: Array<{ materialId: string; field: string | null; quote: string; role: EvidenceRole; start: number; end: number; line: number; match: string }> = []
    const list = Array.isArray(input) ? input : []
    if (!list.length) issues.push(issue('NO_EVIDENCE', 'evidence', 'At least one quote from a stored material is required.'))
    list.forEach((ev, i) => {
      const path = `evidence[${i}]`
      const role = ev?.role ?? 'specified'
      if (!EVIDENCE_ROLES.includes(role)) return issues.push(issue('INVALID_ROLE', path, `role must be one of ${EVIDENCE_ROLES.join(', ')}.`))
      if (!fieldAllowed(ev.field)) return issues.push(issue('UNKNOWN_FIELD', path, `field "${ev.field}" is not a property here.`))
      const row = this.get('SELECT text FROM materials WHERE project_id = ? AND id = ?', projectId, String(ev.materialId))
      if (!row) return issues.push(issue('UNKNOWN_MATERIAL', path, `Material "${ev.materialId}" is not stored in this project.`))
      const match = typeof ev.quote === 'string' ? findQuote(String(row.text), ev.quote) : undefined
      if (!match) return issues.push(issue('QUOTE_NOT_FOUND', path, `Quote not found verbatim in ${ev.materialId}; copy it exactly from the material.`))
      const text = String(row.text)
      located.push({ materialId: String(ev.materialId), field: ev.field ?? null, quote: text.slice(match.start, match.end), role, start: match.start, end: match.end, line: match.line, match: match.mode })
    })
    return located
  }

  private insertEvidence(projectId: string, batchId: string, targetId: string, evidence: ReturnType<Store['checkEvidence']>, at: string) {
    for (const ev of evidence) {
      this.run('INSERT INTO evidence (id, project_id, target_id, field, material_id, start_offset, end_offset, line, quote, match, role, batch_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        newId('evd'), projectId, targetId, ev.field, ev.materialId, ev.start, ev.end, ev.line, ev.quote, ev.match, ev.role, batchId, at)
    }
  }

  private cardinalityIssues(projectId: string, def: LinkTypeDef, fromId: string, toId: string, statuses: Status[], severity: Issue['severity']): Issue[] {
    const issues: Issue[] = []
    const marks = statuses.map(() => '?').join(', ')
    const singleTarget = def.cardinality === 'one-to-one' || def.cardinality === 'many-to-one'
    const singleSource = def.cardinality === 'one-to-one' || def.cardinality === 'one-to-many'
    if (singleTarget && this.get(`SELECT 1 FROM links WHERE project_id = ? AND link_type = ? AND from_id = ? AND to_id != ? AND status IN (${marks})`, projectId, def.apiName, fromId, toId, ...statuses)) {
      issues.push(issue('CARDINALITY', 'from', `${def.apiName} is ${def.cardinality}: the source already has another ${def.apiName} link.`, severity))
    }
    if (singleSource && this.get(`SELECT 1 FROM links WHERE project_id = ? AND link_type = ? AND to_id = ? AND from_id != ? AND status IN (${marks})`, projectId, def.apiName, toId, fromId, ...statuses)) {
      issues.push(issue('CARDINALITY', 'to', `${def.apiName} is ${def.cardinality}: the target already has another ${def.inverseApiName} link.`, severity))
    }
    return issues
  }
  /**
   * Which of `ids` may be confirmed right now. An object needs valid values
   * under the latest schema, all required properties, and at least one
   * non-inferred quote. A link additionally needs both endpoints confirmed (or
   * confirmed in the same call) and must respect cardinality among confirmed links.
   */
  previewConfirm(projectId: string, ids: string[]): ConfirmPreview {
    const schema = this.published(projectId)?.schema
    if (!schema) throw new Error('No published schema.')
    const types = new Map(schema.objectTypes.map(t => [t.apiName, t]))
    const linkTypes = new Map(schema.linkTypes.map(l => [l.apiName, l]))
    const wanted = new Set(ids)
    const ready: string[] = []
    const blocked: ConfirmPreview['blocked'] = []
    const objectsReady = new Set<string>()
    const roles = (id: string) => this.all('SELECT role FROM evidence WHERE project_id = ? AND target_id = ?', projectId, id).map(r => String(r.role))
    const evidenceIssues = (id: string) => roles(id).some(r => r !== 'inferred') ? [] : [issue('ONLY_INFERRED', 'evidence', 'Only inferred evidence; inferred assertions are never auto-confirmed. Add a direct quote first.')]
    const decide = (id: string, issues: Issue[]) => {
      if (issues.length) blocked.push({ id, issues })
      else ready.push(id)
    }
    const objectIds = ids.filter(id => id.startsWith('obj_'))
    for (const id of objectIds) {
      const row = this.get('SELECT type, properties, status FROM objects WHERE project_id = ? AND id = ?', projectId, id)
      if (!row) { decide(id, [issue('UNKNOWN_RECORD', 'id', `No object "${id}".`)]); continue }
      if (row.status !== 'candidate') { decide(id, [issue('NOT_CANDIDATE', 'status', `Object is already ${row.status}.`)]); continue }
      const type = types.get(String(row.type))
      const issues = type ? validateProperties(type, JSON.parse(String(row.properties))) : [issue('UNKNOWN_TYPE', 'type', `Type ${row.type} is not in the latest schema.`)]
      issues.forEach(i => { i.severity = 'blocking' })
      issues.push(...evidenceIssues(id))
      if (!issues.length) objectsReady.add(id)
      decide(id, issues)
    }
    const pending: Array<{ from: string; to: string; def: LinkTypeDef }> = []
    for (const id of ids.filter(id => !id.startsWith('obj_'))) {
      const row = this.get('SELECT link_type, from_id, to_id, status FROM links WHERE project_id = ? AND id = ?', projectId, id)
      if (!row) { decide(id, [issue('UNKNOWN_RECORD', 'id', `No object or link "${id}".`)]); continue }
      if (row.status !== 'candidate') { decide(id, [issue('NOT_CANDIDATE', 'status', `Link is already ${row.status}.`)]); continue }
      const def = linkTypes.get(String(row.link_type))
      if (!def) { decide(id, [issue('UNKNOWN_LINK_TYPE', 'linkType', `Link type ${row.link_type} is not in the latest schema.`)]); continue }
      const from = String(row.from_id)
      const to = String(row.to_id)
      const issues = evidenceIssues(id)
      for (const [side, endpoint] of [['from', from], ['to', to]] as const) {
        const status = this.get('SELECT status FROM objects WHERE id = ?', endpoint)?.status
        if (status !== 'confirmed' && !objectsReady.has(endpoint)) issues.push(issue('ENDPOINT_NOT_CONFIRMED', side, wanted.has(endpoint) ? `Endpoint ${endpoint} cannot be confirmed yet.` : `Confirm endpoint ${endpoint} first or in the same call.`))
      }
      issues.push(...this.cardinalityIssues(projectId, def, from, to, ['confirmed'], 'blocking'))
      // Two links in this same call can also break cardinality.
      for (const other of pending) {
        if (other.def.apiName !== def.apiName) continue
        const singleTarget = def.cardinality === 'one-to-one' || def.cardinality === 'many-to-one'
        const singleSource = def.cardinality === 'one-to-one' || def.cardinality === 'one-to-many'
        if ((singleTarget && other.from === from && other.to !== to) || (singleSource && other.to === to && other.from !== from)) issues.push(issue('CARDINALITY', 'link', `Conflicts with another ${def.apiName} link in this call (${def.cardinality}).`))
      }
      if (!issues.length) pending.push({ from, to, def })
      decide(id, issues)
    }
    return { ready, blocked }
  }

  /** Confirm the ready subset of `ids`; blocked ones are returned untouched. */
  confirm(projectId: string, ids: string[], auth: Authorization): ConfirmPreview {
    assertAuthorized(auth)
    return this.tx(() => {
      const preview = this.previewConfirm(projectId, ids)
      this.setStatus(projectId, preview.ready, 'confirmed', auth)
      this.audit(projectId, 'review.confirm', { ids: preview.ready, blocked: preview.blocked.map(b => b.id), authorization: auth })
      return preview
    })
  }

  /** Reject candidates. Rejected keys are remembered so later batches cannot re-add them silently. */
  reject(projectId: string, ids: string[], note: string, auth: Authorization): { rejected: string[]; skipped: string[] } {
    assertAuthorized(auth)
    return this.tx(() => {
      const rejected: string[] = []
      const skipped: string[] = []
      for (const id of ids) {
        const table = id.startsWith('obj_') ? 'objects' : 'links'
        const row = this.get(`SELECT status FROM ${table} WHERE project_id = ? AND id = ?`, projectId, id)
        if (row?.status === 'candidate') rejected.push(id)
        else skipped.push(id)
      }
      // Candidate links hanging off a rejected object go with it.
      for (const id of rejected.filter(id => id.startsWith('obj_'))) {
        for (const link of this.all("SELECT id FROM links WHERE project_id = ? AND status = 'candidate' AND (from_id = ? OR to_id = ?)", projectId, id, id)) {
          if (!rejected.includes(String(link.id))) rejected.push(String(link.id))
        }
      }
      this.setStatus(projectId, rejected, 'rejected', { ...auth, note })
      this.audit(projectId, 'review.reject', { ids: rejected, skipped, note, authorization: auth })
      return { rejected, skipped }
    })
  }

  private setStatus(projectId: string, ids: string[], status: Status, decision: unknown) {
    const at = now()
    for (const id of ids) {
      const table = id.startsWith('obj_') ? 'objects' : 'links'
      this.run(`UPDATE ${table} SET status = ?, decision = ?, updated_at = ? WHERE project_id = ? AND id = ?`, status, JSON.stringify(decision), at, projectId, id)
    }
  }

  /**
   * Undo a batch: delete the candidates it created and the evidence it added.
   * Refused when the batch touched anything already confirmed, or when later
   * batches link to objects it created.
   */
  rollbackBatch(projectId: string, batchId: string): { objects: number; links: number; evidence: number } {
    return this.tx(() => {
      if (!this.get('SELECT 1 FROM batches WHERE project_id = ? AND id = ?', projectId, batchId)) throw new Error(`Unknown batch "${batchId}".`)
      const touchedConfirmed = this.get(`SELECT 1 FROM evidence e LEFT JOIN objects o ON o.id = e.target_id LEFT JOIN links l ON l.id = e.target_id
        WHERE e.project_id = ? AND e.batch_id = ? AND (o.status = 'confirmed' OR l.status = 'confirmed')`, projectId, batchId)
      if (touchedConfirmed) throw new Error('Batch added evidence to confirmed records; it cannot be rolled back.')
      const created = this.all('SELECT id FROM objects WHERE project_id = ? AND batch_id = ?', projectId, batchId).map(r => String(r.id))
      const foreign = this.get(`SELECT id FROM links WHERE project_id = ? AND batch_id != ? AND (from_id IN (SELECT id FROM objects WHERE batch_id = ?) OR to_id IN (SELECT id FROM objects WHERE batch_id = ?))`, projectId, batchId, batchId, batchId)
      if (foreign) throw new Error(`Link ${foreign.id} from another batch depends on objects created here; roll that batch back first.`)
      const later = this.get(`SELECT e.batch_id FROM evidence e JOIN batches b ON b.id = e.batch_id WHERE e.project_id = ? AND e.batch_id != ? AND b.rowid > (SELECT rowid FROM batches WHERE id = ?)
        AND e.target_id IN (SELECT target_id FROM evidence WHERE batch_id = ?)`, projectId, batchId, batchId, batchId)
      if (later) throw new Error(`Batch ${later.batch_id} later added to the same records; roll that batch back first.`)
      for (const merge of this.all('SELECT object_id, before FROM merges WHERE batch_id = ?', batchId)) {
        this.run('UPDATE objects SET properties = ?, updated_at = ? WHERE id = ?', String(merge.before), now(), String(merge.object_id))
      }
      this.run('DELETE FROM merges WHERE batch_id = ?', batchId)
      const evidence = Number(this.get('SELECT count(*) AS n FROM evidence WHERE project_id = ? AND batch_id = ?', projectId, batchId)?.n)
      const links = Number(this.get('SELECT count(*) AS n FROM links WHERE project_id = ? AND batch_id = ?', projectId, batchId)?.n)
      this.run('DELETE FROM evidence WHERE project_id = ? AND batch_id = ?', projectId, batchId)
      this.run('DELETE FROM links WHERE project_id = ? AND batch_id = ?', projectId, batchId)
      this.run('DELETE FROM objects WHERE project_id = ? AND batch_id = ?', projectId, batchId)
      this.audit(projectId, 'batch.rollback', { batchId, objects: created.length, links, evidence })
      return { objects: created.length, links, evidence }
    })
  }

  objects(projectId: string, filter: { type?: string; status?: Status[] } = {}): ObjectRecord[] {
    const statuses = filter.status?.length ? filter.status : ['candidate', 'confirmed']
    const marks = statuses.map(() => '?').join(', ')
    const rows = filter.type
      ? this.all(`SELECT id, type, key, properties, status, batch_id FROM objects WHERE project_id = ? AND type = ? AND status IN (${marks}) ORDER BY rowid`, projectId, filter.type, ...statuses)
      : this.all(`SELECT id, type, key, properties, status, batch_id FROM objects WHERE project_id = ? AND status IN (${marks}) ORDER BY rowid`, projectId, ...statuses)
    return rows.map(r => ({ id: String(r.id), type: String(r.type), key: String(r.key), properties: JSON.parse(String(r.properties)), status: r.status as Status, batchId: String(r.batch_id) }))
  }

  links(projectId: string, filter: { linkType?: string; status?: Status[] } = {}): LinkRecord[] {
    const statuses = filter.status?.length ? filter.status : ['candidate', 'confirmed']
    const marks = statuses.map(() => '?').join(', ')
    const rows = filter.linkType
      ? this.all(`SELECT id, link_type, from_id, to_id, status, batch_id FROM links WHERE project_id = ? AND link_type = ? AND status IN (${marks}) ORDER BY rowid`, projectId, filter.linkType, ...statuses)
      : this.all(`SELECT id, link_type, from_id, to_id, status, batch_id FROM links WHERE project_id = ? AND status IN (${marks}) ORDER BY rowid`, projectId, ...statuses)
    return rows.map(r => ({ id: String(r.id), linkType: String(r.link_type), fromId: String(r.from_id), toId: String(r.to_id), status: r.status as Status, batchId: String(r.batch_id) }))
  }

  evidence(projectId: string, targetId: string): EvidenceRecord[] {
    return this.all('SELECT * FROM evidence WHERE project_id = ? AND target_id = ? ORDER BY rowid', projectId, targetId).map(r => ({
      id: String(r.id), targetId: String(r.target_id), field: r.field === null ? null : String(r.field), materialId: String(r.material_id),
      start: Number(r.start_offset), end: Number(r.end_offset), line: Number(r.line), quote: String(r.quote), match: String(r.match), role: r.role as EvidenceRole, batchId: String(r.batch_id)
    }))
  }

  auditLog(projectId: string, limit = 50): Array<{ seq: number; at: string; action: string; detail: unknown }> {
    return this.all('SELECT seq, at, action, detail FROM audit WHERE project_id = ? ORDER BY seq DESC LIMIT ?', projectId, limit)
      .map(r => ({ seq: Number(r.seq), at: String(r.at), action: String(r.action), detail: JSON.parse(String(r.detail)) }))
  }
}

function tally(items: ItemResult[]) {
  return { created: items.filter(i => i.outcome === 'created').length, merged: items.filter(i => i.outcome === 'merged').length, failed: items.filter(i => i.outcome === 'failed').length }
}

function toProject(row: Row): Project {
  return { id: String(row.id), name: String(row.name), description: String(row.description), createdAt: String(row.created_at) }
}
