/** Entity resolution helpers: conservative key normalization and similarity for duplicate suggestions. */
/**
 * Canonical form used for automatic matching. Only differences that cannot
 * change identity are removed: Unicode width/compatibility forms, letter case
 * and whitespace. Anything looser is a suggestion for review, never a merge.
 */
export declare function normalizeKey(key: string): string;
/** Latin/digit words, plus character bigrams of CJK runs. */
export declare function tokens(value: string): Set<string>;
/** 0..1, the higher of edit-distance ratio and token Jaccard. */
export declare function similarity(a: string, b: string): number;
export interface Named {
    id: string;
    type: string;
    label: string;
}
export interface DuplicatePair {
    a: string;
    b: string;
    type: string;
    labels: [string, string];
    score: number;
}
/**
 * Pairs of same-type records whose labels look alike. Only pairs sharing a
 * token are compared (blocking), so cost grows with overlap, not n².
 */
export declare function suggestDuplicates(items: Named[], threshold: number, limit: number): DuplicatePair[];
