/**
 * Bundle for the interface preview.
 *
 * Unlike the two halves this plugin actually ships, this one bundles React
 * rather than requiring it: the preview page has no module table to resolve it
 * from, and it is thrown away after a look.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defineConfig } from 'tsdown'

/**
 * Absolute paths to this repository's own React.
 *
 * The product's component modules live in a checkout with its own
 * `node_modules`, so a bundled component that imports `react-dom` resolves to
 * *that* React rather than this one. Two Reacts in one page is not a size
 * problem but a correctness one: `createPortal` from one copy renders into a
 * tree owned by the other, which produces a blank page and, depending on the
 * path taken, no error worth reading. Pinning every React specifier here means
 * one copy is bundled and both sides share it.
 */
const require = createRequire(import.meta.url)
const REACT_ROOT = dirname(require.resolve('react/package.json'))
const REACT_DOM_ROOT = dirname(require.resolve('react-dom/package.json'))

export default defineConfig({
  name: 'dsh-local-send/preview',
  entry: { entry: 'entry.tsx' },
  outDir: 'dist',
  format: ['iife'],
  platform: 'browser',
  target: 'es2022',
  dts: false,
  clean: true,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  // React is bundled here rather than required: this page has no module table
  // to resolve it from, unlike the two halves the plugin actually ships.
  deps: { alwaysBundle: [/^react(-dom)?(\/|$)/] },
  alias: {
    react: REACT_ROOT,
    'react/jsx-runtime': join(REACT_ROOT, 'jsx-runtime.js'),
    'react/jsx-dev-runtime': join(REACT_ROOT, 'jsx-dev-runtime.js'),
    'react-dom': REACT_DOM_ROOT,
    'react-dom/client': join(REACT_DOM_ROOT, 'client.js'),
  },
  outputOptions: { entryFileNames: 'entry.js' },
})
