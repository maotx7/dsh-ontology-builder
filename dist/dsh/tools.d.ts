import { type OntologySchema } from '../core/schema.js';
import type { Store } from '../core/store.js';
import { type ModelFn } from '../extract/extract.js';
/** The parts of a DSH tool execution this plugin uses. */
export interface Exec {
    agent?: unknown;
    callId?: string;
    signal?: AbortSignal;
}
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';
export interface Approval {
    request(req: {
        agent: unknown;
        toolName: string;
        callId?: string;
        reason?: string;
        signal?: AbortSignal;
    }): Promise<ApprovalOutcome>;
}
export interface ToolSpec {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute(args: any, exec: Exec): Promise<unknown>;
    /** Cooperative deadline enforced by DSH; omitted means none. */
    timeoutMs?: number;
}
export interface ToolEnv {
    store: () => Store;
    approval: Approval;
    /** The configured DSH model, or undefined when the host has no LLM service. */
    model?: ModelFn & {
        selection(): {
            provider: string;
            model: string;
        };
    };
    extraction: {
        chunkChars: number;
        overlapChars: number;
        maxAttempts: number;
        maxChunks: number;
    };
    /** Directory that file paths resolve against and must stay inside. */
    workspace: string;
}
export declare function createTools(env: ToolEnv): ToolSpec[];
/** Names added, removed or changed between two schemas, plus a one-line summary for approval prompts. */
export declare function diffSchemas(before: OntologySchema | undefined, after: OntologySchema): {
    objectTypes: {
        added: string[];
        removed: string[];
        changed: string[];
    };
    linkTypes: {
        added: string[];
        removed: string[];
        changed: string[];
    };
    summary: string;
};
