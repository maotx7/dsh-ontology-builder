import { type OntologySchema } from '../core/schema.js';
import type { EvidenceRole, LinkInput, ObjectInput } from '../core/store.js';
import type { Chunk } from './chunk.js';
export declare const PROMPT_VERSION = "extract-v1";
/** One model turn. `call` is the submitted arguments (already JSON-parsed) or undefined if the model did not call the tool. */
export interface ModelReply {
    call?: unknown;
    text: string;
}
export interface Turn {
    role: 'user' | 'assistant';
    text: string;
}
/** Provided by the host: run one model request with the given system prompt, conversation and single tool. */
export type ModelFn = (request: {
    system: string;
    turns: Turn[];
    tool: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
    signal?: AbortSignal;
}) => Promise<ModelReply>;
export interface ChunkResult {
    chunk: Chunk;
    objects: ObjectInput[];
    links: LinkInput[];
    attempts: number;
    /** Problems left in the final attempt; their items were dropped. */
    problems: string[];
    output: unknown;
}
export declare const SUBMIT_TOOL: {
    readonly name: "submit_extraction";
    readonly description: "Submit every object and link found in the text. Submit empty lists if there are none.";
    readonly parameters: {
        readonly type: "object";
        readonly additionalProperties: false;
        readonly required: readonly ["objects", "links"];
        readonly properties: {
            readonly objects: {
                readonly type: "array";
                readonly items: {
                    readonly type: "object";
                    readonly additionalProperties: false;
                    readonly required: readonly ["type", "properties", "quote"];
                    readonly properties: {
                        readonly type: {
                            readonly type: "string";
                            readonly description: "Object type apiName.";
                        };
                        readonly properties: {
                            readonly type: "object";
                            readonly description: "Values keyed by property apiName; include the primary key.";
                        };
                        readonly quote: {
                            readonly type: "string";
                            readonly description: "Exact text from the passage that states this object. Copy it character for character.";
                        };
                        readonly role: {
                            readonly type: "string";
                            readonly enum: EvidenceRole[];
                        };
                        readonly fieldQuotes: {
                            readonly type: "object";
                            readonly description: "Optional: property apiName -> exact text supporting that value.";
                        };
                    };
                };
            };
            readonly links: {
                readonly type: "array";
                readonly items: {
                    readonly type: "object";
                    readonly additionalProperties: false;
                    readonly required: readonly ["linkType", "from", "to", "quote"];
                    readonly properties: {
                        readonly linkType: {
                            readonly type: "string";
                        };
                        readonly from: {
                            readonly type: "object";
                            readonly required: readonly ["type", "key"];
                            readonly properties: {
                                readonly type: {
                                    readonly type: "string";
                                };
                                readonly key: {
                                    readonly description: "Primary key value.";
                                };
                            };
                        };
                        readonly to: {
                            readonly type: "object";
                            readonly required: readonly ["type", "key"];
                            readonly properties: {
                                readonly type: {
                                    readonly type: "string";
                                };
                                readonly key: {
                                    readonly description: "Primary key value.";
                                };
                            };
                        };
                        readonly quote: {
                            readonly type: "string";
                            readonly description: "Exact text from the passage that states this relationship.";
                        };
                        readonly role: {
                            readonly type: "string";
                            readonly enum: EvidenceRole[];
                        };
                    };
                };
            };
        };
    };
};
export declare function systemPrompt(schema: OntologySchema, instructions?: string): string;
/** Check one submission; returns usable items plus problems the model should fix. */
export declare function checkSubmission(schema: OntologySchema, chunk: Chunk, materialId: string, raw: unknown): {
    objects: ObjectInput[];
    links: LinkInput[];
    problems: string[];
};
/** Extract from one chunk, retrying with the validation errors until clean or out of attempts. */
export declare function extractChunk(opts: {
    model: ModelFn;
    schema: OntologySchema;
    chunk: Chunk;
    materialId: string;
    materialName: string;
    instructions?: string;
    maxAttempts: number;
    signal?: AbortSignal;
}): Promise<ChunkResult>;
