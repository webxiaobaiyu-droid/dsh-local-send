/**
 * Bundle for the interface preview.
 *
 * Unlike the two halves this plugin actually ships, this one bundles React
 * rather than requiring it: the preview page has no module table to resolve it
 * from, and it is thrown away after a look.
 */
import { defineConfig } from 'tsdown'

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
  outputOptions: { entryFileNames: 'entry.js' },
})
