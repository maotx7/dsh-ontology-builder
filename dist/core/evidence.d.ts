/** Verbatim quote verification: the plugin, not the model, decides where a quote sits in the source. */
export type MatchMode = 'exact' | 'whitespace' | 'compact';
export interface QuoteMatch {
    start: number;
    end: number;
    /** 1-based line of `start`. */
    line: number;
    mode: MatchMode;
}
export declare const MAX_QUOTE_LENGTH = 2000;
/**
 * Find `quote` in `text`. Tries an exact match first, then tolerates collapsed
 * whitespace, then ignores whitespace entirely (line breaks inside CJK text
 * extracted from PDF/DOCX). Never matches on anything looser than that.
 * With `near`, an occurrence at or after that offset is preferred, so a quote
 * extracted from one chunk resolves to that chunk rather than an earlier repeat.
 */
export declare function findQuote(text: string, quote: string, near?: number): QuoteMatch | undefined;
export declare function lineAt(text: string, offset: number): number;
/** Lines containing `query` (case-insensitive), for the agent to copy exact quotes from. */
export declare function searchLines(text: string, query: string, limit: number): Array<{
    line: number;
    text: string;
}>;
