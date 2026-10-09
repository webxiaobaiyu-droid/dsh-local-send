#!/usr/bin/env node
/**
 * Build the interface preview and screenshot it.
 *
 * The page is assembled around the Harness's own theme sheets rather than a
 * hand-written approximation of them, so the tokens the panel reads resolve to
 * the values the product would give them — a preview built on invented colours
 * would answer a question nobody asked.
 *
 * Usage:
 *   node preview/render.mjs [--harness /path/to/deepseek-harness] [--out DIR]
 *
 * @module dsh-local-send/preview/render
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** This repository's root. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Where the Harness checkout lives, for its theme sheets. */
const HARNESS = process.env['DSH_SRC'] ?? '/Users/openSource/deepseek-harness'

/** Where the generated page and its screenshots go. */
const OUT = join(ROOT, 'preview', 'dist')

/** The theme sheets whose tokens the panel reads. */
const SHEETS = [
  'packages/client/ui-theme/src/styles/base.css',
  'packages/client/ui-theme/src/styles/design-platform.css',
]

/** Chrome's binary, used headlessly for the screenshot. */
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** The scenes and palettes to capture. */
const SHOTS = [
  { scene: 'busy', theme: 'light', name: 'panel-light' },
  { scene: 'busy', theme: 'dark', name: 'panel-dark' },
  { scene: 'empty', theme: 'light', name: 'empty-light' },
  { scene: 'incoming', theme: 'dark', name: 'incoming-dark' },
  { scene: 'received', theme: 'light', name: 'received-light' },
  { scene: 'blocked', theme: 'dark', name: 'blocked-dark' },
]

/** Read the Harness theme sheets, or explain which one is missing. */
function themeCss() {
  const parts = []
  for (const relative of SHEETS) {
    const path = join(HARNESS, relative)
    if (!existsSync(path)) {
      throw new Error(`preview: no theme sheet at ${path}. Pass --harness or set $DSH_SRC.`)
    }
    parts.push(`/* ${relative} */\n${readFileSync(path, 'utf8')}`)
  }
  return parts.join('\n')
}

/** Write the preview page. */
function writePage() {
  const html = `<!doctype html>
<html lang="zh-CN" data-platform="darwin">
<head>
<meta charset="utf-8">
<title>dsh-local-send preview</title>
<style>${themeCss()}</style>
<style>
  /* The panel is a column of the frame in the product; here it is the page. */
  html, body { block-size: 100%; margin: 0; }
  #root { block-size: 100%; }
</style>
</head>
<body>
<div id="root"></div>
<script src="./entry.js"></script>
</body>
</html>
`
  writeFileSync(join(OUT, 'index.html'), html, 'utf8')
}

/** Screenshot one scene with headless Chrome. */
function shoot(shot) {
  const url = `file://${join(OUT, 'index.html')}?scene=${shot.scene}&theme=${shot.theme}`
  const target = join(OUT, `${shot.name}.png`)
  execFileSync(CHROME, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=2',
    '--window-size=1100,1000',
    // Chrome writes the screenshot after load; the virtual time budget gives
    // the render a deterministic window rather than racing it.
    '--virtual-time-budget=1500',
    `--screenshot=${target}`,
    url,
  ], { stdio: 'pipe' })
  return target
}

mkdirSync(OUT, { recursive: true })
execFileSync('npx', ['tsdown', '--config', 'preview/tsdown.config.ts'], { cwd: ROOT, stdio: 'inherit' })
writePage()

if (!existsSync(CHROME)) {
  console.log(`preview: built ${join(OUT, 'index.html')} (no Chrome at ${CHROME}, so no screenshots)`)
} else {
  for (const shot of SHOTS) console.log(`preview: ${shot.name} -> ${shoot(shot)}`)
}
