/**
 * The browser half's bundle contract, exercised without a browser.
 *
 * This half is delivered as a self-registering factory rather than as a module,
 * so nothing about it is checked by an ordinary import: the wrapper, the id it
 * registers under, and the exports it hands back are a hand-written contract
 * that a build change could break silently — the plugin would simply never
 * appear, with the failure buried in the page's console.
 *
 * So the built artifact is loaded the way the page loads it, with the module
 * table stubbed and a minimal document, and then activated against a stand-in
 * client context. What this cannot check is how any of it looks; that needs the
 * real renderer.
 *
 * @module dsh-local-send/tests/client-bundle
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
/** The built browser bundle, read as the page would fetch it. */
const BUNDLE = readFileSync(join(HERE, '..', 'lib', 'client.js'), 'utf8')

/** One registration handed to the loader sink. */
interface Registration {
  readonly id: string
  readonly factory: (require: (spec: string) => unknown) => unknown
}

/** Everything the page provides that the bundle touches. */
interface StubPage {
  readonly registrations: Registration[]
  readonly styles: { readonly textContent: string | null; readonly dataset: Record<string, string> }[]
  readonly consoleErrors: string[]
}

/**
 * Evaluate the bundle in a stand-in page.
 *
 * The module table is stubbed rather than loaded for real: React is available
 * (it is a devDependency), but the product's own client packages are not, and
 * what is under test is this bundle's wiring rather than theirs.
 *
 * @returns what the bundle registered and appended.
 */
function loadBundle(): StubPage {
  const registrations: Registration[] = []
  const styles: { textContent: string | null; dataset: Record<string, string> }[] = []
  const consoleErrors: string[] = []

  const element = (): {
    textContent: string | null
    dataset: Record<string, string>
    remove: () => void
    appendChild: (child: unknown) => void
  } => ({
    textContent: null,
    dataset: {},
    remove: () => {},
    appendChild: () => {},
  })

  const head = { appendChild: (child: { textContent: string | null; dataset: Record<string, string> }) => { styles.push(child) } }

  const page = {
    __ModuleLoader__: {
      load: (registration: Registration) => { registrations.push(registration) },
    },
    location: { origin: 'http://127.0.0.1:19387' },
    setTimeout: () => 0,
    clearTimeout: () => {},
  }

  const sandbox = {
    window: page,
    document: { querySelector: () => null, createElement: element, head },
    setTimeout: page.setTimeout,
    clearTimeout: page.clearTimeout,
    console: { error: (message: string) => { consoleErrors.push(message) }, warn: () => {}, log: () => {} },
  }

  // The bundle is a plain script that registers itself, so it is evaluated with
  // the page's own globals in scope.
  const run = new Function('window', 'document', 'setTimeout', 'clearTimeout', 'console', 'require', BUNDLE)
  run(
    sandbox.window,
    sandbox.document,
    sandbox.setTimeout,
    sandbox.clearTimeout,
    sandbox.console,
    (spec: string) => requireFrom(moduleTable(), spec),
  )

  return { registrations, styles, consoleErrors }
}

/** A client context carrying only what the module declares it needs. */
interface StubContext {
  readonly registrations: { name: string; options: Record<string, unknown> }[]
  readonly effects: string[]
}

/** The module table the page provides, stubbed to what this bundle asks for. */
function moduleTable(): Record<string, unknown> {
  return {
    react: {
      createElement: () => null,
      useState: () => [undefined, () => {}],
      useEffect: () => {},
      useRef: () => ({ current: 0 }),
      useSyncExternalStore: () => undefined,
      useCallback: (fn: unknown) => fn,
      useMemo: (fn: () => unknown) => fn(),
    },
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: null },
    '@deepseek-ai/dsh-client-ui-primitives': { Toast: () => null },
  }
}

/** Resolve one specifier out of the stub table, refusing anything unexpected. */
function requireFrom(table: Record<string, unknown>, spec: string): unknown {
  const found = table[spec]
  if (found === undefined) {
    throw new Error(`client-modules: requested external "${spec}" is not in the table`)
  }
  return found
}

/**
 * Build a stand-in client context and activate the bundle against it.
 *
 * The context carries only the seats this module declares it injects, so a
 * service it forgot to ask for would be missing here exactly as it would be in
 * a page that mounted nothing else.
 *
 * @param bundle - the loaded page stub.
 * @returns what the activation registered.
 */
function activate(bundle: StubPage): StubContext {
  const registrations: { name: string; options: Record<string, unknown> }[] = []
  const effects: string[] = []
  const table = moduleTable()
  const factory = bundle.registrations[0]?.factory
  if (factory === undefined) throw new Error('the bundle registered no factory')
  const exports = factory((spec: string) => requireFrom(table, spec)) as {
    apply?: (ctx: unknown) => void
    inject?: string[]
  }
  if (exports.apply === undefined) throw new Error('the bundle exported no apply')

  const ctx = {
    effect: (callback: () => unknown, label: string) => {
      effects.push(label)
      return callback()
    },
    locale: {
      register: () => () => {},
      bind: () => (key: string) => key,
      getLocale: () => ({ active: 'zh' }),
    },
    slots: {
      // The real inject either registers directly or yields disposers; calling
      // the callback is all this needs to observe what was contributed.
      inject: (_name: string, callback: () => unknown) => {
        void callback()
        return () => {}
      },
      register: (options: Record<string, unknown>) => {
        registrations.push({ name: String(options['name']), options })
        return () => {}
      },
    },
    layout: { selectPanel: () => {} },
    get: () => undefined,
  }

  exports.apply(ctx)
  return { registrations, effects }
}

describe('browser half bundle', () => {
  it('registers under the package name the loader row mounts', () => {
    const bundle = loadBundle()
    expect(bundle.registrations).toHaveLength(1)
    expect(bundle.registrations[0]?.id).toBe('dsh-local-send')
  })

  it('evaluates its factory and exports an inject list', () => {
    const bundle = loadBundle()
    const exports = bundle.registrations[0]?.factory(() => ({})) as { apply?: unknown; inject?: unknown }
    expect(typeof exports.apply).toBe('function')
    expect(Array.isArray(exports.inject)).toBe(true)
  })

  it('asks only for services the client tree actually provides', () => {
    const bundle = loadBundle()
    const exports = bundle.registrations[0]?.factory(() => ({})) as { inject: string[] }
    // `slots` and `locale` are the registration seats; `layout` is what brings
    // the conversation back when a received file is added to it.
    expect(exports.inject).toEqual(['slots', 'locale', 'layout'])
  })

  it('injects its own stylesheet on activation', () => {
    const bundle = loadBundle()
    const activated = activate(bundle)
    // The bundle is served outside the product's build, so nothing else will
    // style it.
    expect(activated.effects).toContain('dsh-local-send: stylesheet')
    expect(activated.effects).toContain('dsh-local-send: dictionaries')
  })

  it('registers a sidebar entry, a main panel, a notification, and a composer hook', () => {
    const bundle = loadBundle()
    const activated = activate(bundle)
    const names = activated.registrations.map(entry => entry.name)
    expect(names).toContain('main')
    expect(names).toContain('sidebar.panellist')
    expect(names).toContain('shell.overlay')
    expect(names).toContain('conversation.input.left')
  })

  it('gives the sidebar entry and the panel it opens the same id', () => {
    const bundle = loadBundle()
    const activated = activate(bundle)
    const panel = activated.registrations.find(entry => entry.name === 'main')
    const sidebar = activated.registrations.find(entry => entry.name === 'sidebar.panellist')
    // The sidebar resolves its panel by this id; a mismatch would give a button
    // that selects nothing.
    expect(panel?.options['key']).toBe('local-send')
    expect(sidebar?.options['id']).toBe('local-send')
  })

  it('keeps the receive notification in its own overlay cell', () => {
    const bundle = loadBundle()
    const activated = activate(bundle)
    const overlay = activated.registrations.find(entry => entry.name === 'shell.overlay')
    // A fresh id adds a cell beside the shipped ones; reusing one would replace
    // somebody else's surface.
    expect(overlay?.options['id']).toBe('local-send.receive-toast')
  })

  it('declares the dictionary namespace on every localized registration', () => {
    const bundle = loadBundle()
    const activated = activate(bundle)
    for (const entry of activated.registrations) {
      expect(entry.options['locale']).toBe('localSend')
    }
  })
})
