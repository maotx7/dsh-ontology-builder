/** Adapt DSH's `ctx.llm.stream` to the extractor's ModelFn, using the model the user already configured. */
import type { ModelFn } from '../extract/extract.js';
export interface ModelSelection {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
type Chunk = {
    type: 'text-delta';
    index: number;
    text: string;
} | {
    type: 'tool-call-delta';
    index: number;
    id: string;
    name?: string;
    argumentsDelta: string;
} | {
    type: 'block-end';
    index: number;
    block: {
        type: string;
        name?: string;
        arguments?: string;
        text?: string;
    };
} | {
    type: 'finish';
    reason: {
        kind: string;
        failure?: {
            message: string;
            code: string;
        };
    };
} | {
    type: string;
};
export interface Llm {
    stream(options: Record<string, unknown>): AsyncIterable<Chunk>;
}
/**
 * Prior attempts are replayed as user turns rather than synthetic assistant
 * and tool messages: one-shot requests may only carry identity-free user input.
 */
export declare function createModel(llm: Llm, select: () => ModelSelection, maxTokens: number): ModelFn & {
    selection: () => ModelSelection;
};
export {};
