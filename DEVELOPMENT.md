# dsh-local-send 开发说明

给要改这个插件的人看的。使用者请读 [README.md](README.md)。

- [架构](#架构)
- [右键发送是怎么做到的](#右键发送是怎么做到的)
- [单机自测](#单机自测)
- [确认插件真的装上了](#确认插件真的装上了)
- [测试覆盖什么](#测试覆盖什么)
- [界面预览（同时是浏览器半边的回归检查）](#界面预览同时是浏览器半边的回归检查)
- [发布到 npm](#发布到-npm)
- [设计取舍记录](#设计取舍记录)

---

## 架构

```
┌─ DSH 主进程 ──────────────────────────────────────────┐
│  Host 半边 (src/index.ts)                             │
│   ├─ LocalSendServer    :53317  ← 手机/电脑直接连过来  │
│   ├─ MulticastDiscovery UDP     ← 组播收发             │
│   ├─ TransferRegistry           ← 双向传输状态 + 中止   │
│   └─ Fetch 路由 /api/dsh-local-send/*                 │
└───────────────────────┬───────────────────────────────┘
                        │ 同源 fetch（带凭据）
┌───────────────────────┴───────────────────────────────┐
│  Client 半边 (src/client/)                            │
│   面板 · 右键菜单 · 通知 · 小鱼同伴 · 接收横幅 · 输入框钩子 │
└───────────────────────────────────────────────────────┘
```

**为什么是两半。** 浏览器不能监听 socket，也不能加入组播组，所以发现和传输协议必须在 host 半边。反过来，唯一必须由浏览器做的事是：把用户拖进来的文件作为**活的流**交给 host——`File` 对象只在那次请求存在期间有效。

**为什么面板不直接连对端。** 它做不到，也不需要：所有对端交互都在 host 半边完成，面板只和 host 说话。

**大文件为什么不落盘。** 面板的字节流路由注册为 `streaming` 模式，DSH 的 fetch carrier 会把浏览器的原始请求体包成 web stream 交给处理器，带背压、无总量上限。所以拖拽一个 4 GB 文件是：浏览器 → host → 对端的**单趟**转发，只占一个缓冲区。（`buffered` 模式有 300 MiB 上限并整份驻留内存——那才是拖大文件会炸的写法。）

**为什么六个界面只用一个 facade。** `index.ts` 里有一个 `facade` 对象实现了所有动作，六个槽位各自 `Pick` 自己需要的那几项。原本每个槽位手写一份 `answer` 是可以的，五个手写副本就是 host 契约可能漂移的五个地方。

**为什么轮询是共享的。** 面板、通知、小鱼同伴、接收横幅都需要同一份状态，但它们挂载点不同、生命周期独立。各拉各的就是每拍四个请求、四份可能瞬时不一致的答案。所以只有一个轮询循环，按引用计数存活：通知常驻、面板打开时叠加，没人在看就完全不请求。节奏跟着 host 的 `busy` 走（传输中 500ms，空闲 2.5s，后台标签页 8s）。

**与 harness 的运行时耦合为零。** 构建产物只 `import "node:..."`；所有 `@deepseek-ai/*` 都是类型导入，编译期即被擦除。这是本包不会因 harness 版本变动而坏的原因，由 `tests/built.host.spec.ts` 守着——它也因此要求 `lib/index.js` 是**自包含**的单一产物，所以给 tsdown 加额外入口（哪怕只是为了测试方便）会让这条测试失败。

---

## 右键发送是怎么做到的

先说清楚一件事：**DSH 没有给插件用的右键菜单扩展点。** 全仓 `packages/client/*` 里 `onContextMenu` 只有三处，都是各包自己写死的；仅有的两个 menu-item 插槽是 `sidebar.workspaces.session.menu.item`（会话行的 `...` 菜单）和 `sidebar.right.tab.menu.item`（右栏标签菜单），跟文件无关。

所以这个功能不是「往 DSH 的菜单里加一项」，而是插件自己在 `document` 上挂 `contextmenu` 监听，自己弹菜单（用产品自己的 `Menu`）。它靠三处 DSH 自己渲染的标记认出「用户右键的是哪个文件」：

| 右键的位置 | 选择器 | 路径在哪 |
|---|---|---|
| 右侧文件树的每一行 | `[data-files-path]` | 属性值就是绝对路径，`[data-files-entry]` 顺带说明是不是目录 |
| 会话里的 `@文件` 引用 | `[data-ref-chip="file"]` | `title` 是引用原文，即 `@/绝对/路径`，带空格的路径会被 `@` 语法加引号 |
| 文档预览 / 交付物列表 / 文件树根 | `[data-path-label]` | `title` 是裸路径 |

**这里有个必须交代的风险**：这三处是 DSH 内部的约定，不是给插件用的公开 API。设计上因此写成「认不出就什么都不做」——三处都不匹配、或者匹配到的值不像绝对路径，`resolveTarget` 就返回 `undefined`，插件**根本不碰那个事件**，也不 `preventDefault`。所以在别处右键的行为和没装这个插件时一模一样；将来 DSH 改了标记，失效方式是菜单不再出现，而不是弹出一个发错文件的菜单。这条规则在 `src/client/context-target.ts` 里，有 34 项测试盯着。

顺带一个已知的小谎：`PathLabel` 的标记里没有「这是目录」的信息，而它的三个用点里有一个是文件树的**根**（目录）。插件不去猜，一律当文件发，由 host 自己的 `isDirectory` 检查拒掉并把原因显示出来。

---

## 单机自测

只有一台电脑也能测完整的收发，因为**组播开了环路**（`setMulticastLoopback(true)`）：同一台机器上的两个成员能互相听见对方的广播，而 HTTP 打到 `127.0.0.1` 和打到隔壁房间在协议上没有区别。

`scripts/fake-peer.mjs` 就是那第二个成员——一个不依赖任何东西的 Node 脚本（只用内置模块），同时实现了协议的**两半**：

```bash
# 常驻：作为一台设备出现在面板的"附近设备"里，并接收你发给它的文件
node scripts/fake-peer.mjs --name "测试手机"

# 主动发文件给你，触发接收通知 / 横幅 / 小鱼同伴
node scripts/fake-peer.mjs --send ~/Pictures/a.png ~/Documents/b.pdf

# 定向发给非默认端口，或带上 PIN
node scripts/fake-peer.mjs --send a.pdf --to 192.168.1.9:53317 --pin 1234

# 模拟"对方只收一部分"（token map 里只放匹配的文件）与"对方拒绝"（403）
node scripts/fake-peer.mjs --accept 报告
node scripts/fake-peer.mjs --decline

# 常驻 + 立即发一批（发送完不退出，方便继续观察）
node scripts/fake-peer.mjs --send a.pdf --stay
```

它把每一步都念出来（收到的 offer、通过/拒绝、每个文件的字节数与耗时、校验和是否匹配），所以一次传输可以从两端同时对照。发给它的文件默认落在 `./fake-peer-inbox/`。

两个环回自测脚本把这件事跑成了可重复的断言，各覆盖一个方向：

```bash
node scripts/fake-peer-selftest.mjs          # 假设备 → 插件接收端（真实 HTTP，校验和核对）
node scripts/fake-peer-selftest-reverse.mjs  # 插件的发送端 → 假设备（真实 HTTP，校验和核对）
```

它们起的是**真的** `LocalSendServer`、真的发现循环、真的 socket：正向那个用 `autoAccept` 起一个接收端，让假设备发一个 34000 字节的随机负载过去，然后对磁盘上的文件重算 SHA-256；反向那个让假设备以纯接收方常驻，用 `sendPaths` 把文件推过去，再核对落盘内容。

> 这两个脚本用 `scripts/ts-source-loader.mjs` 直接加载 `src/*.ts`。node 自带的类型擦除跑不了参数属性（`constructor(private readonly host: Host)`），而这个 loader 用的是本仓库自己的构建器里的 oxc transform，所以不需要额外依赖。它必须用 `import` 而不是 `require` 取那个 transformer——在 loader 的钩子里 `require` 会在模块系统握手中途重入，报一个和真实原因毫不相干的 `resolveSync is not implemented`。

---

## 确认插件真的装上了

```bash
node scripts/verify.mjs [--origin http://127.0.0.1:19387] [--port 53317]
```

它会检查**十二件事**，其中只有对着运行中的 Harness 才能验证的几件最有价值：

| 检查 | 证明了什么 |
|---|---|
| profile 是否声明了这个 bundle / 依赖 | Loader 会不会挂载它 |
| 传输 API 在监听 | host 半边真的激活了，而不只是被读到了 |
| `/plugins/dsh-local-send/client.js` 可访问 | 客户端半边进了 boot 图 |
| boot 清单里有这个插件 | 页面知道要加载它 |
| 组播主动广播被听到 | 别的设备能发现你 |
| 收到广播后回拨 `/register` | 你能发现别人 |
| 回拨携带可用身份 | 对端记录里的别名和端口是对的 |
| 端口归属 | 53317 上确实是哪个进程 |

默认状态下应当是 **11/12 通过**。唯一失败的是「client bundle is served」：它在没带凭据时拿 404，装没装好都一样。真正的信号是「传输 API 在监听」和「端口归属」。

后两项发现检查用一个**临时的假 LocalSend 对端**完成（`scripts/lib/discovery-probe.mjs`）：它在组播组里广播自己，然后等着被回拨。这不需要 Harness 的凭据（传输 API 是插件自己开的监听，不走应用鉴权），也不需要人工点确认。

这个探测本身也有测试盯着：`tests/probe.host.spec.ts` 让它对着本仓库自己的发现循环跑，证明该触发时确实触发——一个有 bug 的探针会把健康的插件报成坏的。

---

## 测试覆盖什么

`pnpm test` 跑 **194 项**，12 个文件：

| 文件 | 覆盖 |
|---|---|
| `tests/pure.host.spec.ts` | 协议解析（不可信输入边界）、文件名安全、格式化函数 |
| `tests/receiver.host.spec.ts` | 接收端全流程，走**真实 HTTP**：校验和、token 绑定、PIN 锁定、路径穿越、重名、并发会话、逐文件接收、取消后 token 失效、发送方卡住时取消 |
| `tests/roundtrip.host.spec.ts` | 发送端 ↔ 接收端环回：批量、大文件分块、失败撤回、重名去重、取消中止在途上传 |
| `tests/plugin.host.spec.ts` | host 入口按 Loader 的方式激活：十一条路由全部注册、流式模式、面板路由的参数校验、优雅卸载（会证明 53317 端口被释放，否则重载会绑不上而变成聋子） |
| `tests/client-bundle.client.spec.ts` | 浏览器 bundle 的包装契约、导出、六个槽位注册、两个 overlay cell 的 id |
| `tests/manifest.host.spec.ts` | 包本身能否被安装：用**产品自己的 `parseDshClient`** 校验清单、bundle patch 的 YAML 形状、入口文件存在、模块图无环 |
| `tests/probe.host.spec.ts` | 标定验证脚本里的假对端 |
| `tests/built.host.spec.ts` | 导入**构建产物** `lib/index.js`（加载器真正加载的那个文件，其余测试都测 `src/`）并激活它；并断言它运行时只导入 Node 内置模块 |
| `tests/reference.client.spec.ts` | 「加入会话」的决策与传递：mention 语法、引号规则、只消费一次、过期；以及接收提醒的规则（同一个 offer 关掉就保持关闭，新的 offer 仍要弹出） |
| `tests/state.client.spec.ts` | 共享轮询：没人看时零请求、忙碌 500ms / 空闲 2.5s / 后台 8s、失败可恢复、慢请求不叠加、卸载后到达的响应被丢弃 |
| `tests/context-target.client.spec.ts` | 右键落点解析：三处标记各自的规则、优先级、`@` 与引号剥离、以及**拒绝**——相对路径、控制字符、`data-ref-chip="session"`、以及什么都没有的情况都必须解析成"没有目标" |
| `tests/companion.client.spec.ts` | 小鱼同伴的优先级：待确认的 offer 压过在途传输、单文件点名/多文件计数、最近更新的在途行优先、完成后按「结束时间」而不是「开始时间」选行、余温会过期、四种失败都读作同一种"失落"、store 还没答案时是空闲而不是报警、**该出现和该消失都有测试盯着** |

---

## 界面预览（同时是浏览器半边的回归检查）

```bash
pnpm run preview
```

它用真实组件渲染**十个场景**并截图到 `preview/dist/`，跑在产品自己的主题样式表和它自己的 `Toast` / `Menu` 组件上——包括接收提醒，那不是本插件画的界面，是产品组件被本插件的文案和规则驱动。

其中 `fish-light` 是个例外，值得单独说：它是**唯一一个用断言判断不了的界面**。`data-fish-mood` 只能证明挂载的是对的那个姿态，证明不了那 18 像素的小东西看起来像不像一条鱼——那只有眼睛能回答，而这是唯一能放一只眼睛的地方。所以它把一个姿态按真实尺寸画在真实按钮里、再放大到 96 像素画一遍，以及把进度环走一整圈：小尺寸看不清是排版问题，大尺寸画错是绘图问题，两者不是同一件事。

它不只是"生成图看"，每个场景都带**断言**：渲染必须没有异常，且页面上必须出现预期的元素。任何一个场景白屏就退出码非 0。这一层是必要的，因为浏览器半边在插件被载入 GUI 之前没有别的方式可查——而白屏的截图和一个"本来就没有内容"的场景长得一模一样。

匹配的是元素属性而不是裸类名：内联的样式表里含本插件定义的每一个类，只搜 `dls-panel` 会搜到 CSS，然后把白屏判成成功。

预览跑在一个临时 HTTP 服务上而不是 `file://`：Chrome 把每个本地文件当独立不透明源，脚本一旦出错只会回报一句 "Script error."，把真正的原因藏起来。失败原因会写进页面（`<pre id="preview-error">`），所以断言失败时会连带说出是哪一步、什么异常。

`preview/dist/` 是被 git 忽略的——它是用来看面板的方式，不是谁要安装的产物。README 里的三张图是另外裁出来放进 `docs/` 的（`docs/*.png`，会随 npm 包一起发布）。

---

## 发布到 npm

包名 `dsh-local-send`（不带 scope，所以默认就是公开的）。发布前先看一眼包里到底装了什么：

```bash
npm pack --dry-run          # 打印清单和体积，不产生文件
npm pack                    # 生成 dsh-local-send-0.1.0.tgz，可以解开来核对
```

白名单在 `package.json` 的 `files` 里：`lib`（加载器真正读的产物和类型声明）、`cordis.patch.yml`（bundle 补丁）、`src`（源码，也让两个自测脚本在装好之后仍可运行）、`scripts`（`verify.mjs` 和假设备工具）、`docs`（README 里的三张图）、`DEVELOPMENT.md`。`README.md`、`LICENSE`、`package.json` 由 npm 自动带上——**所以 README 里引用的 `docs/*.png` 必须在 `files` 里**，否则图片在 npm 页面上会裂。

`lib/` 是**提交进仓库**的，不靠安装时构建：这样安装不依赖"装包的人允许跑依赖脚本"。也正因如此，发布前要确保它是最新的：

```bash
pnpm run build              # 只重建产物
pnpm test                   # pretest 会先 build，然后跑 194 项
```

`prepublishOnly` 已经挂成 `npm test`，所以 `npm publish` 时会自动重建 + 全量测试，不过就不会发出去。

真正发布：

```bash
npm login                   # 需要 npm 账号
npm publish
```

版本号按语义化版本改（`npm version patch|minor|major`）。**第一次发布前先确认名字没被占**：

```bash
npm view dsh-local-send     # 404/Not found 才是可以用的
```

如果被占了，要么改名（`package.json` 的 `name`，连同 `cordis.patch.yml` 里的 `name` 字段和 README 里的安装片段一起改——profile 的 `bundles`/`dependencies` 引用的是包名），要么换成 scope（`@your-name/dsh-local-send`，那需要加 `"publishConfig": { "access": "public" }`）。

发布之后，用户装的是 npm 上的版本而不是 `link:` 本地路径：

```json
"dependencies": { "dsh-local-send": "^0.1.0" }
```

---

## 设计取舍记录

几个不那么显然的决定，都写在对应源文件的模块注释里：

- **不做自签证书** → `src/protocol.ts` 顶部
- **进度是传输行的左边缘**（结构而非装饰）、**所有实时数字用等宽数字** → `src/client/styles.ts` 顶部
- **拖拽用计数器而非布尔值**（`dragleave` 会在进入子元素时触发）→ `src/client/LocalSendPanel.tsx` 顶部
- **"加入会话"为什么走 `@路径` 引用而不是附件上传** → `src/client/ComposerEntry.tsx` 顶部
- **发送端为什么必须发 `cancel`** → `src/outbound.ts` 的 `cancelOffer`
- **右键菜单为什么是插件自己的、以及为什么认不出就完全不动那个事件** → `src/client/context-target.ts` 顶部（连同三处 DSH 内部标记的出处）
- **通知面为什么由同一个组件裁决两件事**（offer 永远压过确认消息，且被压掉的确认消息是丢弃而不是排队）→ `src/client/NoticeToast.tsx` 顶部
- **确认消息为什么走一个模块级 store 而不是面板内 state**（"加入会话"这个动作本身就把面板切走了）→ `src/client/flash.ts` 顶部
- **小鱼的心情为什么是几何而不是颜色**、**为什么按 0.15 的透明度画一圈轨道** → `src/client/fish.tsx` 顶部
- **`skipped` 和 `declined` 为什么是两个状态**（前者是用户自己不要，后者是别人/规则不给；把前者算进"未完成"会让一个全须全尾的传输显示成"部分完成"）→ `src/types.ts` 的 `FileStatus`
- **取消为什么必须先答复再断连**（先 `destroy` 会把响应一起带走，发送方只看到连接断开而不知道原因）→ `src/server.ts` 的 `cancelSession`
- **中止信号为什么会为一次还没开始的取消而创建**（只 abort 已存在的 controller，会在"第一字节还没发就取消"这个最常见的情况下静默失效——这条是被测试抓出来的）→ `src/transfer.ts` 的 `stopperFor`
- **为什么 `setMulticastInterface` 之前必须等 bind** → `src/discovery.ts` 的 `listening`
- **与 harness 的运行时耦合为零** → 见上文[架构](#架构)，由 `tests/built.host.spec.ts` 守着
