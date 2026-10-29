/**
 * Quality report over the latest published version. Layers 1–4 are
 * deterministic checks; 5 runs the saved competency-question queries; 6
 * summarizes extraction quality from human review. No number here comes from
 * the model's own confidence.
 */
import type { Issue } from './schema.js';
import type { QuestionResult, Store } from './store.js';
export interface QualityReport {
    schemaVersion: number;
    generatedAt: string;
    summary: {
        blocking: number;
        warnings: number;
        hints: number;
        ready: boolean;
    };
    structure: Issue[];
    logic: Issue[];
    evidence: Issue[];
    smells: Issue[];
    questions: {
        issues: Issue[];
        results: QuestionResult[];
        mustAnswered: number;
        mustTotal: number;
        regressions: string[];
    };
    extraction: {
        candidates: number;
        confirmed: number;
        rejected: number;
        /** Reviewed share that was confirmed rather than rejected. */
        reviewAcceptance: number | null;
        rules: Array<{
            id: string;
            name: string;
            status: string;
            confirmed: number;
            judged: number;
            accuracy: number | null;
        }>;
        /** Items models submitted that failed validation, from the extraction log. */
        droppedByValidation: number;
        codeLinks: {
            candidate: number;
            confirmed: number;
            stale: number;
        };
    };
    method: string;
}
export declare function qualityReport(store: Store, projectId: string): QualityReport;
