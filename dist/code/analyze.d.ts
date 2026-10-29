import { type SymbolKind } from './languages.js';
export interface SourceFile {
    path: string;
    text: string;
}
export interface Span {
    start: number;
    end: number;
}
export interface CodeModuleInfo {
    path: string;
    language: string;
    lines: number;
    firstLine: Span | null;
}
export interface CodeSymbolInfo {
    qualifiedName: string;
    name: string;
    kind: SymbolKind;
    module: string;
    container: string | null;
    line: Span;
}
export interface ImportInfo {
    from: string;
    to: string;
    line: Span;
}
export interface CallInfo {
    from: string;
    to: string;
    line: Span;
}
export interface CodeGraph {
    modules: CodeModuleInfo[];
    symbols: CodeSymbolInfo[];
    imports: ImportInfo[];
    calls: CallInfo[];
    skipped: Array<{
        path: string;
        reason: string;
    }>;
}
export declare function analyze(files: SourceFile[]): Promise<CodeGraph>;
/** Resolve relative JS/TS specifiers and Python modules to scanned files; external packages are ignored. */
export declare function resolveImport(from: string, spec: string, language: string, paths: Set<string>): string | undefined;
