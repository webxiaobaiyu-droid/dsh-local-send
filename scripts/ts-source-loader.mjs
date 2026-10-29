/**
 * Load this repository's TypeScript sources from a plain `node script.mjs`.
 *
 * The self-test and probe scripts import the same files the unit tests do, but
 * they run under bare Node rather than vitest, so they need a loader that lowers
 * types. TypeScript itself does that: `transpileModule` is the compiler this
 * project already builds with, it handles the parameter properties these sources
 * use (strip-only mode does not), and it is a direct devDependency — no pinned
 * path into `node_modules/.pnpm` that breaks on the next install.
 *
 * Usage, from a script:
 *   import { register } from 'node:module'
 *   register(new URL('./ts-source-loader.mjs', import.meta.url))
 *
 * @module dsh-local-send/scripts/ts-source-loader
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')

/** True for paths that end like TypeScript and exist on disk. */
function isTypeScript(path) {
  return /\.tsx?$/.test(path) && existsSync(path)
}

export async function resolve(specifier, context, nextResolve) {
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:')) return nextLoad(url, context)
  const filePath = fileURLToPath(url)
  if (!isTypeScript(filePath)) return nextLoad(url, context)
  const transformed = ts.transpileModule(readFileSync(filePath, 'utf8'), {
    fileName: filePath,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      // The sources are written for a bundler: `from './x.ts'` stays as-is and
      // this loader resolves it, so nothing is rewritten or relocated.
      verbatimModuleSyntax: true,
      isolatedModules: true,
    },
  })
  return { format: 'module', source: transformed.outputText, shortCircuit: true }
}
