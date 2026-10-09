# DSH host-plugin research: installation/loading, files, HTTP carrier, events

**Provenance / version caveat (read first).** The checkout I was told to read, `/Users/openSource/deepseek-harness`, is at version **0.1.7-rc.2** (`package.json` → `@deepseek-ai/dsh-root 0.1.7-rc.2`; `git tag -l` ends at `dsh-v0.1.7-rc.2`). The **installed Electron app is 0.2.0-rc.2** (`defaults read "/Applications/DeepSeek Harness.app/Contents/Info.plist" CFBundleShortVersionString` → `0.2.0-rc.2`), and the running host process is:

```
/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness --expose-internals \
  .../app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js \
  .../app.asar/dsh /Users/Admin/.dsh/profiles/desktop ...
```

So the checkout is **one minor version behind what actually runs**. Where the shipped build differs I extracted the real file out of `app.asar` (the `.ts` sources are not in the asar; compiled `lib/*.js` are) and cited it as `app.asar:/dsh/node_modules/...`. Everything else is cited from the checkout. Where I could not verify a claim in either tree, I say so explicitly.

---

## A. Installation and loading

### A1. How a patch row becomes a loaded plugin

**The chain, in order:**

1. **Profile resolution.** `loadProfile(binName, name, installAnchor, home = resolveDshHome())` — `packages/boot/app-boot/src/profile.ts:704`. It resolves the profile dir with `resolveProfileDir(name, home)` (`:708`, defined `:169`), initialising it from a template if absent (`:710-717`; the error message at `:713` is the canonical "create it with `dsh plugin --profile <name> add <package>`").
2. **Layer collection.** `loadProfileDirectory` (`:655`) walks `manifest.dsh?.profile?.bundles ?? []` **in order** (`:662`, `:666`), and for each bundle reads `bundleManifest.dsh.bundle.patch` paths (`:670-678`), then appends the profile's own patch file as the last layer (`:684-687`). `PROFILE_PATCH_FILENAME = 'cordis.patch.yml'` (`:40`). Bundle layers that fail to read/validate are skipped into `skippedBundles`; **the profile's own patch errors throw** (`:680-687`).
3. **Patch parsing.** `loadOverlayPatches(binName, file)` (`packages/boot/app-boot/src/index.ts:335`) → `parsePatchList` (`:370`). The file must be a **top-level YAML array of loader patch entries** (`:379-381`), parsed with the include's YAML dialect (`entryListSchema`, `:264`, which allows `!!js` expressions). Every entry must be a mapping (`:382-386`).
4. **Name anchoring (the important part).** `anchorInsertedPluginNames` (`:346-356`):

```ts
if (typeof entry.name === 'string' && (isAbsolute(entry.name) || entry.name.startsWith('./') || entry.name.startsWith('../'))) {
  entry.name = pathToFileURL(resolve(base, entry.name)).href
}
```
where `base = dirname(resolve(file))` (`:347`) — i.e. **relative paths are resolved against the directory of the patch file that declared them**, then turned into a `file://` URL.
5. **Composition into an entry list.** `composeEntries(layers, warn)` (`packages/boot/app-boot/src/profile.ts:731-737`) flattens all layers and calls `applyEntryPatches([], …, warn)` from `@deepseek-ai/cordis-plugin-include` — "the same single `applyEntryPatches` call the boot include makes".
6. **Mounting.** The boot root is a cordis Loader `Include` entry whose `config.patches` is that composed list; `reconcileProfilePatches` updates it (`packages/boot/app-boot/src/index.ts:273-302`, `:289`).

**Exact `applyEntryPatches` semantics** (shipped `@deepseek-ai/cordis-plugin-include@1.0.9`, `app.asar:/dsh/node_modules/@deepseek-ai/cordis-plugin-include/lib/index.js:56-105`):

```js
for (const patch of patches) {
  const { id, insert, name, ...overrides } = patch;
  if (insert) {
    if (id) {                        // insert into an existing GROUP entry's config array
      const target = entryMap.get(id);
      if (!target) { warn("patch insert: entry %C not found", id); continue; }
      if (!target.group) { warn("patch insert: entry %C is not a group", id); continue; }
      if (!Array.isArray(target.config)) target.config = [];
      target.config.push(...insert);
    } else data.push(...insert);      // insert at the TOP LEVEL of the entry list
    buildMap(insert);                 // later patches in the same list may target inserted rows
    continue;
  }
  if (!id) { warn("patch: id is required for non-insert patches"); continue; }
  const target = entryMap.get(id);
  if (!target) { warn("patch: entry %C not found", id); continue; }
  if (name && name !== target.name) { warn("patch: name mismatch for %C …"); continue; }
  for (const [key, value] of Object.entries(overrides)) { if (key === "id") continue; target[key] = value; }
}
```
* An `insert` row **is** the loader entry. `id` + `name` are the row's identity; any other key on the row (`config`, `disabled`, `inject`, …) becomes the entry's loader options.
* An `insert` **with** `id` targets a *group* entry and appends into its `config` array — it does **not** target a plain plugin row.
* A non-`insert` patch targets an existing row by `id`; `name`, when present, is a **mismatch assertion** (skip + warn, not an error). `name` on a non-insert patch never selects the module.
* A patch that matches nothing **warns and is skipped** — one overlay can be shared across surfaces (documented at `packages/boot/app-boot/src/index.ts:361-363`).

**What `name` is resolved against.** `Loader.import` in `@deepseek-ai/cordis-plugin-loader` (`app.asar:/dsh/node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js:214-227`):

```js
import(name, getOuterStack) {
  if (name.startsWith("cordis:")) return this.ctx.loader.builtins[name.slice(7)];
  ...
  if (this.ctx.loader.internal) return await this.ctx.loader.internal.import(name, this.ctx.baseUrl, {});
  else if (name.startsWith(".")) return await import(… new URL(name, this.ctx.baseUrl).href …);
  else return await import(… name …);
}
```

So: **both** npm package names and local paths work.
* **npm package name** (e.g. `'dsh-local-usage'`) → plain dynamic `import(name)`, resolved by Node from `this.ctx.baseUrl`. For a profile, `baseUrl` is the profile directory whose `node_modules` pnpm populated — hence the reference plugin's relative `node_modules/dsh-local-usage` (`~/.dsh/profiles/desktop/node_modules/dsh-local-usage`, a real directory).
* **local path** → converted to a `file://` URL by `anchorInsertedPluginNames` and imported verbatim.
* **`cordis:`** → a builtin.

**How `config:` reaches `apply(ctx, config)`.** The row's remaining keys are the loader entry options. For an inserted row, `config` is one of them; the Loader passes `entry.options.config` to the plugin module's exported `Config` schema (cordis convention) and then to the default export's `apply(ctx, config)`. Evidence in-tree: `packages/boot/web-app` rows carry `config:` and read it in the plugin, e.g. `packages/client/ui-plugin-manager/src/index.ts:26-30` declares `static Config` with defaults and the constructor takes `(ctx, config)` (`:36`). Real row-with-config from this machine's profile:

```yaml
- id: ui-chat
  name: "@deepseek-ai/dsh-client-ui-chat"
  config:
    performanceUsage: detailed
    transcriptView: standard
```

(Note the documented gotcha in `packages/bundle/web-app/cordis.patch.yml:6`: "A patch replaces the targeted row's whole `config`, so each row below restates every key it owns.")

### A2. Profile structure under `~/.dsh/profiles/`, and the live example

A profile is a **pnpm package directory** that is also the Loader's `baseUrl`:

| File | Role |
|---|---|
| `package.json` | profile manifest: `dependencies` + `dsh.profile.bundles` (the ordered enabled-bundle list) |
| `cordis.yml` | the entry-list root — deliberately **empty** `[]` |
| `cordis.patch.yml` | the user's own patch layer, applied **after** every bundle layer |
| `pnpm-workspace.yaml` | `packages: [.]`, `nodeLinker: hoisted`, build approvals |
| `pnpm-lock.yaml`, `node_modules/` | install state |
| `desktop.cordis.yml` | desktop-only extra composition root (`[]`) |
| `.plugin-manager/logs/operation-*/pnpm.log` | every pnpm run the GUI made |

**Which profile the running GUI uses: `desktop`.** From the live process command line (`ps aux`): `… dsh-desktop-host/lib/index.js …/app.asar/dsh /Users/Admin/.dsh/profiles/desktop …`.

**The real files on this machine** (`~/.dsh/profiles/desktop/`):

`package.json`:
```json
{
  "name": "@deepseek-ai/dsh-desktop-runtime",
  "private": true,
  "version": "0.0.0",
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-local-usage"] } },
  "dependencies": { "dsh-local-usage": "^0.6.0" }
}
```

`cordis.patch.yml` (excerpt — this is the exact row shape):
```yaml
# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; `!!js` expressions allowed).
- { id: local-usage, disabled: false }
- id: ui-theme
  name: "@deepseek-ai/dsh-client-ui-theme"
  config:
    preference: system
```

Row shape summary, all four fields observed in the wild:
* `id` — required for id-targeted patches; the Loader keeps **one** entry per id whichever layer declared it last (`packages/boot/plugin-manager/src/index.ts:635`).
* `name` — module specifier (insert only) / mismatch assertion (override only).
* `config` — arbitrary object handed to the plugin's `Config` schema; **wholesale replacement**, not a deep merge.
* `disabled` — boolean; written by the GUI as `- { id: <rowId>, disabled: true|false }` (`packages/boot/plugin-manager/src/patch.ts:36-39`).

Note the web profile's manifest additionally has `dsh.profile.patchReload: "live"`; **this key does not exist in the 0.1.7 checkout** (grep for `patchReload` across `packages/` and `apps/` returns nothing), so it is a 0.2.0-rc.2 addition I could not source-cite. See A5.

### A3. Is there a CLI command to install a plugin?

**Yes: `dsh plugin --profile <name> <pnpm args…>`.** It is *not* a bespoke installer — it forwards to pnpm inside the profile directory.

* Usage text: `apps/cli/src/args.ts:99` — `dsh plugin --profile tui add <package>    install a plugin into the tui profile`; command registration at `:186-196`, including `requiredOption('--profile <name>', …)` (`:189`) and the guard `if (args.length === 0) program.error('error: plugin needs pnpm arguments to forward (e.g. add <package>)')` (`:195`).
* Dispatch: `apps/cli/src/bin.ts:40-42` → `runPlugin(invocation.profile, invocation.args)`.
* Implementation: `apps/cli/src/plugin.ts:62-85` → `runPluginCommand({ profile, installAnchor, cwd }, args, …)`. Before that, DSH-owned subcommands are intercepted (`:11-55`): `dsh plugin [--profile X] allow-version <pkg@ver> --dsh-version <exact> --accept-risk`, `revoke-version …`, `version-exemptions`.
* `runPluginCommand` is in `packages/boot/plugin-manager/src/operations.ts:544`; the pnpm run is `runProfilePnpm` (`:284`), which spawns `pnpm` with `args.map(arg => anchorPathSpec(arg, context.cwd))` (`:357`). `anchorPathSpec` (`:62-66`) rewrites a bare `.`/`..` argument to an absolute path against the **caller's cwd**, preserving a `file:`/`link:` prefix:

```ts
const match = /^(?<prefix>(?:file|link):)?(?<path>\.{1,2}(?:[/\\].*)?)$/.exec(argument)
if (match?.groups?.path === undefined) return argument
return `${match.groups.prefix ?? ''}${resolve(cwd, match.groups.path)}`
```

**What it mutates:** `package.json` + `pnpm-lock.yaml` + `node_modules` in the profile, and then the enabled-bundle list — `after.dsh = { ...after.dsh, profile: { ...after.dsh?.profile, bundles } }` (`packages/boot/plugin-manager/src/operations.ts:111`; bundle reconciliation in `packages/boot/app-boot/src/profile-plugins.ts:98-122`). A rollback of `package.json`/lockfile happens on compatibility refusal (`operations.ts:303`, `:505-516`).

**The GUI's programmatic path ("install plugin") — what it actually writes.** The GUI's host half is a Typert remote service: `export class PluginManager extends TypertRemoteService` (`packages/boot/plugin-manager/src/index.ts:176`), constructed with `super(ctx, 'pluginManager')` (`:206`). Clicking install calls:

```ts
@Remote
installBundle(spec: string, options?: InstallBundleOptions): Promise<ChangeResult>   // :461-462
```
which:
1. runs pnpm: `run = await this.runPnpm(['add', spec, ...registryArguments(registry)], …)` (`:506`); `runPnpm` shells `pnpm` with `cwd = this.profile.dir` (`:665-668`).
2. reads back the changed direct dependency (`:536-542`), requires the package to declare `dsh.bundle` (`:545`, else `ManagementFailure('not-bundle')`), version-checks it (`:546-547`), and validates its patch files parse (`:548`).
3. on success calls `this.selectBundle(name, true)` (`:560`) → appends the name to `dsh.profile.bundles` and `saveManifest` (`:715-733`).
4. reloads live if `hmr` is present and the package was *not* already a dependency (`:561-562`).

Enable/disable of an individual **row** (not a bundle) writes the profile patch file with a comment-preserving YAML document edit — `writePluginEnabled` (`packages/boot/plugin-manager/src/patch.ts:14-42`) finds the last matching id-less-`insert` row and sets `disabled`, or appends `{ id, disabled: !enabled }` (`:36-39`), via `writeFileAtomic(…, { mode: 0o600 })` (`:41`).

There is also a read-only inventory service: `PluginInventoryGateway extends TypertRemoteService` (`packages/host/plugin-inventory/src/index.ts:51`).

### A4. Can a plugin load from an absolute local directory?

**Yes for the row `name`; but the path must point at a file, not a directory.** This is the single most likely thing to get wrong.

* The mechanism is `anchorInsertedPluginNames` (`packages/boot/app-boot/src/index.ts:346-356`) → `pathToFileURL(resolve(base, name)).href`, applied to `name` values that are absolute, `./…` or `../…`, inside an `insert` (and inside a group's `config` array — `:352`).
* The Loader then `import()`s that `file://` URL verbatim (`loader.js:223-226`).
* Node ESM **refuses directory imports**. Verified on this machine with Node v22.23.1 against a real dir with `package.json` `main`/`exports`:
  ```
  FAIL  file:///tmp/dirtest       -> ERR_UNSUPPORTED_DIR_IMPORT
  FAIL  file:///tmp/dirtest/      -> ERR_UNSUPPORTED_DIR_IMPORT
  OK    file:///tmp/dirtest/lib/index.js -> object
  ```

So the exact row YAML for a development plugin, with no npm publish:

```yaml
# in ~/.dsh/profiles/desktop/cordis.patch.yml
- insert:
    - id: dsh-local-send
      name: '/Users/Admin/dsh-plugins/dsh-local-send/lib/index.js'
      # or, relative to THIS patch file's directory:
      # name: '../../../../dsh-plugins/dsh-local-send/lib/index.js'
```
Plus, so that the browser half is found (A5): the package's `package.json` must declare `dsh.client.platform` and `exports["./client"]`, and — for the *bundle* route (`dsh.profile.bundles`) — `dsh.bundle.patch`.

**Alternative, and what is actually on this machine:** install by path with pnpm, which produces a symlink. Real evidence: the **web** profile's `node_modules/dsh-agent-topology` is a symlink:
```
lrwxr-xr-x  dsh-agent-topology -> ../../../../dsh-plugins/dsh-agent-topology
```
i.e. `~/.dsh/profiles/web/node_modules/dsh-agent-topology` → `/Users/Admin/dsh-plugins/dsh-agent-topology`. `pnpm add <abs-dir>` records a `link:` dependency; `anchorPathSpec` explicitly preserves `link:`/`file:` prefixes (`operations.ts:63`). The **desktop** profile's `node_modules/dsh-local-usage` is instead a *real directory* (a registry install of the published package), so both patterns coexist. Note the desktop profile's `pnpm-workspace.yaml` carries per-version `minimumReleaseAgeExclude` entries for `dsh-local-usage@0.5.0`/`@0.6.0` — the supply-chain policy blocks fresh versions unless excluded.

One more in-tree consistency check: the plugin manager treats row names that are not package-ish as non-packages — `if (typeof row.name !== 'string' || row.name.startsWith('.') || row.name.startsWith('/') || row.name.includes(':')) continue` (`packages/boot/plugin-manager/src/index.ts:257`) — exactly the shapes `anchorInsertedPluginNames` has already rewritten to `file://`.

### A5. Reload after a code change, and the client-side module table

**Patch/config changes: live, no restart.** `reconcileProfilePatches(ctx, patches, binName, requiredIds)` (`packages/boot/app-boot/src/index.ts:273-302`) applies one complete patch generation to the running Loader (`await entry.update({ config: { ...includeConfig, patches: prepared } })`, `:289`), waits for activation (`:290-291`), and throws if a *new* failure appears (`:292-296`); it emits `app-boot/config-reload` (`:300`). Gated on the `hmr` service: `private async reload(...) { if (this.ownerContext.get('hmr') === undefined) return []; return reconcileProfilePatches(...) }` (`packages/boot/plugin-manager/src/index.ts:762-765`), and all mutations run through `hmr.runExclusive` (`:756-760`). `ChangeResult.application` is `'applied' | 'restart-required' | 'failed' | 'cancelled'` (`:775-786`), and restart is required **only** when the package was already a dependency before the pnpm run (`if (Object.hasOwn(before, name)) return 'restart-required'`, `:561`).

What this means for you: adding a **new** row / enabling it reloads live; changing the **code inside an already-installed package** is a plain module re-import question — the Loader caches by specifier, so the practical loop is "toggle the row off/on or restart the app". The pm's own reload path re-applies *patch options*, not module source. I found no source-level file watcher for plugin host halves. (`packages/boot/hmr/src/watch-config.ts` exists for config watching.)

**The 0.2.0 `patchReload: "live"` key** appears in the real `~/.dsh/profiles/web/package.json` but in **no** checkout source file — I cannot cite its consumer from the checkout, and the shipped asar's `dsh-app-boot/lib/index.js` is where it would live (I did not disassemble it for this key). Treat "live reload is on by default in the running app" as likely but unverified.

**Client (browser) half discovery and URL:**
* Node half: `packages/client/modules/src/index.ts` — "scans the host Loader's entries for packages declaring `dsh.client`, composes the …" (`:2-3`).
* Route constant: `const PLUGIN_ROUTE = '/plugins'` (`:225`); registered as a webServer prefix route: `webCtx.webServer.register({ kind: 'prefix', path: PLUGIN_ROUTE, handler: this.serveBundle })` (`:649`).
* Served URL: `/plugins/<id>/client.js` (and `…/client.js.map`), from `new URL(`/plugins/${resource.id}/client.js.map`, 'http://dsh.invalid')` (`:357`); batches are keyed by `comboUrl(entries, rev)` (`:448`, `:229`), and the HTML gets `script-preload`/`script-src` rows pointing at `batch.url` (`:580-583`). So the browser fetches it from **the same origin as the GUI**, *not* under `/api`.
* Requirements a package must satisfy: `dsh.client` must be an object and `dsh.client.platform` **must be a string** (else `client-modules: <pkg> dsh.client.platform must be a string`) — `packages/client/modules/src/client/manifest.ts:161-181`; optional `dsh.client.inject` (string array, `:170`), `dsh.client.external` (`:171`), `dsh.client.immediately` (boolean, `:172-174`); `exports["./client"]` must resolve to a string or an object with a string `default` (`packages/client/modules/src/index.ts:194-204`), otherwise `client-modules: <packageName> declares dsh.client but exports no "./client" bundle` (`:847`).
* Crucial coupling, stated by the reference plugin itself (`/Users/Admin/dsh-plugins/dsh-local-usage/cordis.patch.yml`): *"One row serves both halves. The row mounts the Host half (`main`), and because this package's manifest declares `dsh.client.platform: web`, that same row is what the client module table scans to find the browser half behind `exports["./client"]` — a package no row mounts never reaches the browser."* Its real manifest:
```json
"exports": { ".": {…}, "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
             "./cordis.patch.yml": "./cordis.patch.yml", "./package.json": "./package.json" },
"dsh": { "bundle": { "patch": "./cordis.patch.yml" },
         "client": { "platform": "web", "inject": [ "@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-layout",
                                                   "@deepseek-ai/dsh-client-ui-renderer", "@deepseek-ai/dsh-client-ui-sidebar" ] } }
```

### A6. Services a host plugin may `inject`

`inject` names cordis services; each service is declared by a `declare module '@deepseek-ai/cordis' { interface Context { … } }` augmentation. There are **137** such Context members across `packages/**/src`. The notable host-side ones, with the declaring file:

| Service | Type | Purpose / file |
|---|---|---|
| `tools` | `ToolRuntime` | **agent-callable tool registry** — `packages/core/tools/src/index.ts` |
| `fs` | `FileSystem` | sandbox-capable file provider — `packages/fs/fs/src/index.ts:47` |
| `webServer` | `WebServer` | node:http route registration — `packages/host/webserver/src/index.ts` |
| `connection` | `HostConnectionHandle` | `/api` RPC + exact Fetch routes — `packages/client/connection/src/rpc-host.ts` |
| `typertGateway` | `TypertGateway` | host dispatcher for Remote calls/streams/**forwarded events** — `packages/api/gateway/src/types.ts:170-173` |
| `shell` | `ShellExecutor` | shell command execution — `packages/shell/shell/src/index.ts` |
| `sandbox` / `sandboxPolicy` | `SandboxProvider` / `SandboxPolicyService` | OS confinement for spawned argv — `packages/sandbox/sandbox/src/index.ts`, `…/sandbox-policy/src/index.ts` |
| `storage` / `storageDomain` | `Storage` / `DomainFacility` | key-value persistent storage — `packages/storage/storage/src/index.ts` |
| `settings` | `SettingsForms` | settings forms/schema — `packages/settings/settings/src/index.ts` |
| `jobs` | `IJobs` | background job runtime — `packages/api/job-controller/src/client/service.ts` |
| `sessions` / `sessionQuery` | `SessionStore` / `SessionQueryEngine` | session store and full-text query — `packages/core/session/src/index.ts`, `packages/session-query/session-query/src/index.ts` |
| `workspaces` / `workspaceRegistry` / `workspaceFiles` | | workspace model + file API — `packages/workspace/workspace/src/index.ts`, `packages/api/workspace-files/src/index.ts` |
| `files`-adjacent: `attachments`, `fileReferences`, `fileUploads` | | attachment store, `@file` refs, raw blob upload route — `packages/attachment/attachment/src/index.ts`, `packages/context/file-reference/src/index.ts`, `packages/client/file-upload/src/index.ts` |
| `terminals`, `subprocess` | | PTY sessions, subprocess runtime — `packages/terminal/terminal/src/index.ts`, `packages/subprocess/subprocess/src/index.ts` |
| `skills`, `commands`, `hooks`, `mcpResources`, `webhookRuntime`, `schedule`, `goals`, `subagents`, `llm`, `tokenMeter`, `spillStore`, `lsp`, `approval`, `userQuestions` | | skill registry, slash commands, hooks, MCP resources, webhooks, cron, goals, subagents, LLM runtime, token metering, spill files, LSP, approvals, user questions |
| `hmr` | `Hmr` | live patch reconciliation gate — `packages/boot/hmr/src/index.ts` |
| `pluginManager`, `pluginPackages`, `pluginContext` | | profile plugin management / package metadata / profile context — `packages/boot/plugin-manager/src/index.ts:176`, `packages/boot/app-boot/src/profile-resolution/service.ts`, `…/profile-context.ts` |
| `configEditor`, `cmdlineArgs`, `appReady`, `appExit`, `launchEnvironment` | | config file editing, parsed CLI, lifecycle, launch env — `packages/boot/config-editor/src/index.ts`, `packages/boot/cmdline/src/index.ts` |
| `logger` | cordis built-in | `ctx.logger` — not a Context augmentation |

Client-side-only entries in that list (`slots`, `layout`, `theme`, `resources`, `clientModules`, `fileUpload`, `uiRenderer`, …) are declared in `*/src/client/*` and are not injectable from the host half.

**Yes — there is a service to register an agent-callable tool.** Exact signature:

```ts
// packages/core/tools/src/index.ts:1063
register(definition: ToolDefinition): () => void
```
`ToolDefinition extends ToolSchema` with a **mandatory canonical output declaration** and an `execute` (`packages/core/tools/src/index.ts:223-236`):

```ts
export interface ToolDefinition extends ToolSchema {
  readonly output: ToolOutputDefinition
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  projectContent?(…): ContentBlock[] | undefined
  finalizeContent?(…): ContentBlock[] | undefined
  timeoutMs?: number
  isConcurrencySafe?(args: unknown): boolean
  presentCall?(args: unknown): ToolCallView | undefined
  …
}
```
and you should build it with `defineTool` (`packages/core/tools/src/schema.ts:554-556`):
```ts
export function defineTool<const S extends ParameterSchemaSpec, const O extends ValueSchemaSpec>(
  options: DefineToolOptions<S, O>,
): ToolDefinition
```
Registering twice throws (`:747-748`). A real first-party example is `packages/schedule/schedule/src/tools.ts:416`:
```ts
disposers.push(toolCtx.tools.register(defineTool({
  name: 'schedule_create',
  description: CREATE_DESCRIPTION,
  parameters: { prompt: { type: 'string', required: true, description: '…' }, title: {…}, after_seconds: {…}, … },
  …
```
Other examples: `packages/experimental/tool-agent-team/src/index.ts:175`, `packages/experimental/browser-use-stagehand-native/src/index.ts:179`.

---

## B. Host filesystem and HTTP surface

### B7. Reading/writing files, and the canonical DSH home

**A sandboxed `fs` service exists and is the idiomatic choice.** `packages/fs/fs/src/index.ts:46-48` declares `fs: FileSystem`; `FileSystem` is an abstract cordis `Service` constructed as `super(ctx, 'fs')` (`:87-89`), with (partial list, all `index.ts`):
```ts
watch(target: FsTarget, changed: (error?: Error) => void, signal: AbortSignal): Promise<() => Promise<void>>  // :100
abstract resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>              // :132
abstract processPath(target: FsTarget): string                                                                // :142
abstract processPathFromHostPath(hostPath: string): string | undefined                                        // :152
abstract fileUrl(target: FsTarget): string                                                                    // :164
abstract contains(parent: FsTarget, child: FsTarget): boolean                                                 // :173
abstract stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>                            // :181
abstract lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined>   // :197
abstract readText(target: FsTarget, signal?: AbortSignal): Promise<string>                                    // :205
abstract streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>                   // :216
abstract readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>  // :228
abstract readByteRange(target: FsTarget, range: { offset: number; length: number }, signal?): Promise<Uint8Array> // :243
abstract listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>                               // :252
```

**Plain `node:fs` is also fine.** Nothing intercepts it: a host plugin is imported into the host process by the Loader (`import(name)`, `loader.js:214-227`), and the sandbox is an *argv wrapper for spawned subprocesses*, not an in-process guard — `SandboxProvider.confine`: "Wrap `argv` so it executes confined under `policy` on this host; the caller spawns the returned argv in place of its own." (`packages/sandbox/sandbox/src/index.ts:166-174`). The reference plugin indeed uses `node:fs` directly: `dsh-local-usage/src/rates.ts:20-21` (`readFileSync`, `mkdir/rename/writeFile` from `node:fs/promises`), `src/fold-cache.ts:28-29`.

**Canonical DSH home resolution** — `packages/util/home-paths/src/index.ts`:
```ts
export const DSH_HOME_DIR_NAME = '.dsh'            // :12
export const DSH_HOME_ENV = 'DSH_HOME'             // :18
export function defaultDshHome(): string           // :61   → join(homedir(), '.dsh')
export function expandHomePath(path: string): string // :70
export function resolveDshHome(configured?: string, env = process.env): string  // :87
export function dshHomePath(...segments: string[]): string                       // :98
export function dshCachePath(optionsOrSegment = {}, ...segments: string[]): string // :108
```
Precedence, quoted from `:79-82`: "an explicit configured path, `$DSH_HOME`, then `~/.dsh`. … An empty or whitespace-only `$DSH_HOME` is treated as unset". `DSH_HOME` is the **only** env override; there is no `DSH_PROFILE`/`DSH_CONFIG_DIR` in this function.

Is it importable by a third-party plugin? It is a real package, `@deepseek-ai/dsh-home-paths`, and the shipped app has it at `app.asar:/dsh/node_modules/@deepseek-ai/dsh-home-paths/lib/index.js`. It is **not** present in the desktop profile's `node_modules` (`~/.dsh/profiles/desktop/node_modules/@deepseek-ai` does not exist), so resolution depends on the install anchor rather than the plugin's own dependencies. The reference plugin therefore **reimplements** the rule instead of importing it (`dsh-local-usage/src/rates.ts:37-46`):
```ts
home: string = homedir(), …
const configured = env.DSH_HOME?.trim()
return configured !== undefined && configured.length > 0 ? configured : join(home, '.dsh')
```
That is the established third-party pattern; matching it exactly (`DSH_HOME` → `~/.dsh`, absolute-ised) is the safe call.

### B8. HTTP route registration via the Fetch carrier — **the critical section**

The service is `ctx.connection`, typed `HostConnectionHandle` (`packages/client/connection/src/rpc.ts:193-…`), provided in `packages/client/connection/src/rpc-host.ts`. Registration API as you described it:

```ts
// packages/client/connection/src/rpc.ts:155-163
export interface HostConnectionFetch {
  register(route: ConnectionFetchRoute): () => Promise<void>   // async disposer
}
```

**Exact `methods` union — only three verbs:**
```ts
// packages/client/connection/src/rpc.ts:138
export type ConnectionFetchMethod = 'GET' | 'HEAD' | 'POST'
```
**No `PUT`, `DELETE`, or `PATCH`.** Note `HostConnectionHandle.rpc.intercept` is documented with `channel: '/api'` only (`:185-189`) — the shared channel is `/api`, and a Fetch route's `path` is "**Absolute path below `/api`**; query parameters remain available on the request URL" (`:145`), so `path: '/localsend/upload'` is served at `/api/localsend/upload`. Methods a route does not own "continue through normal shared-channel dispatch" (`:147`).

**`requestBody` — exactly two values:**
```ts
// packages/client/connection/src/rpc.ts:140-150
export type ConnectionRequestBodyMode = 'buffered' | 'streaming'
…
/** Buffered requests obey the configured JSON cap; streaming requests arrive with backpressure and no aggregate cap. */
readonly requestBody: ConnectionRequestBodyMode
```
* `'buffered'`: the whole body is read into memory and the request is capped. The cap is **300 MiB**:
  ```ts
  // packages/client/connection/src/http-bridge.ts:10-14
  /** Default carrier cap for all HTTP RPC bodies: sized for the default
   * aggregate image limit (200 MiB) after base64 expansion plus envelope
   * headroom (~267.7 MiB required), rounded up for slack. The bridge buffers
   * each body in memory, so this cap is also the per-request resident bound. */
  export const DEFAULT_MAX_REQUEST_BODY_BYTES = 300 * 1024 * 1024
  ```
  Enforcement (`:58-78`): a declared `Content-Length` over the cap → `413` + `connection: close` + `req.destroy()`; the same when the accumulated stream crosses the cap.
* `'streaming'`: **no aggregate cap, true backpressure.** The body is handed over as a web stream:
  ```ts
  request = new Request(url, { method, headers,
    body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
    signal: abort.signal, duplex: 'half' } as RequestInit & { duplex: 'half' })   // :86-92
  ```
  **This is the mode your multi-gigabyte uploads must use.** A first-party streaming route already exists to copy from: `packages/client/file-upload/src/index.ts:76` (`requestBody: 'streaming'`) with `packages/client/file-upload/src/http-route.ts:42,69` (`data: requestBodyChunks(request.body)` / `async function* requestBodyChunks(body: ReadableStream<Uint8Array> | null)`).

**Response bodies: fully streamed, both ways.** A handler returns an ordinary `Response`; the bridge pipes `response.body` with backpressure and stops on disconnect:
```ts
for await (const chunk of response.body) {
  if (abort.signal.aborted) continue
  if (!res.write(chunk) && !res.destroyed) { … await drain / close … }        // http-bridge.ts:103-110
}
```
So returning `new Response(readableStream, { headers })` — e.g. `Readable.toWeb(fs.createReadStream(p))` — streams a download without buffering. Client disconnect aborts the handler via `res.on('close', …) → abort.abort()` (`:47-49`), and the `AbortSignal` is attached to the `Request` (`:83`, `:90`), so a streaming handler observes cancellation.

**Limits/timeouts to be aware of:** the only hard *size* limit on the carrier is the 300 MiB buffered cap; the only timeout I found on the carrier is a comment-level "no aggregate cap" for streaming — there is **no** read/response timeout in `http-bridge.ts`. The webserver's compression is configured (gzip, level 1, threshold 1024 B — `packages/bundle/web-app/cordis.patch.yml:174-176`); a compression layer over a large upload/download is worth checking in your own testing, and note the route sits behind `webServer`.

**Is the route reachable by an arbitrary HTTP client from the LAN? Short answer: the fence checks the `Host` header, not cookies — and cookie-less `curl` passes the fence whenever the `Host` is loopback or a declared trusted authority.**

The fence is `isTrustedApiRequest(request, trustedHosts)` (`packages/client/connection/src/api-request-trust.ts:91-118`), applied by `requestRejection`:
```ts
// packages/client/connection/src/rpc-host.ts:104-105
requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection {
  if (!isTrustedApiRequest(request, this.trustedHosts)) return 403
```
The checks, quoted:
```ts
const host = header(request.headers, 'host');
if (host === undefined) return false;
const hostUrl = parseAuthority(host);
if (hostUrl === undefined) return false;
if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;   // :103
if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false;                            // :106
const origin = header(request.headers, 'origin');
if (origin === undefined) return true;                                                                   // :112  ← no Origin is fine
try { return new URL(origin).host === hostUrl.host; } catch { return false; }
```
And the file's own header states the scope (`:10-13`): *"Non-browser and remote clients pass the same fence via loopback, deployment-derived LAN IP literals, or a declared `trustedHosts` authority. Network reachability and authentication stay out of scope: binding policy belongs to the webserver config, and this fence is not an auth layer."*

Consequences for a LocalSend-style plugin:
* **No DSH cookie/token is required** for `/api` — the fence is Host/Origin based, and a `curl` with no `Origin` passes the Origin branch (`:112`).
* But a request from another device carries `Host: <your-lan-ip>:<port>`; that is **not** loopback, so it must appear in `trustedHosts`. `trustedHosts` defaults to `[]` (`packages/bundle/web-app/src/index.ts:64`) and is normally populated **automatically when the server binds all interfaces**:
  ```ts
  // packages/bundle/web-app/src/index.ts:125-132
  const lanAddresses = bindHost === ALL_INTERFACES_HOST
    ? Object.values(networkInterfaces()).flat()
      .filter((iface): iface is NonNullable<typeof iface> => iface !== undefined && iface.family === 'IPv4' && !iface.internal)
      .map(iface => iface.address)
    : []
  return { lanAddresses, trustedHosts: [...lanAddresses, ...extra] }
  ```
  wired as `trustedHosts: !!js ctx.webRuntime.trustedHosts` on the `connection` row (`packages/bundle/web-app/cordis.patch.yml:215-222`), or via the repeatable CLI flag `--trusted-host <authority...>` (`packages/bundle/web-app/src/startup.ts:54`, values at `:84`).
* **The binding is the real obstacle.** The webserver bind is a two-value union — `host: '127.0.0.1' | '0.0.0.0'` (`packages/host/webserver/src/index.ts:61`, schema `:127`) — and the shipped default is loopback: `host: !!js ctx.webStartup.host ?? '127.0.0.1'`, `port: !!js ctx.webStartup.port ?? 3080` (`packages/bundle/web-app/cordis.patch.yml:172-173`). And the CLI **refuses** to bind all interfaces:
  ```ts
  // packages/bundle/web-app/src/startup.ts:74-76
  if (options.host === '0.0.0.0') {
    program.error('error: --host 0.0.0.0 is intentionally not supported yet for safety: it would expose remote code execution to the network; use 127.0.0.1 instead')
  }
  ```
  To bind all interfaces you must override the `webserver` row's `config.host` in a patch layer (`0.0.0.0` is schema-legal; only the CLI flag is refused).

**A second, likely easier path for LAN clients: `ctx.webServer.register` directly, which is NOT behind the `/api` fence.** `WebServer.register` is `register(route: WebRoute): () => void` with `WebRoute { kind: 'exact' | 'prefix', path, handler }` (`packages/host/webserver/src/index.ts:38-43`, `:166-169`), and the webserver contains **no** trust/auth logic at all — a grep for `requestRejection`/`isTrustedApiRequest`/`trust` in `packages/host/webserver/src/*.ts` and `packages/host/frontend-static/src/*.ts` returns nothing. Fencing is left to each route owner: `packages/host/open-in-app/src/index.ts:186` calls `connectionOf(ctx).requestRejection(req)` explicitly. So a plugin route registered on `webServer` is reachable by any client that can reach the socket, with no `Host` requirement — provided you bind a reachable interface. (The client-modules plugin uses exactly this for `/plugins`, `packages/client/modules/src/index.ts:649`.)

### B9. Own `node:http`/`node:https` server, and UDP multicast

**No restriction found; both appear permitted.**
* Plugin host halves are imported **in-process** into the host Node/Electron-main process (`loader.js:214-227`), so they are ordinary Node modules with `node:http`, `node:dgram`, etc. available.
* `packages/sandbox/` confines *spawned commands*, not the host process: `SandboxProvider.confine` returns argv to spawn (`packages/sandbox/sandbox/src/index.ts:92`, `:166-174`). The only `network` mention across `packages/sandbox/*/src` is a doc comment about what the Windows ACL sandbox does *not* restrict (`packages/sandbox/sandbox-windows-acl/src/index.ts:27`).
* **No network policy / capability list / port allowlist** was found in `packages/host/`, `packages/boot/`, or `apps/desktop-host/` that would gate a plugin's own sockets. The `networkExposure` setting is a red herring: the string `networkExposure` **does not occur anywhere in the shipped build** — I byte-searched the whole 121 MB `app.asar` (`grep -abo networkExposure …/app.asar`) and grepped `Contents/Resources/` excluding the asar, both with no hits — even though `dsh-desktop: { networkExposure: loopback }` is stored in `~/.dsh/settings.yaml.imported`. So nothing in 0.2.0-rc.2 consumes it as far as I can tell; do not rely on it either to permit or to block anything. (The live settings store is not `settings.yaml.imported`; I did not locate a live `settings.yaml`.)
* **macOS entitlements do not block listening.** `codesign -d --entitlements - "/Applications/DeepSeek Harness.app"` reports only `com.apple.security.cs.allow-jit`, `…cs.allow-unsigned-executable-memory`, `…cs.disable-library-validation`, `…device.audio-input`. There is **no `com.apple.security.app-sandbox`**, so the Hardened-Runtime network entitlements (`…network.server`/`…network.client`) are not applicable.
* **Electron boundary:** the host is the **main** process, not a renderer. The live command line is `/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness --expose-internals …/dsh-desktop-host/lib/index.js …`; the renderer processes are separate `Helpers (Renderer)` with `--enable-sandbox` and a `dsh-app:` custom scheme. Your plugin runs on the main side, so the renderer sandbox and the page CSP do not apply to it.
* Practical caveat, not a policy: macOS will prompt for **Local Network** access (and for a firewall exception if one is enabled) the first time you send to/bind a LAN address or join a multicast group. That is an OS consent prompt, not a DSH restriction.

### B10. Server-push to the browser half

**It exists, and it is not polling.** There are two supported shapes.

**(a) Forwarded Cordis events (`ctx.emit` on the host → `ctx.remote.$on` in the browser).**
* Host registration:
  ```ts
  // packages/api/gateway/src/types.ts:138-151
  export interface TypertGateway {
    readonly wireStream: TypertGatewayWireStream
    registerRemoteEvents(source: TypertRemoteEventSource, host: RemoteEventHostInfo): () => Promise<void>
    invoke(request: InvokeRemoteRequest): Promise<unknown>
    stream(request: InvokeRemoteRequest): Promise<AsyncIterable<unknown>>
  }
  declare module '@deepseek-ai/cordis' { interface Context { typertGateway: TypertGateway } }   // :169-173
  ```
  The first-party assembly does exactly this (`packages/api/remotes/src/index.ts:41-66`): `ctx.effect(() => ctx.typertGateway.registerRemoteEvents(remoteEventSource(ctx), { home: homedir() }), …)`, and the source subscribes with `ctx.on(event, …)` and pushes `{ event, args }` frames into a queue (`:51-54`).
* Client side: `$on<Event extends TypertRemoteEvent>(event: Event, listener: TypertClientEventListener<Event>): () => void` (`packages/typert/protocol/src/types.ts:448`) — "Subscribe to one forwarded Host event" (`:440`).
* Wire/typing constraint: only **carrier-compatible** Cordis events can be forwarded — "unscoped `void` notifications and scoped async waterfalls whose final parameter is their same-result `next()` callback" (`:163-170`), with the mode spelled `'emit'` or `'waterfall'` (`:172-179`). The event must also be listed in the app's allowlist constant `API_REMOTE_FORWARDED_EVENTS` (`packages/api/remotes/src/remote-events.ts:20-50`, rows like `{ event: 'plugin-manager/install-state', mode: 'emit' }`) and selected via `interface TypertRemoteEventSelection` (`packages/typert/protocol/src/types.ts:181-185`; a real declaration at `packages/api/session-controller/src/remote-events.ts:9-12`).
  *The good news for a third-party plugin:* `registerRemoteEvents` is on the **public** `typertGateway` service, so a plugin can inject `typertGateway` and register its **own** source at runtime without editing that allowlist constant — the allowlist only pre-selects what the app itself forwards.

**(b) Remote streams (server yields, client iterates).** `mode?: 'stream'` on a Remote method (`packages/typert/protocol/src/types.ts:329-330`), surfaced to the browser as `RemoteStreamHandle<Out, In>` with downlink iteration, uplink `send`, and `cancel` (`:83-119`). This is the right shape for a progress feed.

**(c) Cheapest fallback, and what the reference plugin pattern implies:** a `webServer` prefix route streaming `text/event-stream` or NDJSON. Note the transport itself: the connection bundle comment says the "browser half is the fetch/SSE client" (`packages/bundle/web-app/cordis.patch.yml:214`), while the 0.1.7 connection client code describes "HTTP + WebSocket" (`packages/client/connection/src/client/index.ts:75`, `:122`, and "API Gateway owns their WebSocket mux" at `rpc.ts:276`). I did **not** find `text/event-stream` used for host→browser push anywhere in `packages/` outside LLM streaming and tests. So: server-push is real via Typert events/streams; if you prefer raw SSE, do it on your own `webServer` route rather than assuming the `/api` carrier gives you one.

---

## Bottom line for a LocalSend host plugin

1. **Loading from a local directory works** without publishing — put an `insert` row in `~/.dsh/profiles/desktop/cordis.patch.yml` (the profile the running app uses) with `name:` pointing at your **entry file** (`…/lib/index.js`), or `pnpm add /abs/dir` from the profile to get a `link:`/symlink install plus a `dsh.profile.bundles` entry. Absolute paths are anchored into `file://` URLs by `packages/boot/app-boot/src/index.ts:346-356`; directory paths fail with `ERR_UNSUPPORTED_DIR_IMPORT` on Node 22 (verified).
2. **Config reaches `apply`** via the row's `config:` key; it is replaced wholesale by any later patch on the same `id`.
3. **The `/api` Fetch carrier gives you only GET/HEAD/POST** (`rpc.ts:138`) but gives you **uncapped streaming bodies in both directions** with `requestBody: 'streaming'` (`rpc.ts:141,149-150`; `http-bridge.ts:85-93,103-110`) — the 300 MiB cap applies only to `'buffered'` (`http-bridge.ts:14`).
4. **LAN clients are blocked twice over on the default install**, and neither block is authentication: the server binds `127.0.0.1` by default (`cordis.patch.yml:172`) *and* the CLI refuses `--host 0.0.0.0` (`startup.ts:74-76`); even once bound to all interfaces, `/api` requires the request `Host` to be loopback or a derived/declared trusted authority (`api-request-trust.ts:99-103`; LAN literals are auto-derived only for a `0.0.0.0` bind, `web-app/src/index.ts:125-132`). **For a LocalSend plugin the cleanest route is your own `ctx.webServer.register({ kind: 'prefix', path: '/…', handler })` route, which carries no trust fence at all** — you then own whatever authentication you need, and you must arrange for a LAN-reachable bind (override the `webserver` row's `config.host`).
5. **A plugin can open its own HTTP/UDP sockets** — the sandbox only wraps spawned argv, there is no network policy in the host, and the app is not App-Sandboxed.
6. **Server-push to your browser half is supported** via `typertGateway.registerRemoteEvents` + `ctx.remote.$on`, or via Remote streams; polling is not required.
