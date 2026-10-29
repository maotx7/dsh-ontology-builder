import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'

const sourcePath = resolve('src/client.tsx')
const outputPath = resolve('dist/client.js')
const source = await readFile(sourcePath, 'utf8')
const result = ts.transpileModule(source, {
  fileName: sourcePath,
  reportDiagnostics: true,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React,
  },
})

const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
if (errors.length) {
  throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCurrentDirectory: () => process.cwd(),
    getCanonicalFileName: fileName => fileName,
    getNewLine: () => '\n',
  }))
}

const bundle = `window.__ModuleLoader__.load({\n  id: 'dsh-ontology-builder',\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n${result.outputText}\n    return module.exports;\n  },\n});\n`
await writeFile(outputPath, bundle)
