import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export declare const name = "ontology-builder";
export declare const inject: string[];
export interface Config {
    /** SQLite database file for ontology projects. Relative paths resolve against the DSH working directory. */
    databasePath: string;
    extraction: {
        /** Characters per chunk sent to the model. */
        chunkChars: number;
        /** Characters shared by consecutive chunks so facts on a boundary are not lost. */
        overlapChars: number;
        /** Model attempts per chunk, including corrections after validation errors. */
        maxAttempts: number;
        /** Chunks processed per ontology_extract call; the rest are reported for resuming. */
        maxChunks: number;
        /** Output token cap per model call. */
        maxTokens: number;
    };
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, config: Config): void;
