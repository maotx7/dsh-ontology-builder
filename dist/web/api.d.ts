import type { Store } from '../core/store.js';
export declare class ApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
/** Answer one API request. `endpoint` is the path below `/api/`. */
export declare function handleApi(store: Store, endpoint: string, params: URLSearchParams): unknown;
