/** Export a published schema and its instances as Turtle (OWL + SHACL) or JSON-LD. */
import type { BaseType, OntologySchema } from './schema.js'
import type { EvidenceRecord, LinkRecord, ObjectRecord } from './store.js'

export interface ExportData {
  /** Namespace IRI ending in `/` or `#`. */
  base: string
  version: number
  schema: OntologySchema
  objects: ObjectRecord[]
  links: LinkRecord[]
  evidence: EvidenceRecord[]
}

const XSD: Record<BaseType, string> = { string: 'xsd:string', integer: 'xsd:integer', number: 'xsd:decimal', boolean: 'xsd:boolean', date: 'xsd:date', datetime: 'xsd:dateTime' }
const PREFIXES = { rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#', rdfs: 'http://www.w3.org/2000/01/rdf-schema#', owl: 'http://www.w3.org/2002/07/owl#', xsd: 'http://www.w3.org/2001/XMLSchema#', sh: 'http://www.w3.org/ns/shacl#', prov: 'http://www.w3.org/ns/prov#' }

const lit = (value: string) => JSON.stringify(value)
const local = (key: string) => encodeURIComponent(key).replace(/[!'()*.~-]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

export function toTurtle(data: ExportData): string {
  const out: string[] = []
  for (const [prefix, iri] of Object.entries({ ...PREFIXES, '': data.base })) out.push(`@prefix ${prefix}: <${iri}> .`)
  out.push('', `<${data.base}> a owl:Ontology ; owl:versionInfo ${lit(String(data.version))} .`)
  const typeIri = (name: string) => `:${name}`
  const propIri = (type: string, prop: string) => `:${type}.${prop}`

  for (const type of data.schema.objectTypes) {
    out.push('', `${typeIri(type.apiName)} a owl:Class ; rdfs:label ${lit(type.displayName ?? type.apiName)}${type.description ? ` ; rdfs:comment ${lit(type.description)}` : ''} .`)
    for (const p of type.properties) {
      out.push(`${propIri(type.apiName, p.apiName)} a owl:DatatypeProperty ; rdfs:label ${lit(p.displayName ?? p.apiName)} ; rdfs:domain ${typeIri(type.apiName)} ; rdfs:range ${XSD[p.type]} .`)
    }
    const shapes = type.properties.map(p => {
      const parts = [`sh:path ${propIri(type.apiName, p.apiName)}`, `sh:datatype ${XSD[p.type]}`, 'sh:maxCount 1']
      if (p.required || p.apiName === type.primaryKey) parts.push('sh:minCount 1')
      if (p.enum) parts.push(`sh:in ( ${p.enum.map(lit).join(' ')} )`)
      if (p.pattern) parts.push(`sh:pattern ${lit(p.pattern)}`)
      return `[ ${parts.join(' ; ')} ]`
    })
    out.push(`:${type.apiName}Shape a sh:NodeShape ; sh:targetClass ${typeIri(type.apiName)}${shapes.length ? ` ;\n  sh:property ${shapes.join(' ,\n    ')}` : ''} .`)
  }
  for (const link of data.schema.linkTypes) {
    const functional = link.cardinality === 'one-to-one' || link.cardinality === 'many-to-one'
    const inverseFunctional = link.cardinality === 'one-to-one' || link.cardinality === 'one-to-many'
    const kinds = ['owl:ObjectProperty', ...(functional ? ['owl:FunctionalProperty'] : []), ...(inverseFunctional ? ['owl:InverseFunctionalProperty'] : [])]
    out.push('', `:${link.apiName} a ${kinds.join(', ')} ; rdfs:domain ${typeIri(link.from)} ; rdfs:range ${typeIri(link.to)} ; owl:inverseOf :${link.inverseApiName} .`)
    out.push(`:${link.inverseApiName} a owl:ObjectProperty ; rdfs:domain ${typeIri(link.to)} ; rdfs:range ${typeIri(link.from)} .`)
  }

  const types = new Map(data.schema.objectTypes.map(t => [t.apiName, t]))
  const iriOf = new Map(data.objects.map(o => [o.id, `<${data.base}${o.type}/${local(o.key)}>`]))
  const evidenceOf = groupEvidence(data.evidence)
  for (const o of data.objects) {
    const type = types.get(o.type)
    if (!type) continue
    const parts = [`a ${typeIri(o.type)}`]
    for (const p of type.properties) {
      const value = o.properties[p.apiName]
      if (value === undefined || value === null) continue
      parts.push(`${propIri(o.type, p.apiName)} ${typed(value, p.type)}`)
    }
    for (const ev of evidenceOf.get(o.id) ?? []) parts.push(`prov:wasDerivedFrom ${evidenceNode(data.base, ev)}`)
    out.push('', `${iriOf.get(o.id)} ${parts.join(' ;\n  ')} .`)
  }
  for (const l of data.links) {
    const from = iriOf.get(l.fromId)
    const to = iriOf.get(l.toId)
    if (from && to) out.push(`${from} :${l.linkType} ${to} .`)
  }
  return out.join('\n') + '\n'
}

function typed(value: unknown, type: BaseType): string {
  if (type === 'integer' || type === 'number' || type === 'boolean') return String(value)
  return `${lit(String(value))}^^${XSD[type]}`
}

function evidenceNode(base: string, ev: EvidenceRecord): string {
  return `[ a prov:Entity ; prov:value ${lit(ev.quote)} ; prov:atLocation <${base}material/${ev.materialId}#char=${ev.start},${ev.end}> ; :evidenceRole ${lit(ev.role)}${ev.field ? ` ; :evidenceField ${lit(ev.field)}` : ''} ]`
}

function groupEvidence(evidence: EvidenceRecord[]) {
  const map = new Map<string, EvidenceRecord[]>()
  for (const ev of evidence) {
    if (!map.has(ev.targetId)) map.set(ev.targetId, [])
    map.get(ev.targetId)!.push(ev)
  }
  return map
}

export function toJsonLd(data: ExportData): Record<string, unknown> {
  const context: Record<string, unknown> = { '@vocab': data.base, ...PREFIXES }
  for (const type of data.schema.objectTypes) {
    for (const p of type.properties) context[`${type.apiName}.${p.apiName}`] = { '@id': `${data.base}${type.apiName}.${p.apiName}`, '@type': XSD[p.type].replace('xsd:', PREFIXES.xsd) }
  }
  for (const link of data.schema.linkTypes) context[link.apiName] = { '@id': `${data.base}${link.apiName}`, '@type': '@id' }
  const iriOf = new Map(data.objects.map(o => [o.id, `${data.base}${o.type}/${local(o.key)}`]))
  const evidenceOf = groupEvidence(data.evidence)
  const linksOf = new Map<string, LinkRecord[]>()
  for (const l of data.links) {
    if (!linksOf.has(l.fromId)) linksOf.set(l.fromId, [])
    linksOf.get(l.fromId)!.push(l)
  }
  const graph = data.objects.map(o => {
    const node: Record<string, unknown> = { '@id': iriOf.get(o.id), '@type': o.type }
    for (const [key, value] of Object.entries(o.properties)) if (value !== null && value !== undefined) node[`${o.type}.${key}`] = value
    for (const l of linksOf.get(o.id) ?? []) {
      const target = iriOf.get(l.toId)
      if (!target) continue
      node[l.linkType] = [...((node[l.linkType] as string[] | undefined) ?? []), target]
    }
    const ev = evidenceOf.get(o.id)
    if (ev) node['prov:wasDerivedFrom'] = ev.map(e => ({ 'prov:value': e.quote, 'prov:atLocation': `${data.base}material/${e.materialId}#char=${e.start},${e.end}`, evidenceRole: e.role, ...(e.field ? { evidenceField: e.field } : {}) }))
    return node
  })
  return { '@context': context, '@id': data.base, 'owl:versionInfo': String(data.version), '@graph': graph }
}
