/** Palantir-style ontology metamodel and its deterministic checks. */

export type BaseType = 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'datetime'
export type Cardinality = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many'
export type Priority = 'must' | 'should' | 'could'

export interface CompetencyQuestion { id: string; text: string; priority: Priority }

export interface PropertyDef {
  apiName: string
  displayName?: string
  description?: string
  type: BaseType
  required?: boolean
  enum?: string[]
  pattern?: string
}

export interface ObjectTypeDef {
  apiName: string
  displayName?: string
  description?: string
  primaryKey: string
  titleProperty?: string
  properties: PropertyDef[]
  /** Competency question ids this type serves. */
  questions?: string[]
}

export interface LinkTypeDef {
  /** Traversal name on the `from` side, e.g. `employer` on Person. */
  apiName: string
  /** Traversal name on the `to` side, e.g. `employees` on Company. */
  inverseApiName: string
  from: string
  to: string
  cardinality: Cardinality
  description?: string
  questions?: string[]
}

export interface OntologySchema {
  questions: CompetencyQuestion[]
  objectTypes: ObjectTypeDef[]
  linkTypes: LinkTypeDef[]
}

export interface Issue { severity: 'blocking' | 'warning' | 'hint'; code: string; path: string; message: string }

export const BASE_TYPES: readonly BaseType[] = ['string', 'integer', 'number', 'boolean', 'date', 'datetime']
export const CARDINALITIES: readonly Cardinality[] = ['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many']
const PRIORITIES: readonly Priority[] = ['must', 'should', 'could']
const API_NAME = /^[A-Za-z][A-Za-z0-9_]*$/
/** Names too generic to carry meaning as a type (OOPS! "overly general class"). */
const GENERIC_NAMES = new Set(['thing', 'object', 'entity', 'data', 'hint', 'information', 'item', 'record', 'node', 'element', 'stuff', '事物', '东西', '对象', '实体', '数据', '信息', '项目项', '记录'])

export function emptySchema(): OntologySchema {
  return { questions: [], objectTypes: [], linkTypes: [] }
}

/** Coerce untrusted input into the schema shape; field-level problems are left for validateSchema. */
export function normalizeSchema(input: unknown): OntologySchema {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const list = (key: string) => (Array.isArray(value[key]) ? value[key] as unknown[] : []).map(item => (item && typeof item === 'object' ? item : {}))
  return {
    questions: list('questions') as CompetencyQuestion[],
    objectTypes: (list('objectTypes') as ObjectTypeDef[]).map(type => ({ ...type, properties: (Array.isArray(type.properties) ? type.properties : []).map(p => (p && typeof p === 'object' ? p : {}) as PropertyDef) })),
    linkTypes: list('linkTypes') as LinkTypeDef[]
  }
}

export function validateSchema(schema: OntologySchema): Issue[] {
  const issues: Issue[] = []
  const add = (severity: Issue['severity'], code: string, path: string, message: string) => issues.push({ severity, code, path, message })

  if (!schema.questions.length) add('warning', 'NO_QUESTIONS', 'questions', 'Record the competency questions this ontology must answer before modelling types.')
  const questions = new Map<string, CompetencyQuestion>()
  schema.questions.forEach((question, i) => {
    const path = `questions[${i}]`
    if (typeof question.id !== 'string' || !question.id.trim()) add('blocking', 'INVALID_QUESTION_ID', path, 'Question needs a non-empty string id.')
    else if (questions.has(question.id)) add('blocking', 'DUPLICATE_QUESTION', path, `Duplicate question id "${question.id}".`)
    else questions.set(question.id, question)
    if (typeof question.text !== 'string' || !question.text.trim()) add('blocking', 'EMPTY_QUESTION', path, 'Question text is empty.')
    if (!PRIORITIES.includes(question.priority)) add('blocking', 'INVALID_PRIORITY', path, `Priority must be one of ${PRIORITIES.join(', ')}.`)
  })
  const servedQuestions = new Set<string>()
  const checkQuestionRefs = (refs: unknown, path: string) => {
    for (const id of Array.isArray(refs) ? refs : []) {
      if (questions.has(id)) servedQuestions.add(id)
      else add('blocking', 'UNKNOWN_QUESTION', path, `References unknown question "${id}".`)
    }
  }

  const types = new Map<string, ObjectTypeDef>()
  const caseFolded = new Map<string, string>()
  /** Property and link traversal names per type; they share one namespace on the object. */
  const members = new Map<string, Set<string>>()
  schema.objectTypes.forEach((type, i) => {
    const path = `objectTypes[${i}]`
    if (typeof type.apiName !== 'string' || !API_NAME.test(type.apiName)) return add('blocking', 'INVALID_API_NAME', path, `Object type apiName "${type.apiName}" must match ${API_NAME}.`)
    if (types.has(type.apiName)) return add('blocking', 'DUPLICATE_OBJECT_TYPE', path, `Duplicate object type "${type.apiName}".`)
    const folded = type.apiName.toLowerCase()
    if (caseFolded.has(folded)) add('warning', 'SIMILAR_OBJECT_TYPE', path, `"${type.apiName}" differs from "${caseFolded.get(folded)}" only by case.`)
    caseFolded.set(folded, type.apiName)
    types.set(type.apiName, type)
    if (GENERIC_NAMES.has(folded) || GENERIC_NAMES.has(String(type.displayName ?? '').trim().toLowerCase())) add('warning', 'GENERIC_TYPE_NAME', path, `"${type.displayName ?? type.apiName}" is too generic to be a useful type; name what it actually is.`)

    const props = new Map<string, PropertyDef>()
    type.properties.forEach((prop, j) => {
      const propPath = `${path}.properties[${j}]`
      if (typeof prop.apiName !== 'string' || !API_NAME.test(prop.apiName)) return add('blocking', 'INVALID_API_NAME', propPath, `Property apiName "${prop.apiName}" must match ${API_NAME}.`)
      if (props.has(prop.apiName)) return add('blocking', 'DUPLICATE_PROPERTY', propPath, `Duplicate property "${prop.apiName}" on ${type.apiName}.`)
      props.set(prop.apiName, prop)
      if (!BASE_TYPES.includes(prop.type)) add('blocking', 'INVALID_PROPERTY_TYPE', propPath, `Property type must be one of ${BASE_TYPES.join(', ')}.`)
      if (prop.enum !== undefined) {
        if (prop.type !== 'string') add('blocking', 'ENUM_REQUIRES_STRING', propPath, 'Only string properties can declare enum values.')
        else if (!Array.isArray(prop.enum) || !prop.enum.length || prop.enum.some(v => typeof v !== 'string')) add('blocking', 'INVALID_ENUM', propPath, 'enum must be a non-empty list of strings.')
      }
      if (prop.pattern !== undefined) {
        try { new RegExp(prop.pattern, 'u') } catch { add('blocking', 'INVALID_PATTERN', propPath, `pattern "${prop.pattern}" is not a valid regular expression.`) }
      }
    })
    members.set(type.apiName, new Set(props.keys()))
    const pk = props.get(type.primaryKey)
    if (!pk) add('blocking', 'MISSING_PRIMARY_KEY', path, `primaryKey "${type.primaryKey}" is not a property of ${type.apiName}.`)
    else if (pk.type !== 'string' && pk.type !== 'integer') add('blocking', 'INVALID_PRIMARY_KEY_TYPE', path, 'primaryKey must be a string or integer property.')
    if (type.titleProperty !== undefined && !props.has(type.titleProperty)) add('blocking', 'MISSING_TITLE_PROPERTY', path, `titleProperty "${type.titleProperty}" is not a property of ${type.apiName}.`)
    if (props.size <= 1) add('hint', 'NO_DESCRIPTIVE_PROPERTIES', path, `${type.apiName} has no properties besides its key; confirm it is a type and not a value.`)
    checkQuestionRefs(type.questions, path)
    if (questions.size && !(Array.isArray(type.questions) && type.questions.length)) add('warning', 'UNTRACED_TYPE', path, `${type.apiName} is not linked to any competency question.`)
  })

  const linkNames = new Set<string>()
  const claim = (typeName: string, member: string, path: string) => {
    const names = members.get(typeName)
    if (!names) return
    if (names.has(member)) add('blocking', 'DUPLICATE_MEMBER', path, `"${member}" is already a property or link name on ${typeName}.`)
    names.add(member)
  }
  schema.linkTypes.forEach((link, i) => {
    const path = `linkTypes[${i}]`
    if (typeof link.apiName !== 'string' || !API_NAME.test(link.apiName)) return add('blocking', 'INVALID_API_NAME', path, `Link apiName "${link.apiName}" must match ${API_NAME}.`)
    if (typeof link.inverseApiName !== 'string' || !API_NAME.test(link.inverseApiName)) return add('blocking', 'INVALID_API_NAME', path, `Link inverseApiName "${link.inverseApiName}" must match ${API_NAME}.`)
    if (linkNames.has(link.apiName)) return add('blocking', 'DUPLICATE_LINK_TYPE', path, `Duplicate link type "${link.apiName}".`)
    linkNames.add(link.apiName)
    if (!types.has(link.from)) add('blocking', 'UNKNOWN_LINK_ENDPOINT', path, `from "${link.from}" is not an object type.`)
    if (!types.has(link.to)) add('blocking', 'UNKNOWN_LINK_ENDPOINT', path, `to "${link.to}" is not an object type.`)
    if (!CARDINALITIES.includes(link.cardinality)) add('blocking', 'INVALID_CARDINALITY', path, `cardinality must be one of ${CARDINALITIES.join(', ')}.`)
    claim(link.from, link.apiName, path)
    claim(link.to, link.inverseApiName, path)
    checkQuestionRefs(link.questions, path)
  })

  for (const question of questions.values()) {
    if (servedQuestions.has(question.id)) continue
    if (question.priority === 'must') add('warning', 'UNCOVERED_QUESTION', `questions.${question.id}`, `Must-have question "${question.text}" is not served by any type or link.`)
    else add('hint', 'UNCOVERED_QUESTION', `questions.${question.id}`, `Question "${question.text}" is not served by any type or link yet.`)
  }
  return issues
}

/** Check one object's property values against its type. MISSING_REQUIRED is a warning: a candidate may be incomplete, but it blocks confirmation. */
export function validateProperties(type: ObjectTypeDef, properties: Record<string, unknown>): Issue[] {
  const issues: Issue[] = []
  const defs = new Map(type.properties.map(p => [p.apiName, p]))
  for (const [key, value] of Object.entries(properties)) {
    const def = defs.get(key)
    if (!def) { issues.push({ severity: 'blocking', code: 'UNKNOWN_PROPERTY', path: key, message: `${type.apiName} has no property "${key}".` }); continue }
    if (value === null || value === undefined) continue
    const problem = valueProblem(def, value)
    if (problem) issues.push({ severity: 'blocking', code: 'INVALID_VALUE', path: key, message: problem })
  }
  for (const def of type.properties) {
    if (def.required && (properties[def.apiName] === undefined || properties[def.apiName] === null)) issues.push({ severity: 'warning', code: 'MISSING_REQUIRED', path: def.apiName, message: `Required property "${def.apiName}" is missing.` })
  }
  if (properties[type.primaryKey] === undefined || properties[type.primaryKey] === null || properties[type.primaryKey] === '') issues.push({ severity: 'blocking', code: 'MISSING_PRIMARY_KEY', path: type.primaryKey, message: `Primary key "${type.primaryKey}" is missing.` })
  return issues
}

function valueProblem(def: PropertyDef, value: unknown): string | undefined {
  switch (def.type) {
    case 'string':
      if (typeof value !== 'string') return `${def.apiName} must be a string.`
      if (def.enum && !def.enum.includes(value)) return `${def.apiName} must be one of ${def.enum.join(', ')}.`
      if (def.pattern && !new RegExp(def.pattern, 'u').test(value)) return `${def.apiName} does not match ${def.pattern}.`
      return
    case 'integer': return Number.isInteger(value) ? undefined : `${def.apiName} must be an integer.`
    case 'number': return typeof value === 'number' && Number.isFinite(value) ? undefined : `${def.apiName} must be a finite number.`
    case 'boolean': return typeof value === 'boolean' ? undefined : `${def.apiName} must be a boolean.`
    case 'date': return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? undefined : `${def.apiName} must be a date (YYYY-MM-DD).`
    case 'datetime': return typeof value === 'string' && value.includes('T') && !Number.isNaN(Date.parse(value)) ? undefined : `${def.apiName} must be an ISO 8601 datetime.`
  }
}
