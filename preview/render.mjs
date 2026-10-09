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

import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** This repository's root. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Where the Harness checkout lives, for its theme sheets. */
const HARNESS = process.env['DSH_SRC'] ?? '/Users/openSource/deepseek-harness'

/** Where the generated page and its screenshots go. */
const OUT = join(ROOT, 'preview', 'dist')

/** The theme sheets whose tokens the panel reads, plus the toast surface. */
const SHEETS = [
  'packages/client/ui-theme/src/styles/base.css',
  'packages/client/ui-theme/src/styles/design-platform.css',
]

/** Chrome's binary, used headlessly for the screenshot. */
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/**
 * The scenes and palettes to capture, each with what must be on screen.
 *
 * The expectations are the point. A scene that renders nothing produces a
 * screenshot indistinguishable from a scene that legitimately has nothing in it,
 * and this harness exists precisely because the browser half cannot be checked
 * any other way before the plugin is loaded into a running Harness. So each
 * capture is preceded by a look at the document, and a scene that failed to
 * render fails the run.
 *
 * Matched against element attributes rather than bare names: the inlined
 * stylesheet contains every class this plugin defines, so a search for
 * `dls-panel` alone would find the CSS and call a blank page a success.
 */
const SHOTS = [
  { scene: 'busy', theme: 'light', name: 'panel-light', expect: ['class="[^"]*dls-panel'] },
  { scene: 'busy', theme: 'dark', name: 'panel-dark', expect: ['class="[^"]*dls-panel'] },
  { scene: 'empty', theme: 'light', name: 'empty-light', expect: ['class="[^"]*dls-panel', 'dls-emptyTitle'] },
  { scene: 'incoming', theme: 'dark', name: 'incoming-dark', expect: ['class="[^"]*dls-panel', 'dls-incoming'] },
  {
    scene: 'incoming',
    theme: 'light',
    name: 'notify-light',
    toast: true,
    expect: ['class="[^"]*dls-panel', 'role="alert"', '共 11.0 MB'],
  },
  {
    scene: 'incoming',
    theme: 'dark',
    name: 'notify-dark',
    toast: true,
    expect: ['class="[^"]*dls-panel', 'role="alert"', '共 11.0 MB'],
  },
  { scene: 'received', theme: 'light', name: 'received-light', expect: ['class="[^"]*dls-panel', 'dls-row'] },
  { scene: 'blocked', theme: 'dark', name: 'blocked-dark', expect: ['class="[^"]*dls-panel', 'dls-note'] },
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
<!-- The product's own component stylesheets, emitted by the preview bundle:
     the notification is its component rather than this plugin's, and it is
     rendered for real rather than reimplemented. -->
<style>${readFileSync(join(OUT, 'style.css'), 'utf8')}</style>
<style>
  /* The panel is a column of the frame in the product; here it is the page. */
  html, body { block-size: 100%; margin: 0; }
  #root { block-size: 100%; }
</style>
</head>
<body>
<div id="root"></div>
<script>
// A failure inside the bundle would otherwise leave a blank page with nothing
// said anywhere: a headless screenshot has no console to read. This puts the
// reason into the document, where a dump or a screenshot will show it.
window.addEventListener('error', (event) => {
  const box = document.createElement('pre')
  box.id = 'preview-error'
  box.style.cssText = 'font: 12px/1.5 ui-monospace, monospace; color: #b00; padding: 16px; white-space: pre-wrap'
  box.textContent = 'preview failed: ' + (event.message || event.error) + '\n' + (event.error && event.error.stack || '')
  document.body.appendChild(box)
})
</script>
<script src="./entry.js"></script>
</body>
</html>
`
  writeFileSync(join(OUT, 'index.html'), html, 'utf8')
}

/**
 * Serve the preview directory over HTTP for the duration of the capture.
 *
 * A `file://` page cannot load a script the way this one needs to: Chrome
 * treats each file as an opaque origin and reports only "Script error.", with
 * the actual exception withheld. Serving it is also the honest arrangement —
 * the product serves these bundles over HTTP — and it is what makes the error
 * box in the page useful when something goes wrong.
 *
 * @returns the origin to capture from, and a function to stop serving.
 */
async function servePreview() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
  const server = createServer((request, response) => {
    const name = (request.url ?? '/').split('?')[0]?.replace(/^\//u, '') || 'index.html'
    const file = join(OUT, name)
    if (!existsSync(file)) {
      response.writeHead(404).end()
      return
    }
    const extension = name.slice(name.lastIndexOf('.'))
    // `connection: close` matters: Chrome's screenshot mode waits for the
    // network to go idle, and a keep-alive socket to this server keeps it from
    // ever being idle.
    response.writeHead(200, {
      'content-type': types[extension] ?? 'application/octet-stream',
      connection: 'close',
    })
    response.end(readFileSync(file))
  })
  const port = await new Promise((resolvePort) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolvePort(typeof address === 'object' && address !== null ? address.port : 0)
    })
  })
  return { origin: `http://127.0.0.1:${String(port)}`, stop: () => { server.close() } }
}

/**
 * Run Chrome headlessly and hand back the document it ended up with.
 *
 * @param origin - the origin the preview is being served from.
 * @param shot - the scene to load.
 * @returns the serialized document.
 */
async function documentOf(origin, shot) {
  const toast = shot.toast === true ? '&toast=1' : ''
  const url = `${origin}/index.html?scene=${shot.scene}&theme=${shot.theme}${toast}`
  const child = spawn(CHROME, [
    '--headless',
    '--disable-gpu',
    '--virtual-time-budget=4000',
    '--dump-dom',
    url,
  ], { stdio: ['ignore', 'pipe', 'ignore'], detached: true })
  let html = ''
  child.stdout.on('data', (chunk) => { html += String(chunk) })
  const deadline = Date.now() + 40_000
  while (child.exitCode === null && Date.now() < deadline) {
    await new Promise((wait) => setTimeout(wait, 100))
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    // Already exited, which is the good case.
  }
  return html
}

/**
 * Decide whether a scene actually rendered.
 *
 * @param shot - the scene and what it must contain.
 * @param html - the document Chrome produced.
 * @returns a list of problems; empty means the scene is good.
 */
function problemsWith(shot, html) {
  const problems = []
  if (html.length === 0) return ['Chrome produced no document']
  // A component that throws unmounts the whole tree and leaves a blank page
  // behind; the entry records the reason in the document so it is not lost.
  const failure = /<pre id="preview-error"[^>]*>([\s\S]*?)<\/pre>/u.exec(html)
  if (failure !== null) {
    problems.push(`render failed: ${(failure[1] ?? '').split('\n').slice(0, 3).join(' ')}`)
  }
  for (const pattern of shot.expect ?? []) {
    if (!new RegExp(pattern, 'u').test(html)) problems.push(`missing /${pattern}/`)
  }
  return problems
}

/**
 * Screenshot one scene with headless Chrome.
 *
 * Chrome is spawned and then polled for rather than waited on: it writes the
 * screenshot and does not reliably exit afterwards, and its stderr carries a
 * running commentary of display-link warnings that fills a pipe nobody drains.
 * Waiting for the file to appear is the one signal that means what it says.
 *
 * The poll is asynchronous on purpose. The preview is served from this same
 * process, so a synchronous wait would block the event loop that has to answer
 * the browser's requests — and the page would never load, which looks exactly
 * like a browser that cannot start.
 *
 * @param origin - the origin the preview is being served from.
 * @param shot - the scene, palette, and output name.
 * @returns the path written.
 */
async function shoot(origin, shot) {
  const toast = shot.toast === true ? '&toast=1' : ''
  const url = `${origin}/index.html?scene=${shot.scene}&theme=${shot.theme}${toast}`
  const target = join(OUT, `${shot.name}.png`)
  rmSync(target, { force: true })

  const child = spawn(CHROME, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    // The panel is a column of a window in the product; here it is the page.
    '--force-device-scale-factor=2',
    '--window-size=1100,1000',
    // The bundle carries React and the product's icon set, so it is not small;
    // the budget gives the parse and the first paint a deterministic window
    // rather than racing them.
    '--virtual-time-budget=4000',
    `--screenshot=${target}`,
    url,
  ], { stdio: 'ignore', detached: true })

  const deadline = Date.now() + 40_000
  while (!existsSync(target) && Date.now() < deadline) {
    await new Promise((wait) => setTimeout(wait, 100))
  }
  try {
    // The whole process group: Chrome leaves helpers behind otherwise.
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    // Already gone, which is the good case.
  }
  if (!existsSync(target)) throw new Error(`preview: no screenshot for ${shot.name} after 40s`)
  return target
}

mkdirSync(OUT, { recursive: true })
execFileSync('npx', ['tsdown', '--config', 'preview/tsdown.config.ts'], { cwd: ROOT, stdio: 'inherit' })
writePage()

if (!existsSync(CHROME)) {
  console.log(`preview: built ${join(OUT, 'index.html')} (no Chrome at ${CHROME}, so no screenshots)`)
} else {
  const { origin, stop } = await servePreview()
  const failures = []
  try {
    for (const shot of SHOTS) {
      const problems = problemsWith(shot, await documentOf(origin, shot))
      if (problems.length > 0) {
        failures.push({ name: shot.name, problems })
        console.log(`FAIL  ${shot.name.padEnd(16)} ${problems.join('; ')}`)
        continue
      }
      console.log(` ok   ${shot.name.padEnd(16)} -> ${await shoot(origin, shot)}`)
    }
  } finally {
    stop()
  }
  if (failures.length > 0) {
    console.error(`\npreview: ${String(failures.length)} of ${String(SHOTS.length)} scenes did not render`)
    process.exitCode = 1
  }
}
