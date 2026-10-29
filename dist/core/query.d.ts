/** ObjectSet queries: a small JSON DSL evaluated in memory, so the model never writes SQL. */
import type { LinkRecord, ObjectRecord, Status } from './store.js';
import type { OntologySchema } from './schema.js';
export type Filter = {
    and: Filter[];
} | {
    or: Filter[];
} | {
    not: Filter;
} | {
    property: string;
    op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in' | 'exists';
    value?: unknown;
};
export interface ObjectSetQuery {
    objectType: string;
    where?: Filter;
    /** Follow links by traversal name (`apiName` from the source side, `inverseApiName` from the target side). */
    traverse?: Array<{
        link: string;
        where?: Filter;
    }>;
    /** Defaults to confirmed only; include `candidate` to see the work in progress. */
    status?: Status[];
    limit?: number;
    aggregate?: {
        groupBy?: string;
        metric: 'count' | 'sum' | 'avg' | 'min' | 'max';
        property?: string;
    };
}
export interface QueryData {
    schema: OntologySchema;
    objects: ObjectRecord[];
    links: LinkRecord[];
}
export type QueryResult = {
    objectType: string;
    total: number;
    objects: ObjectRecord[];
} | {
    objectType: string;
    total: number;
    groups: Array<{
        key: unknown;
        value: number | null;
    }>;
};
export declare function runQuery(data: QueryData, query: ObjectSetQuery): QueryResult;
export declare function compileFilter(filter: Filter, props: Set<string>): (o: ObjectRecord) => boolean;
