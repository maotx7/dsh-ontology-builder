/** Verbatim quote verification: the plugin, not the model, decides where a quote sits in the source. */
export const MAX_QUOTE_LENGTH = 2000;
/**
 * Find `quote` in `text`. Tries an exact match first, then tolerates collapsed
 * whitespace, then ignores whitespace entirely (line breaks inside CJK text
 * extracted from PDF/DOCX). Never matches on anything looser than that.
 * With `near`, an occurrence at or after that offset is preferred, so a quote
 * extracted from one chunk resolves to that chunk rather than an earlier repeat.
 */
export function findQuote(text, quote, near = 0) {
    const needle = quote.trim();
    if (!needle || needle.length > MAX_QUOTE_LENGTH)
        return undefined;
    const after = (at) => (at >= 0 ? at : undefined);
    const exact = after(text.indexOf(needle, near)) ?? text.indexOf(needle);
    if (exact >= 0)
        return { start: exact, end: exact + needle.length, line: lineAt(text, exact), mode: 'exact' };
    for (const mode of ['whitespace', 'compact']) {
        const haystack = normalize(text, mode);
        const target = normalize(needle, mode).text;
        const from = haystack.map.findIndex(i => i >= near);
        const at = !target ? -1 : (from >= 0 ? after(haystack.text.indexOf(target, from)) : undefined) ?? haystack.text.indexOf(target);
        if (at >= 0) {
            const start = haystack.map[at];
            const end = haystack.map[at + target.length - 1] + 1;
            return { start, end, line: lineAt(text, start), mode };
        }
    }
    return undefined;
}
/** Normalized text plus, for every normalized character, its index in the original. */
function normalize(text, mode) {
    let out = '';
    const map = [];
    for (let i = 0; i < text.length; i++) {
        if (/\s/u.test(text[i])) {
            if (mode === 'whitespace' && out.length && !out.endsWith(' ')) {
                out += ' ';
                map.push(i);
            }
            continue;
        }
        out += text[i];
        map.push(i);
    }
    if (out.endsWith(' ')) {
        out = out.slice(0, -1);
        map.pop();
    }
    return { text: out, map };
}
export function lineAt(text, offset) {
    let line = 1;
    for (let i = 0; i < offset; i++)
        if (text.charCodeAt(i) === 10)
            line++;
    return line;
}
/** Lines containing `query` (case-insensitive), for the agent to copy exact quotes from. */
export function searchLines(text, query, limit) {
    const needle = query.trim().toLowerCase();
    if (!needle)
        return [];
    const hits = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length && hits.length < limit; i++) {
        if (lines[i].toLowerCase().includes(needle))
            hits.push({ line: i + 1, text: lines[i].length > 500 ? lines[i].slice(0, 500) + '…' : lines[i] });
    }
    return hits;
}
