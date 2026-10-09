/**
 * Load this repository's TypeScript sources from a plain `node script.mjs`.
 *
 * The self-test scripts import the same files the unit tests do, but they run
 * under bare Node rather than vitest, so they need a loader that strips types.
 * Rolldown's oxc transform is already in the dependency tree — it is what
 * builds this package — so it is the transformer.
 *
 * The transformer is imported statically, at loader start, and by `import`
 * rather than `require`: a require from inside a loader hook re-enters the
 * module system before its handshake is done and dies with a phantom
 * `resolveSync is not implemented`.
 *
 * Usage, from a script:
 *   import { register } from 'node:module'
 *   register(new URL('./ts-source-loader.mjs', import.meta.url))
 *
 * @module dsh-local-send/scripts/ts-source-loader
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Resolved relative to this file, so the script works from any cwd. */
const oxc = await import(
  pathToFileURL(new URL('../node_modules/.pnpm/rolldown@1.2.13/node_modules/rolldown/dist/experimental-index.mjs', import.meta.url).pathname)
)

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
  const source = readFileSync(filePath, 'utf8')
  const isTsx = filePath.endsWith('.tsx')
  const transformed = oxc.transformSync(filePath, source, {
    lang: isTsx ? 'tsx' : 'ts',
    // The sources use `private readonly x` parameter properties, which
    // strip-only parsing rejects; this is the same lowering the bundler does.
    transform: { jsx: isTsx ? 'automatic' : undefined },
  })
  return { format: 'module', source: transformed.code, shortCircuit: true }
}
