/**
 * Static code analysis into the code sub-ontology (modules, symbols, imports,
 * calls). Parsing is syntactic (tree-sitter): calls are resolved by name only,
 * and ambiguous names are left out rather than guessed.
 */
import { createRequire } from 'node:module';
import { dirname, join, normalize } from 'node:path';
import { languageOf } from './languages.js';
let runtime;
/** Load the optional tree-sitter runtime once. */
function loadRuntime() {
    runtime ??= (async () => {
        const require = createRequire(import.meta.url);
        let entry;
        try {
            entry = require.resolve('@vscode/tree-sitter-wasm');
        }
        catch {
            throw new Error('Code analysis needs the optional dependency @vscode/tree-sitter-wasm, which is not installed. Reinstall dsh-ontology-builder with optional dependencies enabled.');
        }
        const ts = require(entry);
        await ts.Parser.init();
        return { ts, dir: dirname(entry) };
    })();
    runtime.catch(() => { runtime = undefined; });
    return runtime;
}
const languages = new Map();
/** True when `node` sits inside a function-like definition (classes and other containers do not count). */
function insideDefinition(node, defs, key, containers) {
    for (let p = node.parent; p; p = p.parent)
        if (defs.has(key(p)) && !containers.includes(p.type))
            return true;
    return false;
}
/** Span of the line containing `index`, trimmed of surrounding whitespace and capped. */
function lineSpan(text, index, max = 200) {
    let start = text.lastIndexOf('\n', index - 1) + 1;
    let end = text.indexOf('\n', index);
    if (end < 0)
        end = text.length;
    while (start < end && /\s/.test(text[start]))
        start++;
    while (end > start && /\s/.test(text[end - 1]))
        end--;
    return { start, end: Math.min(end, start + max) };
}
function firstLine(text) {
    const m = /\S/.exec(text);
    return m ? lineSpan(text, m.index) : null;
}
export async function analyze(files) {
    const { ts, dir } = await loadRuntime();
    const graph = { modules: [], symbols: [], imports: [], calls: [], skipped: [] };
    const paths = new Set(files.map(f => f.path));
    const rawImports = [];
    const rawCalls = [];
    const parser = new ts.Parser();
    try {
        for (const file of files) {
            const lang = languageOf(file.path);
            if (!lang) {
                graph.skipped.push({ path: file.path, reason: 'unsupported language' });
                continue;
            }
            if (!languages.has(lang.id))
                languages.set(lang.id, ts.Language.load(join(dir, lang.wasm)));
            const language = await languages.get(lang.id);
            parser.setLanguage(language);
            const tree = parser.parse(file.text);
            if (!tree) {
                graph.skipped.push({ path: file.path, reason: 'parse failed' });
                continue;
            }
            try {
                graph.modules.push({ path: file.path, language: lang.id, lines: file.text.split('\n').length, firstLine: firstLine(file.text) });
                const defs = new Map();
                const key = (n) => `${n.startIndex}:${n.endIndex}:${n.type}`;
                const containerName = (n) => n.childForFieldName('name')?.text ?? n.childForFieldName('type')?.text ?? null;
                const query = (source) => {
                    const q = new ts.Query(language, source);
                    try {
                        return q.captures(tree.rootNode);
                    }
                    finally {
                        q.delete();
                    }
                };
                const matches = (source) => {
                    const q = new ts.Query(language, source);
                    try {
                        return q.matches(tree.rootNode);
                    }
                    finally {
                        q.delete();
                    }
                };
                const seen = new Set();
                for (const match of matches(lang.symbols)) {
                    const def = match.captures.find(c => c.name.startsWith('def.'));
                    const nameNode = match.captures.find(c => c.name === 'name')?.node;
                    if (!def || !nameNode)
                        continue;
                    const capture = def;
                    const node = def.node;
                    // Functions nested inside another definition belong to it; calls inside them count for the outer one.
                    if (insideDefinition(node, defs, key, lang.containers))
                        continue;
                    const containers = [];
                    for (let p = node.parent; p; p = p.parent)
                        if (lang.containers.includes(p.type)) {
                            const n = containerName(p);
                            if (n)
                                containers.unshift(n);
                        }
                    const container = containers.length ? containers.join('.') : null;
                    const qualifiedName = `${file.path}#${container ? `${container}.` : ''}${nameNode.text}`;
                    if (seen.has(qualifiedName))
                        continue;
                    seen.add(qualifiedName);
                    defs.set(key(node), qualifiedName);
                    graph.symbols.push({ qualifiedName, name: nameNode.text, kind: capture.name.slice(4), module: file.path, container, line: lineSpan(file.text, node.startIndex) });
                }
                for (const capture of query(lang.imports)) {
                    if (capture.name !== 'source')
                        continue;
                    rawImports.push({ module: file.path, spec: capture.node.text.replace(/^["'`]|["'`]$/g, ''), lang, line: lineSpan(file.text, capture.node.startIndex) });
                }
                for (const capture of query(lang.calls)) {
                    if (capture.name !== 'callee')
                        continue;
                    let caller;
                    for (let p = capture.node.parent; p && !caller; p = p.parent)
                        caller = defs.get(key(p));
                    if (caller)
                        rawCalls.push({ module: file.path, caller, name: capture.node.text, line: lineSpan(file.text, capture.node.startIndex) });
                }
            }
            finally {
                tree.delete();
            }
        }
    }
    finally {
        parser.delete();
    }
    const seenImports = new Set();
    for (const imp of rawImports) {
        const target = resolveImport(imp.module, imp.spec, imp.lang.id, paths);
        if (!target || target === imp.module || seenImports.has(`${imp.module}>${target}`))
            continue;
        seenImports.add(`${imp.module}>${target}`);
        graph.imports.push({ from: imp.module, to: target, line: imp.line });
    }
    const byName = new Map();
    for (const s of graph.symbols) {
        if (!byName.has(s.name))
            byName.set(s.name, []);
        byName.get(s.name).push(s);
    }
    const importsOf = new Map();
    for (const i of graph.imports) {
        if (!importsOf.has(i.from))
            importsOf.set(i.from, new Set());
        importsOf.get(i.from).add(i.to);
    }
    const seenCalls = new Set();
    for (const call of rawCalls) {
        const target = resolveCall(call, byName.get(call.name) ?? [], importsOf.get(call.module));
        if (!target || target === call.caller || seenCalls.has(`${call.caller}>${target}`))
            continue;
        seenCalls.add(`${call.caller}>${target}`);
        graph.calls.push({ from: call.caller, to: target, line: call.line });
    }
    return graph;
}
/** Same module first, then modules it imports, then a project-wide unique name. Otherwise unresolved. */
function resolveCall(call, candidates, imported) {
    const pick = (list) => (list.length === 1 ? list[0].qualifiedName : undefined);
    const local = candidates.filter(c => c.module === call.module);
    if (local.length)
        return pick(local);
    const viaImport = candidates.filter(c => imported?.has(c.module));
    if (viaImport.length)
        return pick(viaImport);
    return pick(candidates);
}
const JS_EXT = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
/** Resolve relative JS/TS specifiers and Python modules to scanned files; external packages are ignored. */
export function resolveImport(from, spec, language, paths) {
    const base = dirname(from);
    const first = (candidates) => candidates.map(c => normalize(c).replace(/\\/g, '/')).find(c => paths.has(c));
    if (language === 'typescript' || language === 'tsx' || language === 'javascript') {
        if (!spec.startsWith('.'))
            return undefined;
        const raw = join(base, spec);
        const stem = raw.replace(/\.(m|c)?jsx?$/, '');
        return first([raw, ...JS_EXT.map(e => stem + e), ...JS_EXT.map(e => join(raw, 'index' + e))]);
    }
    if (language === 'python') {
        const dots = /^\.*/.exec(spec)[0].length;
        const rest = spec.slice(dots).replace(/\./g, '/');
        let root = base;
        for (let i = 1; i < dots; i++)
            root = dirname(root);
        const roots = dots ? [root] : ['.', ...new Set([...paths].map(p => p.split('/')[0]))];
        return first(roots.flatMap(r => (rest ? [join(r, rest + '.py'), join(r, rest, '__init__.py')] : [join(r, '__init__.py')])));
    }
    return undefined;
}
