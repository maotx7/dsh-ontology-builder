/** Tree-sitter grammars and queries for the built-in code sub-ontology. */
export type SymbolKind = 'class' | 'interface' | 'type' | 'enum' | 'function' | 'method';
export interface LanguageSpec {
    id: string;
    /** Grammar file in @vscode/tree-sitter-wasm/wasm. */
    wasm: string;
    /** Captures: @name plus @def.<kind> on the defining node. */
    symbols: string;
    /** Captures: @source (module specifier, quotes allowed). */
    imports: string;
    /** Captures: @callee (called name). */
    calls: string;
    /** Node types whose `name` field (or custom lookup) makes them a container for nested definitions. */
    containers: string[];
}
export declare const LANGUAGES: Record<string, LanguageSpec>;
export declare function languageOf(path: string): LanguageSpec | undefined;
