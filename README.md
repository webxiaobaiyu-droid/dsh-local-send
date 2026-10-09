# dsh-local-send

在 DeepSeek Harness 里和同一内网的其他设备互传文件——手机、另一台电脑、别人的机器，只要是跑着 [LocalSend](https://github.com/localsend/localsend) 或本插件的设备都行。

收到的文件落在本机磁盘上，可以**一键把引用插进当前会话的输入框**，让 Agent 直接读取它。

---

## 它长什么样

三个界面，各管一件事：

| 界面 | 在哪 | 干什么 |
|---|---|---|
| **隔空传文件**面板 | 左侧边栏 → 主区域 | 看附近设备、拖文件发送、看传输进度、把收到的文件加进会话 |
| **接收提醒** | 全局浮层（右上） | 有设备要发文件给你时弹出，带「接收 / 拒绝」按钮。切到任何面板都会出现 |
| **输入框钩子** | 会话输入框 | 「加入会话」按下后，把 `@路径` 引用插进草稿，不覆盖你已输入的内容 |

发送的两种方式：

- **拖拽**：把文件拖到「附近设备」里的某台设备磁贴上，松手即发。字节从浏览器请求直通对端，中间不落盘。
- **按路径**：直接填本机绝对路径（每行一个），零拷贝从磁盘流式发送，适合大文件和 workspace 里的文件。

---

## 与 LocalSend 的兼容性

实现了 LocalSend 协议 **v2.2** 的这部分：

**发现**
- 组播 `224.0.0.167:53317`，每 3 秒广播一次自身，TTL 1，开启环路（同机多实例也能互相发现）
- 收到 `announce: true` 后，用 HTTP `POST /api/localsend/v2/register` 回拨；回拨失败则退回组播应答（`announce: false`）
- 按 `fingerprint` 抑制自发现；对端 18 秒不再广播即从列表移除
- 多网卡逐个加入组，并按接口切换组播出口
- 旧版子网扫描作为**手动**动作（「搜索」按钮），不做定时——它要为子网每个地址发一个请求，不该自动跑

**接收（本机作为服务端）**
- `POST /register`、`GET /info`
- `POST /prepare-upload`（含 `?pin=` 与 90 秒等待人工确认）
- `POST /upload?sessionId&fileId&token`（裸二进制流；token 与来源 IP 绑定）
- `POST /cancel`（含**无 sessionId** 的按地址撤回——v2.0~2.2 的发送方在拿到 prepare 响应前不知道 sessionId）
- 状态码与错误体按参考实现：错误一律 `{"message": "..."}`，`204` 表示"无需传输"，校验和不符为 `422`，PIN 错 3 次后该地址 `429` 且不恢复

**发送（本机作为客户端）**
- `prepare-upload` → 并发 2 路上传 → 失败时 `cancel` 撤回
- 文件 ≤ 256 MiB 时在 offer 里带 SHA-256；更大的文件跳过（要多读一遍全盘，而单段 LAN 的完整性已由传输层保证）

**没有实现**
- **HTTPS / 自签证书**。本插件广播 `protocol: "http"`，靠 `fingerprint` 用随机串标识自己——这正是协议为「不能出示可信证书的设备」预留的路径，官方 App 会照 `protocol` 字段用明文 HTTP 通信。代价见[安全说明](#安全说明)。
- **反向下载 API**（`prepare-download` / `download`）。它的用途是让浏览器从没有 LocalSend 的设备拉文件；本插件的面板直接和自己的 host 通信，不需要它，所以如实广播 `download: false`。
- **分片 / 断点续传**。协议本身没有，传输中断只能重新开一个 session 从头发。

> 顺带一提：[`localsend/web`](https://github.com/localsend/web) 现在是 **WebRTC-only**（协议 2.3），并不实现上面这套 HTTP 协议。本插件的协议实现是照着 [`localsend/protocol`](https://github.com/localsend/protocol) 规范和官方 App 的 Rust core 写的。

---

## 架构

```
┌─ DSH 主进程 ──────────────────────────────────────────┐
│  Host 半边 (src/index.ts)                             │
│   ├─ LocalSendServer    :53317  ← 手机/电脑直接连过来  │
│   ├─ MulticastDiscovery UDP     ← 组播收发             │
│   ├─ TransferRegistry           ← 双向传输状态          │
│   └─ Fetch 路由 /api/dsh-local-send/*                 │
└───────────────────────┬───────────────────────────────┘
                        │ 同源 fetch（带凭据）
┌───────────────────────┴───────────────────────────────┐
│  Client 半边 (src/client/)                            │
│   主面板 · 接收提醒 · 输入框钩子                        │
└───────────────────────────────────────────────────────┘
```

**为什么是两半。** 浏览器不能监听 socket，也不能加入组播组，所以发现和传输协议必须在 host 半边。反过来，唯一必须由浏览器做的事是：把用户拖进来的文件作为**活的流**交给 host——`File` 对象只在那次请求存在期间有效。

**为什么面板不直接连对端。** 它做不到，也不需要：所有对端交互都在 host 半边完成，面板只和 host 说话。

**大文件为什么不落盘。** 面板的字节流路由注册为 `streaming` 模式，DSH 的 fetch carrier 会把浏览器的原始请求体包成 web stream 交给处理器，带背压、无总量上限。所以拖拽一个 4 GB 文件是：浏览器 → host → 对端的**单趟**转发，只占一个缓冲区。（`buffered` 模式有 300 MiB 上限并整份驻留内存——那才是拖大文件会炸的写法。）

**为什么轮询是共享的。** 面板和接收提醒都需要同一份状态，但它们挂载点不同、生命周期独立。各拉各的就是每拍两个请求、两份可能瞬时不一致的答案。所以只有一个轮询循环，按引用计数存活：提醒常驻、面板打开时叠加，没人在看就完全不请求。节奏跟着 host 的 `busy` 走（传输中 500ms，空闲 2.5s，后台标签页 8s）。

---

## 安全说明

**传输是明文的。** 局域网内任何能嗅探流量的人都看得到文件内容。这是本插件为了「不需要生成和分发自签证书、装完即用」而做的取舍，也是协议 `protocol: "http"` 字段存在的意义——但不是零代价，请自行判断是否接受。

减轻风险的部分：
- 所有进入的传输**默认必须人工确认**（`autoAccept` 可关，见下）
- 可设 PIN，错 3 次该地址被拒且不恢复
- upload token 与发出 offer 的 IP 绑定，token 只在对端接受后才生成
- 文件名按**单一路径段**校验（拒绝 `.`、`..`、含分隔符或控制字符），先写随机名到 `.partial/` 再改名——路径穿越没有落点，而不是事后过滤
- 单文件 / 单次传输 / 文件数三重上限，在**读第一个字节之前**就按元数据筛掉

**面板侧。** 「加入会话」只做一件事：把收到的文件路径作为 `@路径` 引用插进输入框，不发送任何消息。插不插、发不发，仍然是你的动作。

---

## 配置

装好即可用，所有字段都有默认值。要改就在 profile 的 `cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: local-send
  name: "@deepseek-ai/dsh-local-send"
  config:
    alias: "我的 Mac"          # 对外显示的设备名；留空则用面板里改过的名字
    port: 53317               # 协议默认端口
    deviceType: desktop       # mobile | desktop | web | headless | server
    autoAccept: false         # true = 不询问直接收
    pin: ""                   # 非空则要求发送方带 ?pin=
    maxFileBytes: 17179869184      # 单文件 16 GiB
    maxTransferBytes: 68719476736  # 单次 64 GiB
    maxFiles: 500
    receiveDir: ""            # 留空 = ~/.dsh/local-send/inbox
```

> 提示：patch 会**整体替换**该行的 `config`，所以改的时候要把想保留的键一起写上。

**文件位置**（都在 `$DSH_HOME` 或 `~/.dsh` 下）

```
local-send/
├── device.json     # 设备名 + fingerprint（删掉会换一个新身份，对端会当成新设备）
└── inbox/          # 收到的文件
    └── .partial/   # 传输中的临时文件
```

---

## 安装

```bash
cd ~/.dsh/profiles/desktop
# package.json 的 dsh.profile.bundles 加上 "dsh-local-send"
# dependencies 加上 "dsh-local-send": "link:/绝对路径/dsh-plugins/dsh-local-send"
pnpm install
```

然后重启 DSH。

**卸载**：从 `bundles` 和 `dependencies` 里删掉那两行，`pnpm install`，重启。收件箱里的文件不会被删。

---

## 开发

```bash
pnpm install
DSH_SRC=/path/to/deepseek-harness pnpm run link:host   # 链接 harness 的包（每次 pnpm install 后要重跑）
pnpm run build          # 两半 + 类型声明
pnpm run typecheck      # 分别检查 host / client（两半的 Context 合并冲突，必须分开）
pnpm test               # 141 项测试（会先自动构建，因为其中一项测的就是构建产物）
pnpm run preview        # 渲染界面截图到 preview/dist/（真实组件 + 产品主题样式表 + 无头 Chrome）
pnpm run watch          # 增量构建
pnpm run check          # 类型检查 + 测试 + 界面回归，一条命令跑完
```

改动后需要重启 DSH 才会生效（host 半边的代码没有文件监听）。

### 确认插件真的装上了

```bash
node scripts/verify.mjs
```

它会检查九件事，其中三件是只有对着**运行中的** DSH 才能验证的：

| 检查 | 证明了什么 |
|---|---|
| 传输 API 在监听 | host 半边真的激活了，而不只是被读到了 |
| `/plugins/dsh-local-send/client.js` 可访问 | 客户端半边进了 boot 图 |
| 组播主动广播被听到 | 别的设备能发现你 |
| 收到广播后回拨 /register | 你能发现别人 |

后两项用一个**临时的假 LocalSend 对端**完成：它在组播组里广播自己，然后等着被回拨。这不需要 DSH 的凭据（传输 API 是插件自己开的监听，不走应用鉴权），也不需要人工点确认。

### 测试覆盖什么

| 文件 | 覆盖 |
|---|---|
| `tests/pure.host.spec.ts` | 协议解析（不可信输入边界）、文件名安全、格式化函数 |
| `tests/receiver.host.spec.ts` | 接收端全流程，走**真实 HTTP**：校验和、token 绑定、PIN 锁定、路径穿越、重名、并发会话 |
| `tests/roundtrip.host.spec.ts` | 发送端 ↔ 接收端环回：批量、大文件分块、失败撤回、重名去重 |
| `tests/plugin.host.spec.ts` | host 入口按 Loader 的方式激活：路由注册、流式模式、优雅卸载 |
| `tests/client-bundle.client.spec.ts` | 浏览器 bundle 的包装契约、导出、四个槽位注册 |
| `tests/manifest.host.spec.ts` | 包本身能否被安装：用**产品自己的 `parseDshClient`** 校验清单、bundle patch 的 YAML 形状、入口文件存在、模块图无环 |
| `tests/probe.host.spec.ts` | 标定上面那个验证脚本：让它对着本仓库自己的发现循环跑，证明该触发时确实触发 |
| `tests/built.host.spec.ts` | 导入**构建产物** `lib/index.js`（加载器真正加载的那个文件，其余测试都测 `src/`）并激活它；并断言它运行时只导入 Node 内置模块 |
| `tests/reference.client.spec.ts` | 「加入会话」的决策与传递：mention 语法、引号规则、只消费一次、过期；以及接收提醒的规则（同一个 offer 关掉就保持关闭，新的 offer 仍要弹出） |
| `tests/state.client.spec.ts` | 共享轮询：没人看时零请求、忙碌 500ms / 空闲 2.5s / 后台 8s、失败可恢复、慢请求不叠加、卸载后到达的响应被丢弃 |

### 界面预览（同时是浏览器半边的回归检查）

`pnpm run preview` 用真实组件渲染八个场景并截图，跑在产品自己的主题样式表和它自己的 `Toast` 组件上——包括接收提醒，那不是本插件画的界面，是产品组件被本插件的文案和规则驱动。

它不只是"生成图看"，每个场景都带**断言**：渲染必须没有异常，且页面上必须出现预期的元素。任何一个场景白屏就退出码非 0。这一层是必要的，因为浏览器半边在插件被载入 GUI 之前没有别的方式可查——而白屏的截图和一个"本来就没有内容"的场景长得一模一样。

匹配的是元素属性而不是裸类名：内联的样式表里含本插件定义的每一个类，只搜 `dls-panel` 会搜到 CSS，然后把白屏判成成功。

预览跑在一个临时 HTTP 服务上而不是 `file://`：Chrome 把每个本地文件当独立不透明源，脚本一旦出错只会回报一句 "Script error."，把真正的原因藏起来。失败原因会写进页面（`<pre id="preview-error">`），所以断言失败时会连带说出是哪一步、什么异常。

### 设计取舍记录

几个不那么显然的决定，都写在对应源文件的模块注释里：

- **不做自签证书** → `src/protocol.ts` 顶部
- **进度是传输行的左边缘**（结构而非装饰）、**所有实时数字用等宽数字** → `src/client/styles.ts` 顶部
- **拖拽用计数器而非布尔值**（`dragleave` 会在进入子元素时触发）→ `src/client/LocalSendPanel.tsx` 顶部
- **"加入会话"为什么走 `@路径` 引用而不是附件上传** → `src/client/ComposerEntry.tsx` 顶部
- **发送端为什么必须发 `cancel`** → `src/outbound.ts` 的 `cancelOffer`
- **与 harness 的运行时耦合为零** → 构建产物只 `import "node:..."`；所有 `@deepseek-ai/*` 都是类型导入，编译期即被擦除。这是本包不会因 harness 版本变动而坏的原因，由 `tests/built.host.spec.ts` 守着
- **为什么 `setMulticastInterface` 之前必须等 bind** → `src/discovery.ts` 的 `listening`

---

## 已知限制

- 明文传输（见上）
- 无断点续传：中断即从头再来
- 一次只服务一个传入会话（协议的 `409` 语义）。第二个发送方会被告知对端正忙
- 收件箱不会自动清理，也不做去重（同名文件加 ` (1)` 后缀另存）
- 「加入会话」需要当前有打开的会话；没有会话时引用会被丢弃而不是排队
