import { DatabaseSync } from 'node:sqlite';
import type { CodeGraph } from '../code/analyze.js';
import { type Filter, type ObjectSetQuery } from './query.js';
import { type Issue, type OntologySchema } from './schema.js';
export type Status = 'candidate' | 'confirmed' | 'rejected';
export type EvidenceRole = 'specified' | 'observed' | 'correspondence' | 'inferred';
export declare const EVIDENCE_ROLES: readonly EvidenceRole[];
/** Proof that a person allowed a state change. Every confirmation and publication stores one. */
export interface Authorization {
    kind: 'approval';
    outcome: 'allowed-once';
    /** Tool call the approval was asked for. */
    toolCallId?: string;
    /** What the user was shown when asked. */
    reason: string;
}
/** Confirmation by a rule the user approved; carries that approval. */
export interface RuleAuthorization {
    kind: 'rule';
    ruleId: string;
    approval: Authorization;
}
export interface RuleDefinition {
    name: string;
    objectType?: string;
    linkType?: string;
    /** Only evidence from batches with one of these extractors counts; omit for any. */
    extractors?: string[];
    /** Evidence roles that count; `inferred` is not allowed. */
    roles: EvidenceRole[];
    minEvidence: number;
    /** Distinct materials the qualifying evidence must come from. */
    minSources: number;
    where?: Filter;
    /** Fraction of rule confirmations put aside for human spot checks. */
    sampleRate: number;
    /** The rule disables itself when spot-check accuracy falls below this... */
    minAccuracy: number;
    /** ...once at least this many samples have been judged. */
    minSamples: number;
}
export interface Rule {
    id: string;
    definition: RuleDefinition;
    status: 'active' | 'disabled';
    disabledReason: string | null;
    createdAt: string;
}
export interface RuleStats {
    confirmed: number;
    samples: number;
    judged: number;
    correct: number;
    accuracy: number | null;
}
export interface ExtractionRun {
    materialId: string;
    chunkStart: number;
    chunkEnd: number;
    chunkSha256: string;
    promptVersion: string;
    provider: string;
    model: string;
    attempts: number;
    output: unknown;
    problems: unknown;
}
export interface QuestionExpectation {
    minResults: number;
    includes?: string[];
}
export interface QuestionResult {
    questionId: string;
    text: string;
    priority: string;
    status: 'pass' | 'fail' | 'error' | 'no-query';
    total?: number;
    missing?: string[];
    error?: string;
    regression: boolean;
}
export interface Conflict {
    field: string;
    kept: unknown;
    other: unknown;
    batchId: string | null;
}
export interface Project {
    id: string;
    name: string;
    description: string;
    createdAt: string;
}
export interface SchemaVersion {
    version: number;
    schema: OntologySchema;
    hash: string;
    note: string;
    createdAt: string;
}
export interface Material {
    id: string;
    name: string;
    sha256: string;
    text: string;
    createdAt: string;
}
export interface ObjectRecord {
    id: string;
    type: string;
    key: string;
    properties: Record<string, unknown>;
    status: Status;
    batchId: string;
}
export interface LinkRecord {
    id: string;
    linkType: string;
    fromId: string;
    toId: string;
    status: Status;
    batchId: string;
}
export interface EvidenceRecord {
    id: string;
    targetId: string;
    field: string | null;
    materialId: string;
    start: number;
    end: number;
    line: number;
    quote: string;
    match: string;
    role: EvidenceRole;
    batchId: string;
}
export interface EvidenceInput {
    materialId: string;
    quote: string;
    field?: string;
    role?: EvidenceRole;
    /** Prefer an occurrence at or after this offset (the chunk the quote was extracted from). */
    near?: number;
}
export interface ObjectInput {
    type: string;
    properties: Record<string, unknown>;
    evidence: EvidenceInput[];
}
export interface ObjectRef {
    type: string;
    key: string | number;
}
export interface LinkInput {
    linkType: string;
    from: ObjectRef;
    to: ObjectRef;
    evidence: EvidenceInput[];
}
export interface ItemResult {
    index: number;
    outcome: 'created' | 'merged' | 'failed';
    id?: string;
    issues: Issue[];
}
export interface AssertResult {
    batchId: string;
    schemaVersion: number;
    objects: ItemResult[];
    links: ItemResult[];
}
export interface ConfirmPreview {
    ready: string[];
    blocked: Array<{
        id: string;
        issues: Issue[];
    }>;
}
export declare const sha256: (text: string) => string;
/** JSON with sorted object keys, so equal schemas hash equally. */
export declare function canonicalJson(value: unknown): string;
export declare class Store {
    readonly db: DatabaseSync;
    constructor(path: string);
    close(): void;
    private tx;
    private get;
    private all;
    private run;
    private audit;
    createProject(name: string, description?: string): Project;
    listProjects(): Project[];
    /** Resolve a project by id or name. */
    project(idOrName: string): Project;
    draft(projectId: string): OntologySchema;
    /** Replace the working draft. Drafts may contain issues; publishing may not. */
    setDraft(projectId: string, input: unknown): {
        schema: OntologySchema;
        issues: Issue[];
    };
    published(projectId: string): SchemaVersion | undefined;
    /** Checks that decide whether the draft may be published; empty `blocking` means it may. */
    publishCheck(projectId: string, note?: string): {
        blocking: Issue[];
        warnings: Issue[];
        hash: string;
        unchanged: boolean;
    };
    publish(projectId: string, note: string, auth: Authorization): SchemaVersion;
    /** Store source text. Identical content is stored once and keeps its first id. */
    addMaterial(projectId: string, name: string, text: string): {
        material: Material;
        created: boolean;
    };
    material(projectId: string, id: string): Material;
    listMaterials(projectId: string): Array<Omit<Material, 'text'> & {
        length: number;
    }>;
    /**
     * Record extracted objects and links as candidates in one batch, checked
     * against the latest published schema. Every item needs at least one quote
     * that is found verbatim in a stored material; items failing any check are
     * reported and not stored. Nothing here can produce a confirmed record.
     */
    assertCandidates(projectId: string, extractor: string, input: {
        objects?: ObjectInput[];
        links?: LinkInput[];
    }, runs?: ExtractionRun[]): AssertResult;
    private assertObject;
    private assertLink;
    /** Locate each quote in its material. Unlocatable quotes are blocking: the model may not cite text that is not there. */
    private checkEvidence;
    private insertEvidence;
    /** Look an object up by exact key, then by normalized key or a recorded alias. */
    private findObject;
    private addConflict;
    /** Open value conflicts, optionally for one record. */
    conflicts(projectId: string, targetId?: string): Array<Conflict & {
        id: string;
        targetId: string;
    }>;
    /** Settle one conflict by keeping the current value or taking the other. */
    resolveConflict(projectId: string, conflictId: string, choice: 'kept' | 'other', auth: Authorization): {
        conflictId: string;
        choice: "other" | "kept";
    };
    /** Similar-looking same-type objects, excluding pairs the user said are distinct. */
    duplicates(projectId: string, opts: {
        type?: string;
        threshold: number;
        limit: number;
    }): import("./resolve.js").DuplicatePair[];
    markDistinct(projectId: string, a: string, b: string): void;
    /**
     * Merge `dropId` into `keepId`: evidence and links move over, missing values
     * are filled in and differing ones become conflicts, and the dropped key is
     * kept as an alias so later batches resolve to the survivor.
     */
    mergeObjects(projectId: string, keepId: string, dropId: string, auth: Authorization): {
        keepId: string;
        dropId: string;
        alias: string;
        conflicts: number;
        droppedLinks: number;
    };
    /**
     * Store one code analysis. Each source file becomes a read-only material, so
     * code facts carry the same verifiable evidence as document facts. Snapshots
     * are append-only; the latest one is what queries and checks use.
     */
    addCodeSnapshot(projectId: string, root: string, files: Array<{
        path: string;
        text: string;
    }>, graph: CodeGraph): {
        snapshotId: string;
        materials: {
            created: number;
            reused: number;
        };
        stats: Record<string, number>;
    };
    latestSnapshot(projectId: string): {
        id: string;
        root: string;
        createdAt: string;
        stats: Record<string, number>;
    } | undefined;
    private codeRefExists;
    /** Code element in the latest snapshot, with the material and span that prove it exists. */
    codeElement(projectId: string, ref: string): {
        ref: string;
        kind: string;
        module: string;
        materialId: string;
        start: number;
        end: number;
        line: number;
    } | undefined;
    /** Search the latest snapshot's symbols by name fragment. */
    searchCode(projectId: string, query: {
        text?: string;
        kind?: string;
        module?: string;
        limit: number;
    }): {
        snapshotId: string;
        symbols: {
            ref: string;
            name: string;
            kind: string;
            module: string;
            container: string | null;
            line: number;
        }[];
    };
    /** Imports/calls touching one code element, in either direction. */
    codeNeighbors(projectId: string, ref: string, limit: number): {
        outgoing: {
            kind: string;
            source: string;
            target: string;
            line: number;
        }[];
        incoming: {
            kind: string;
            source: string;
            target: string;
            line: number;
        }[];
    };
    /**
     * Propose links from ontology objects to code elements. The evidence is the
     * code itself (role `observed`), located in the file's material. The link
     * stays a candidate until reviewed like any other.
     */
    assertCodeLinks(projectId: string, extractor: string, items: Array<{
        objectId: string;
        codeRef: string;
        relation: string;
        quote?: string;
        evidence?: EvidenceInput[];
    }>): {
        batchId: string;
        results: ItemResult[];
    };
    codeLinks(projectId: string, filter?: {
        objectId?: string;
        status?: Status[];
    }): Array<{
        id: string;
        objectId: string;
        codeRef: string;
        relation: string;
        status: Status;
        batchId: string;
        stale: boolean;
    }>;
    /** Save the ObjectSet query that answers a competency question, and what counts as answered. */
    setQuestionQuery(projectId: string, questionId: string, query: ObjectSetQuery, expect: QuestionExpectation): void;
    /**
     * Run every saved question query against confirmed data and record the
     * outcome. A question that passed in its previous run and fails now is a
     * regression.
     */
    runQuestions(projectId: string): QuestionResult[];
    /** Problems left after the final attempt of every logged extraction chunk. */
    droppedByValidation(projectId: string): number;
    /** Store a rule the user approved. A rule only ever widens confirmation; it cannot skip the confirm checks. */
    addRule(projectId: string, definition: RuleDefinition, auth: Authorization): Rule;
    ruleProblems(projectId: string, d: RuleDefinition): string[];
    rule(projectId: string, id: string): Rule;
    rules(projectId: string): Array<Rule & {
        stats: RuleStats;
    }>;
    ruleStats(ruleId: string): RuleStats;
    disableRule(projectId: string, id: string, reason: string): void;
    /** Candidates an active rule would confirm now: they match the rule and pass every confirm check. */
    ruleMatches(projectId: string, ruleId: string): ConfirmPreview;
    /** What a (possibly not yet approved) rule definition would confirm right now. */
    matchDefinition(projectId: string, d: RuleDefinition): ConfirmPreview;
    /**
     * Confirm what an active rule matches. Authorization is the rule's own
     * stored approval. A deterministic share of confirmations is queued for
     * spot checks; a rule whose judged accuracy falls below its bar disables itself.
     */
    applyRule(projectId: string, ruleId: string): {
        confirmed: string[];
        sampled: string[];
        blocked: ConfirmPreview['blocked'];
    };
    /** Spot checks waiting for a human verdict. */
    pendingSamples(projectId: string, ruleId?: string): Array<{
        ruleId: string;
        targetId: string;
    }>;
    /**
     * Record a spot-check verdict. A wrong record goes back to candidate; the
     * rule is disabled once its accuracy over judged samples is too low.
     */
    judgeSample(projectId: string, ruleId: string, targetId: string, verdict: 'correct' | 'wrong', note: string, auth: Authorization): {
        verdict: "correct" | "wrong";
        stats: RuleStats;
        disabled: boolean;
    };
    private cardinalityIssues;
    /**
     * Which of `ids` may be confirmed right now. An object needs valid values
     * under the latest schema, all required properties, and at least one
     * non-inferred quote. A link additionally needs both endpoints confirmed (or
     * confirmed in the same call) and must respect cardinality among confirmed links.
     */
    previewConfirm(projectId: string, ids: string[]): ConfirmPreview;
    /** Confirm the ready subset of `ids`; blocked ones are returned untouched. */
    confirm(projectId: string, ids: string[], auth: Authorization): ConfirmPreview;
    /** Reject candidates. Rejected keys are remembered so later batches cannot re-add them silently. */
    reject(projectId: string, ids: string[], note: string, auth: Authorization): {
        rejected: string[];
        skipped: string[];
    };
    private setStatus;
    /**
     * Undo a batch: delete the candidates it created and the evidence it added.
     * Refused when the batch touched anything already confirmed, or when later
     * batches link to objects it created.
     */
    rollbackBatch(projectId: string, batchId: string): {
        objects: number;
        links: number;
        evidence: number;
    };
    objects(projectId: string, filter?: {
        type?: string;
        status?: Status[];
    }): ObjectRecord[];
    links(projectId: string, filter?: {
        linkType?: string;
        status?: Status[];
    }): LinkRecord[];
    evidence(projectId: string, targetId: string): EvidenceRecord[];
    /** Every evidence span cited from one material with its target's status, for reading the material with extractions highlighted. */
    materialEvidence(projectId: string, materialId: string): Array<EvidenceRecord & {
        status: Status;
    }>;
    /** Published schema versions, oldest first. */
    schemaVersions(projectId: string): SchemaVersion[];
    auditLog(projectId: string, limit?: number): Array<{
        seq: number;
        at: string;
        action: string;
        detail: unknown;
    }>;
}
