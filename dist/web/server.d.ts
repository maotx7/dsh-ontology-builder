import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Store } from '../core/store.js';
export declare const UI_PATH = "/ontology";
export interface UiHandlerOptions {
    store: () => Store;
    /** Directory holding the built UI (index.html and assets). */
    uiDir: string;
    /** Returns an HTTP status when the request must be refused, undefined when it may proceed. */
    reject: (req: IncomingMessage) => number | undefined;
}
export declare function createUiHandler({ store, uiDir, reject }: UiHandlerOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
