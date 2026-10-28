/** Tree-sitter grammars and queries for the built-in code sub-ontology. */

export type SymbolKind = 'class' | 'interface' | 'type' | 'enum' | 'function' | 'method'

export interface LanguageSpec {
  id: string
  /** Grammar file in @vscode/tree-sitter-wasm/wasm. */
  wasm: string
  /** Captures: @name plus @def.<kind> on the defining node. */
  symbols: string
  /** Captures: @source (module specifier, quotes allowed). */
  imports: string
  /** Captures: @callee (called name). */
  calls: string
  /** Node types whose `name` field (or custom lookup) makes them a container for nested definitions. */
  containers: string[]
}

const tsSymbols = `
(function_declaration name: (identifier) @name) @def.function
(generator_function_declaration name: (identifier) @name) @def.function
(class_declaration name: (type_identifier) @name) @def.class
(abstract_class_declaration name: (type_identifier) @name) @def.class
(interface_declaration name: (type_identifier) @name) @def.interface
(type_alias_declaration name: (type_identifier) @name) @def.type
(enum_declaration name: (identifier) @name) @def.enum
(method_definition name: (property_identifier) @name) @def.method
(variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)]) @def.function
`
const jsImports = `
(import_statement source: (string (string_fragment) @source))
(export_statement source: (string (string_fragment) @source))
(call_expression function: (identifier) @_req arguments: (arguments . (string (string_fragment) @source)) (#eq? @_req "require"))
`
const jsCalls = `
(call_expression function: (identifier) @callee)
(call_expression function: (member_expression property: (property_identifier) @callee))
(new_expression constructor: (identifier) @callee)
`
const ts: Omit<LanguageSpec, 'id' | 'wasm'> = { symbols: tsSymbols, imports: jsImports, calls: jsCalls, containers: ['class_declaration', 'abstract_class_declaration', 'interface_declaration'] }

export const LANGUAGES: Record<string, LanguageSpec> = {
  typescript: { id: 'typescript', wasm: 'tree-sitter-typescript.wasm', ...ts },
  tsx: { id: 'tsx', wasm: 'tree-sitter-tsx.wasm', ...ts },
  javascript: {
    id: 'javascript', wasm: 'tree-sitter-javascript.wasm',
    symbols: `
(function_declaration name: (identifier) @name) @def.function
(generator_function_declaration name: (identifier) @name) @def.function
(class_declaration name: (identifier) @name) @def.class
(method_definition name: (property_identifier) @name) @def.method
(variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)]) @def.function
`,
    imports: jsImports, calls: jsCalls, containers: ['class_declaration']
  },
  python: {
    id: 'python', wasm: 'tree-sitter-python.wasm',
    symbols: `
(class_definition name: (identifier) @name) @def.class
(function_definition name: (identifier) @name) @def.function
`,
    imports: `
(import_statement name: (dotted_name) @source)
(import_statement name: (aliased_import name: (dotted_name) @source))
(import_from_statement module_name: (_) @source)
`,
    calls: `
(call function: (identifier) @callee)
(call function: (attribute attribute: (identifier) @callee))
`,
    containers: ['class_definition']
  },
  go: {
    id: 'go', wasm: 'tree-sitter-go.wasm',
    symbols: `
(function_declaration name: (identifier) @name) @def.function
(method_declaration name: (field_identifier) @name) @def.method
(type_spec name: (type_identifier) @name type: (struct_type)) @def.class
(type_spec name: (type_identifier) @name type: (interface_type)) @def.interface
`,
    imports: `(import_spec path: (interpreted_string_literal) @source)`,
    calls: `
(call_expression function: (identifier) @callee)
(call_expression function: (selector_expression field: (field_identifier) @callee))
`,
    containers: ['method_declaration']
  },
  java: {
    id: 'java', wasm: 'tree-sitter-java.wasm',
    symbols: `
(class_declaration name: (identifier) @name) @def.class
(interface_declaration name: (identifier) @name) @def.interface
(enum_declaration name: (identifier) @name) @def.enum
(method_declaration name: (identifier) @name) @def.method
(constructor_declaration name: (identifier) @name) @def.method
`,
    imports: `(import_declaration (scoped_identifier) @source)`,
    calls: `
(method_invocation name: (identifier) @callee)
(object_creation_expression type: (type_identifier) @callee)
`,
    containers: ['class_declaration', 'interface_declaration', 'enum_declaration']
  },
  rust: {
    id: 'rust', wasm: 'tree-sitter-rust.wasm',
    symbols: `
(function_item name: (identifier) @name) @def.function
(struct_item name: (type_identifier) @name) @def.class
(enum_item name: (type_identifier) @name) @def.enum
(trait_item name: (type_identifier) @name) @def.interface
`,
    imports: `(use_declaration argument: (_) @source)`,
    calls: `
(call_expression function: (identifier) @callee)
(call_expression function: (field_expression field: (field_identifier) @callee))
(call_expression function: (scoped_identifier name: (identifier) @callee))
`,
    containers: ['impl_item', 'trait_item']
  }
}

const EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'tsx',
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.go': 'go', '.java': 'java', '.rs': 'rust'
}

export function languageOf(path: string): LanguageSpec | undefined {
  if (path.endsWith('.d.ts')) return undefined
  const dot = path.lastIndexOf('.')
  const id = dot >= 0 ? EXTENSIONS[path.slice(dot).toLowerCase()] : undefined
  return id ? LANGUAGES[id] : undefined
}
