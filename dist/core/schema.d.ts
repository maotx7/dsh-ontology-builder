/** Palantir-style ontology metamodel and its deterministic checks. */
export type BaseType = 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'datetime';
export type Cardinality = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
export type Priority = 'must' | 'should' | 'could';
export interface CompetencyQuestion {
    id: string;
    text: string;
    priority: Priority;
}
export interface PropertyDef {
    apiName: string;
    displayName?: string;
    description?: string;
    type: BaseType;
    required?: boolean;
    enum?: string[];
    pattern?: string;
}
export interface ObjectTypeDef {
    apiName: string;
    displayName?: string;
    description?: string;
    primaryKey: string;
    titleProperty?: string;
    properties: PropertyDef[];
    /** Competency question ids this type serves. */
    questions?: string[];
}
export interface LinkTypeDef {
    /** Traversal name on the `from` side, e.g. `employer` on Person. */
    apiName: string;
    /** Traversal name on the `to` side, e.g. `employees` on Company. */
    inverseApiName: string;
    from: string;
    to: string;
    cardinality: Cardinality;
    description?: string;
    questions?: string[];
}
export interface OntologySchema {
    questions: CompetencyQuestion[];
    objectTypes: ObjectTypeDef[];
    linkTypes: LinkTypeDef[];
}
export interface Issue {
    severity: 'blocking' | 'warning' | 'hint';
    code: string;
    path: string;
    message: string;
}
export declare const BASE_TYPES: readonly BaseType[];
export declare const CARDINALITIES: readonly Cardinality[];
export declare function emptySchema(): OntologySchema;
/** Coerce untrusted input into the schema shape; field-level problems are left for validateSchema. */
export declare function normalizeSchema(input: unknown): OntologySchema;
export declare function validateSchema(schema: OntologySchema): Issue[];
/** Check one object's property values against its type. MISSING_REQUIRED is a warning: a candidate may be incomplete, but it blocks confirmation. */
export declare function validateProperties(type: ObjectTypeDef, properties: Record<string, unknown>): Issue[];
