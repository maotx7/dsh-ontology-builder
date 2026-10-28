/** Client for the plugin's read-only API, plus the shapes it returns. */

export type Status = 'candidate' | 'confirmed' | 'rejected'
export interface Issue { severity: 'blocking' | 'warning' | 'hint'; code: string; path: string; message: string }
export interface Project { id: string; name: string; description: string; createdAt: string }
export interface PropertyDef { apiName: string; displayName?: string; type: string; required?: boolean; enum?: string[] }
export interface ObjectTypeDef { apiName: string; displayName?: string; description?: string; primaryKey: string; titleProperty?: string; properties: PropertyDef[] }
export interface LinkTypeDef { apiName: string; inverseApiName: string; from: string; to: string; cardinality: string; description?: string }
export interface OntologySchema { questions: Array<{ id: string; text: string; priority: string }>; objectTypes: ObjectTypeDef[]; linkTypes: LinkTypeDef[] }
export interface ObjectRecord { id: string; type: string; key: string; properties: Record<string, unknown>; status: Status; batchId: string }
export interface LinkRecord { id: string; linkType: string; fromId: string; toId: string; status: Status; batchId: string }
export interface CodeLink { id: string; objectId: string; codeRef: string; relation: string; status: Status; batchId: string; stale: boolean }
export interface Evidence { id: string; targetId: string; field: string | null; materialId: string; start: number; end: number; line: number; quote: string; match: string; role: string; batchId: string; status?: Status }
export interface Conflict { id: string; targetId: string; field: string; kept: unknown; other: unknown; batchId: string | null }
export interface Overview {
  project: Project
  versions: Array<{ version: number; note: string; hash: string; createdAt: string }>
  objects: Record<Status, number>
  links: Record<Status, number>
  materials: number
  snapshot: { id: string; root: string; createdAt: string; stats: Record<string, number> } | null
}
export interface ReviewItem { id: string; kind: 'object' | 'link' | 'code-link'; type: string; label: string; batchId: string; issues: Issue[] }
export interface Review {
  published: boolean
  items: ReviewItem[]
  conflicts: Conflict[]
  samples: Array<{ ruleId: string; targetId: string }>
  rules: Array<{ id: string; status: string; definition: { name: string }; stats: { confirmed: number; judged: number; accuracy: number | null } }>
}
export interface ItemDetail { record: ObjectRecord | LinkRecord | CodeLink; endpoints: ObjectRecord[]; evidence: Evidence[]; conflicts: Conflict[]; codeLinks: CodeLink[]; code: { ref: string; kind: string; module: string; materialId: string; line: number } | null }
export interface Material { id: string; name: string; sha256: string; text: string; createdAt: string }
export interface MaterialSummary { id: string; name: string; sha256: string; createdAt: string; length: number }
export interface SchemaDiff { objectTypes: { added: string[]; removed: string[]; changed: string[] }; linkTypes: { added: string[]; removed: string[]; changed: string[] }; summary: string }
export interface Quality {
  schemaVersion: number
  summary: { blocking: number; warnings: number; hints: number; ready: boolean }
  structure: Issue[]; logic: Issue[]; evidence: Issue[]; smells: Issue[]
  questions: { issues: Issue[]; results: Array<{ questionId: string; text: string; priority: string; status: string; total?: number; missing?: string[]; error?: string; regression: boolean }>; mustAnswered: number; mustTotal: number; regressions: string[] }
  extraction: { candidates: number; confirmed: number; rejected: number; reviewAcceptance: number | null; droppedByValidation: number; codeLinks: { candidate: number; confirmed: number; stale: number }; rules: Array<{ id: string; name: string; status: string; confirmed: number; judged: number; accuracy: number | null }> }
  method: string
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export async function api<T>(endpoint: string, params: Record<string, string | undefined> = {}): Promise<T> {
  const query = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined))
  const res = await fetch(`api/${endpoint}?${query}`, { credentials: 'same-origin' })
  const body = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText)
  return body as T
}
