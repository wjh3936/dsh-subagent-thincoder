# 需求：dsh-subagent-thincoder（dsh 侧的 thincoder ACP 委派插件）

> 本档是本项目的需求档（项目需求 + 工具面规格同处一档 —— 本项目只有一个对外面，
> 拆档会立刻产生两份必须同步的文本）。设计档见 `docs/design/`，实施记录见批次档。

## 0. 背景与问题

dsh 想把手上的活委派给 ThinCoder CLI，走的是 ACP（Agent Client Protocol）：
dsh 起一个 `thincoder acp` 子进程，用 ACP 会话与它对话。

现在这条路走不通，原因在 dsh 侧：

- `@deepseek-ai/dsh-subagent-acp` 每次 run 的握手是写死三步：`initialize` → `session/new` → `session/prompt`，
  run 结束就关进程；既不保存远端会话号，也没有 `session/load` / `session/resume` 调用面。
- dsh 自带的「可续用子代理」机制只服务**进程内**子代理：续用管理器把子代理物化成本进程的一个真 Agent，
  provider 参与的唯一口子是 `prepareContinuable`（返回父会话的事件种子）。跨进程的 ACP 子代理进不了这条路。

后果（用户实测）：同一个 dsh 会话里第二次委派 thincoder，等于开了一条全新的 thincoder 会话槽；
上一条会话里评审通过后拿到的 designToken 存在**旧槽**里，新槽看不见，流程接不上。

ThinCoder 那一侧已经齐了：它的 ACP 服务宣告了 `loadSession: true` 与
`sessionCapabilities: { list, resume, delete, close }`，并实现了 `session/{list,load,resume,delete}`。
而且 designToken 的权威台账是**会话槽文件**，装载旧槽时会被读回内存，所以
「接回同一条槽」就等于「token 回来了」。

## 1. 模块目标

让 dsh 能把 ThinCoder CLI 当作一个**可续用的**子代理来用：
同一工作区、同一个 dsh 会话下，后续委派默认接回上一次的 thincoder 会话槽，
使跨多次委派的多步流程（尤其工程模式的评审 → 令牌 → 实施）能够连续走完。

## 2. 功能点

功能点即本批次的条目集（批次档 §2 与台账同源）。

### P1 插件包形态与挂载

- 本仓产出一个可被 dsh 装载的插件包：`package.json` 带 `dsh.bundle.patch`，包内 `cordis.patch.yml` 声明插件行，
  代码导出 `name` / `inject` / `apply` / `Config`。
- 零构建：源码为纯 ESM `.mjs`，dsh 直接加载，不需要打包或编译步骤。
- 可挂载性以 dsh 实际装载不报错为准（缺注入项必须启动即失败，不得静默降级）。

### P2 ACP 子代理 provider

- 注册一个子代理 provider（名字可配，默认 `thincoder`），一次委派 = 起一个 `thincoder acp` 子进程，
  握手 `initialize` → 会话建立（`session/new` 或续用，见 P3）→ `session/prompt` → 收结果 → 断开。
- 子进程 cwd 由**宿主**解析为父会话**当前**目录后经 start request 注入（可配置覆盖，见 P12）；插件**不自算** cwd。
- thincoder 是单 cwd 模型：会话建立要求 `cwd` 与进程 cwd 一致。
- 权限：`session/request_permission` 按配置自动应答（`allow` 取第一个 allow 选项 / `reject` 一律取消），
  不向人上抛。
- 结果：只取子代理最终答复的文本（`agent_message_chunk` 累积）；思考、工具调用、计划不上抛。
- stopReason 映射：`end_turn`→`completed`、`max_tokens`→`max-tokens`、`refusal`→`refusal`、
  `cancelled`→`aborted`、`max_turn_requests` 与未知值→`error`。
- 失败诊断文本沿用 dsh 现有的固定安全形态（stage / category / stop reason / exit code），
  不把工具入参、文件内容、环境变量、凭据、原始协议载荷写进去。

### P3 会话续用与持久化（本模块的核心）

- **默认续用**：同一「dsh 会话 + 工作区」下，首次委派建立新槽，之后默认接回上一次的槽。
- **显式覆盖**：委派参数可显式要求新开会话，或显式指定要接回的会话号。
- 持久化：把「父会话 + 工作区 → thincoder 会话号」落盘，进程重启后仍可续用。
- 续用必须跨进程成立：接回旧槽走 `session/resume`（不重放历史），不是 `session/load`（会重放历史而不被消费）。
- 接回旧槽后，该槽里原有的会话态（含 designToken）在该次委派的 thincoder 会话内可用。
- **续用的层次**：默认续用面向**同一任务的多步流程**（评审 → 令牌 → 实施的多次委派须落同一槽）；
  插件**没有任务边界的信号**（委派参数面只有 `description` / `prompt`，续用键 = 父会话 + 工作区），
  故「一个新任务开一个新会话」只能由**调用方**以显式 `new: true` 决定。

### P4 模型面工具

一个模型面工具 `subagent_thincoder`，参数与返回如下。

| 参数 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `description` | string | 是 | 这次委派的短标签（给人看） |
| `prompt` | string | 是 | 交给 thincoder 的任务正文 |
| `sessionId` | string | 否 | 显式接回指定会话号；与 `new` 互斥 |
| `new` | boolean | 否 | 显式开新会话（默认 false） |
| `run_in_background` | boolean | 否 | 本次委派是否走后台 job（见 P11）；不给则由配置叶 `runInBackground` 决定，**显式给值恒胜** |

返回（**两种形态**，见 P11）：**前景形态** = 子代理的最终答复文本 + 一行本次 thincoder 会话号（供下一步显式引用）；
**后台形态** = 一个后台 job 号，最终答复文本与会话号**仍须等价可达**（经该 job 的输出与终值取回）。

错误（工具必须返回可读原因，不得挂死）：父会话无 cwd、cwd 不可用、会话号不存在、
工程模式前置不满足（见 P6）、子进程启动失败、协议失败。

### P5 槽生命周期与并发

- 断开子进程前先发 `session/close`，释放该槽的进程认领；异常路径（取消、失败）同样尽力释放。
  否则残留认领会让下一次接回被迫 fork 到新槽，续用形同虚设。
- 插件**不自造全局锁**：同一工作区的多路并发委派一律放行，槽冲突交给 thincoder 自己的
  「占用则 fork」语义处理。
- 会话号回报：`session/new` 面取应答的会话号；`session/resume` 面应答不含号，取请求里的会话号。
  并发下若发生 thincoder 的静默 fork，回报的号可能与实际槽不一致 —— 属已知限制，如实告知使用方。

### P6 工程模式前置

- 接回一个工程模式会话时，thincoder 会先解析目标工作区的工程档；**不可解析**（档非法 / 候选项目歧义 /
  就地建档失败）则整条拒载。
- 「工作区没有工程档」**不是**拒载面：thincoder 会在锚处就地建档后照常接回，插件不得把缺档当失败。
- 插件必须把拒载变成**可读的工具错误**（透出 thincoder 的稳定锚句「项目不可解析」与档名），
  不得表现为超时或无因失败。

### P7 会话枚举

- 提供列出当前工作区已有 thincoder 会话的能力（走 `session/list`），让人或模型能挑一条旧会话来接。

### P8 验证面

- 每个功能点的变更面配单元测试文件（随批次档存放，直接 `node --test` 跑）。
- 端到端验收按第 4 节的 AC 逐条可执行。

### P9 跨平台启动（Windows）

- 在 Windows（win32）上，**默认配置**即可完成一次委派 —— 不需要使用者手工改 `command` 才能用。
- `command` 的语义是「可执行名或路径」，**不是**「必须带扩展名的文件名」：win32 下按该平台的命令解析规则
  （PATH + PATHEXT）解析；解析结果为不能直接执行的形态（npm 装出来的 `.cmd` / `.bat` shim）时，
  经命令解释器启动。
- **禁止**把安装路径写死进代码或默认配置（Node 位置、包管理器布局、用户主目录一律不得进默认值）。
- 非 Windows 平台的启动形态不变（不引入解释器包装层）。
- 解析失败 / 启动失败必须表现为**可读的工具错误**（沿用 P2 的固定安全诊断形态），不得挂死。
- Windows 上，配置的 `args` 若含命令解释器元字符（`%` / `&` / `|` / `<` / `>` / `^`），
  必须在**起进程前拒绝**并报可读错误 —— 不得交给解释器「照跑」（那些字符会被解释器自己解释，语义已变形）。
  非 Windows 平台不受此限（同字符在该平台是普通字符）。
- win32 上从配置环境取解释器候选 `ComSpec` 时**大小写不敏感**（`COMSPEC` 与 `ComSpec` 等价）——
  不得比插件所调用的 dsh seam 更严；候选顺序（配置环境 → 宿主环境 → 字面 `cmd.exe`）不变。
- **启动形态单一来源**：把「命令 + 参数 + 环境」解析成最终 argv 的规则**只实现一处**（平台适配模块），
  委派面与枚举面调用同一函数、同一入参形状；不得面各算一遍。
- **解析结果必须可用**：解析面给出的目标必须是可执行的绝对路径；win32 语义下解析面返回空值 / 非字符串
  视同解析失败（可读错误 + 零进程），与解释器候选面同口径。

### P10 续用键的路径归一

- 续用记录的键含工作区路径；在**大小写不敏感**的文件系统上，同一工作区以不同大小写形态进入时，
  必须命中**同一条**记录（否则 P3 的默认续用静默失效）。判据是**目标路径所在文件系统的大小写语义**；
  win32 上的大小写折仅作 realpath 给不出答案时的**补充**，且由冻结面钉死 ——
  macOS 默认 APFS 卷大小写不敏感，同属判据面；大小写敏感的文件系统上两种形态仍是两条记录。
- **同一工作区的符号链接别名与真实路径必须命中同一条记录**：键按 realpath 规范化构造，
  纯字符串规范化不足以合一 `/tmp/ws` 与 `/private/tmp/ws` 这类别名。
- **realpath 失败必须回退，不得抛错**：路径不存在 / 不可解析时退回字符串规范化结果，照常构造键；
  委派本身的失败面仍由 P2 / P6 的既有诊断承担。
- 归一化只作用于**键的构造**，不改变委派实际使用的 cwd。

### P11 非阻塞委派（后台 job）

- **默认后台**：委派默认走 dsh 的后台 job 路径（`ctx.jobs`），工具**立即返回**一个 job 号；
  thincoder 执行期间主会话**不被阻塞** —— 仍可继续推进，且插入对话（inject / steer）的消息能在**下一个步边界**被消费并得到回应。
- **配置叶与参数两级**：配置叶 `runInBackground`（行为叶，默认 `true`）**只决定默认值**；
  委派参数 `run_in_background` 逐次覆盖，**显式参数恒胜**。该叶**不是**能力门 —— 不设「叶关掉后显式传 `true` 即拒」的分支。
- **前台仍可达**：`run_in_background: false` 时行为与既有前景形态**逐字不变**（阻塞等待 + 直接返回答复文本与会话号）。
- **两种形态的回报面等价**：后台形态下，最终答复文本与本次 thincoder 会话号**必须等价可达**
  （会话号回报是本模块存在的理由，见 P3 / AC-2 / AC-4 / AC-9）—— 不得因后台化而丢失 P4 的返回值。
- **`jobs` 是软取**：`jobs` 服务**不进**本插件的硬注入面。服务不在位时：**显式要求后台**须报可读错误（不得静默阻塞调用方）；
  **默认路径**退回前景（零回归）。
- **终止路径的槽释放**：后台 job 被取消 / owner 释放 / 服务卸载时，仍按 P5 的「先 `session/close` 再收进程」释放槽认领。
- **不改既有口径**：后台形态**不改变** P5 的并发放行，也**不改变** P3 的默认续用；并发上限沿用宿主既有设置，本插件不新增阈值。

### P12 宿主版本面（dsh `0.2.1-rc.2` · 单版本）

- **单版本支持**：插件只支持 dsh **`0.2.1-rc.2`** 的 subagent seam；不支持 `0.2.0-rc.2` 及更早（不提供双版本兼容分支）。
- **启动面**：一次委派 = `ctx.subagents.startActivation({ provider, label, request, signal, delivery })`，内层 `delivery: 'caller'`
  （前景四键契约沿用 P4）。
- **会话号回带**：真实 thincoder 会话号经**插件私有载体**回带给工具，**不**依赖宿主透传 provider 返回值；`dispose()` 之后工具仍能读回。
  必须给出**两条不同的可读错误**：**启动未完成**（`startActivation` 抛错）与 **已建立但回带丢失**（返回收据但载体为空）。
  不得以空串冒充会话号；启动未完成时也**不得**声称「会话根本没建立」—— 宿主可能在建立后又回滚。
- **cwd**：子进程 cwd 由**宿主**解析（父会话当前目录）；`config.cwd` 非空 = 请求覆盖（起进程前校验），`''` = 不传 `request.cwd`（继承宿主当前目录）。
  该语义与旧 `Session.header.cwd`（原始项目身份）**不等价**：用户切过目录后两者分叉。
- **结算**：以 `activation.result` + `activation.dispose()` 落 P4 / P11 的状态语义；工具侧**必须**显式 `dispose()`
  （teardown 失败的唯一暴露面）。
- **取消**：调用方取消经 `activation.dispose()` 生效 —— 前景接工具步信号、后台接 job 的 controller；
  `startActivation` 之后调用方信号不再连到 run。

## 3. 边界（本模块不做什么）

- 不改 dsh 核心，不改 `@deepseek-ai/dsh-subagent-acp` 包；本插件独立存在。
- 不接入 dsh 的「可续用子代理」机制（`startContinuable` / `send_message` / 冷启动恢复）——
  那条路要求子代理由续用管理器在**本进程内**物化成真 Agent，跨进程 ACP 子代理结构上进不去。
- 不做长驻子进程：不维持一条跨多次委派的常驻 `thincoder acp` 进程（本批次按「每次起进程 + 接回旧槽」交付）。
- **后台 job 走的是上一条禁止之外的路径**：它是 dsh 的 **one-shot 后台**路径（`ctx.jobs.start` + 普通一次性 `ctx.subagents.start`），
  **不触**上一条禁止的 `startContinuable` / `prepareContinuable` / `send_message`。
- 不消费 `session/load` 的历史重放；不向 dsh 前端上抛思考 / 工具调用 / 子代理事件。
- 不自研模型路由与权限策略：只提供 permission 的 allow / reject 两档。
- 不写 thincoder 侧的任何文件；不改 thincoder 仓库。
- 平台适配只用 dsh 的公开能力（用到哪些在 §5 依赖里列明），不依赖未公开的内部接口。

## 4. 验收标准

| # | 对应 | 验收内容 | 判定方式 |
|---|---|---|---|
| AC-1 | P1 | dsh 能装载本插件并启动，无缺失注入 | 按扩展方式挂载后启动，日志无 loader 报错 |
| AC-2 | P3 | 同 dsh 会话、同工作区连续两次委派，命中**同一条** thincoder 槽 | 两次工具返回的会话号相同；且该槽文件的消息数在第二次后继续增长（同一文件，不是新槽） |
| AC-3 | P3 | 显式开新会话时槽号变化 | 第二次带 `new: true`，返回的会话号与第一次不同 |
| AC-4 | P4 | 显式指定会话号时命中该槽 | 传入 AC-2 的会话号，返回同一会话号 |
| AC-5 | P5 | 委派结束后目标槽**无残留认领**，下一次可钉回同槽（不被 fork） | 委派结束即刻再次接回同一槽，返回的会话号仍相同 |
| AC-6 | P6 | 工作区工程档不可解析时，接回工程会话返回可读错误 | 在放了一份**非法工程档**的工作区接回工程会话，工具错误文本含稳定锚句「项目不可解析」，且不是超时 |
| AC-7 | P7 | 能列出当前工作区的 thincoder 会话 | 调用枚举能力，返回集合含 AC-2 的会话号 |
| AC-8 | P2/P4/P8 | 单元测试全绿 | 对变更面跑 `node --test`（对应测试文件），全通过 |
| AC-9 | P3 | designToken 跨委派可用（本模块存在的理由） | 端到端一次：第一条会话内评审通过产出令牌 → 第二次委派接回同槽 → 该会话内令牌可用；以 thincoder 侧令牌台账存在且被接受为准 |
| AC-10 | P9 | Windows 上默认配置完成一次委派 | 在 Windows 上按扩展方式挂载后调用工具，成功返回子代理答复；不出现 `ENOENT` / `EINVAL` 类启动失败 |
| AC-11 | P9 | 非 Windows 平台启动形态不变 | 单元测试断言：POSIX 下解析结果不产生解释器包装；win32 语义由注入平台的用例覆盖 |
| AC-12 | P10 | 同一工作区两种大小写形态按**目标文件系统语义**判定 | 单元测试：大小写不敏感语义下两种形态构造出同一键；大小写敏感语义下仍是两个键（两种语义均须可测） |
| AC-13 | P9 | Windows 上含解释器元字符的 `args` 被拒绝 | 单元测试：win32 语义下逐一注入 `%` `&` `\|` `<` `>` `^` ⇒ 返回可读错误且不起进程；同一参数在 POSIX 语义下逐字放行；`(` `)` 两侧均不拒绝 |
| AC-14 | P10 | 符号链接别名与真实路径命中同一条记录 | 单元测试：`/tmp/ws` 与 `/private/tmp/ws` 类别名构造出同一键；路径不存在时回退为字符串规范化结果、**不抛错** |
| AC-15 | P9 | win32 上配置的 `COMSPEC` 与 `ComSpec` 等效 | 单元测试：win32 语义下 `{COMSPEC: …}` 与 `{ComSpec: …}` 取到同一解释器；候选顺序（配置 → 宿主 → 字面）不变 |
| AC-16 | P9 | 启动面单一来源 | 结构机检：`src/**` 内 `resolveLaunchArgv(` 出现 2 次（1 定义 + 1 调用）、`process.platform` 出现 1 次；行为：委派面与枚举面**传入同一字段集合**（入参形状 = 行为叶三字段 `command` / `args` / `env`，来源均为该面的行为叶），且在同一行为叶下交给 `spawn` 的 argv 逐字相同 |
| AC-17 | P9 | 解析结果可用性（win32 语义下的守卫） | 单元测试：win32 语义下解析面返回空串 / 非字符串 ⇒ `launchError` 同族可读错误且 `spawn` 零调用；POSIX 面逐字不受影响 |
| AC-18 | P9 / P10（Linux 宿主面） | 在**可用的 Linux 宿主**（容器或真机）上执行取证契约（四档既有单测 + 两条探针），读数逐格等于期望读数表 | **条件性验收**：触发条件 = 存在可跑的 Linux 宿主（容器运行时就位且镜像可得）；判定 = 宿主内 `node --test` 四档 + 两条探针，逐格比对；**不满足时判为「不满足」**（非「通过」），按取证契约的降级口径如实标注「未在真 Linux 上跑过」并把 Linux 实证登记为带触发条件的待办 —— 不得写成「已验证」、不得用「后续再补」代替处置 |

| AC-19 | P11 / P5 | 后台 job 终止（取消 / owner 释放 / 服务卸载）后，目标槽**无残留认领**且子进程已回收 | 单元测试 + 端到端：对已建立的后台委派执行取消 ⇒ teardown 仍走「先 `session/close` 再收进程」；随后接回同槽返回同一会话号、无 fork 后缀 |
| AC-20 | P11 | 后台委派执行期间主会话**仍可被响应** | 端到端：发起后台委派后，在 thincoder 仍在执行期间向主会话插入一条消息 ⇒ 该消息在**下一个步边界**被消费并得到回应（不是等 thincoder 结束后才被读到） |
| AC-21 | P12 | 隔离 profile 上装载并跑通一次委派（a1–a3 · b–e · f · g 逐项） | 判定面见下方「AC-21 判定面」块（隔离 `DSH_HOME` + 顶层 insert + npx 0.2.1 的 dsh） |

**AC-21 当前状态（2026-10-18 · 已转实测通过）**：见下方「AC-21 实测记录」。

**AC-21 实测记录（2026-10-18 · 升级后父代理在真环境执行）**

**环境**（与判定面 0 的隔离配方**不同**，据实说明）：用户在适配完成后自行升级了全局安装，故本轮在**真实 web profile**上执行，而非隔离 `DSH_HOME`。
- `dsh --version` = **`0.2.1-rc.2`**；`thincoder --version` = **`0.12.75`**；
  `@deepseek-ai/dsh-{subagent,tools,storage-domain,subprocess}` 四个 `package.json` 的 `version` 均 = **`0.2.1-rc.2`**（逐包读值，非推断）。
- 进程 = 升级后新启动（升级前旧实例已终止）。
- 兼容门：`>=0.2.1-rc.2` 的 peer 下界对 `0.2.1-rc.2` **放行**（逐包 simver 判定，0 个 unmet）；对 `0.2.0-rc.2` **拒绝**（4 个 unmet peer）。

| 项 | 结果 | 实测证据 |
|---|---|---|
| **a1** 装载无错 | ✅ | `import('src/index.mjs')` 在 0.2.1 真树成功（`name='dsh-subagent-thincoder'`、`inject` 四项）；会话全程无 loader / `SyntaxError` / `is not a function` 报错 |
| **a2** 模型可应答 | ✅ | 本轮会话正常推进（即证路由可用） |
| **a3** preset 会话内工具可见 | ✅ | 直接调用 `subagent_thincoder_sessions()` 成功返回 18 个槽 —— 工具**在模型工具面内且可执行** |
| **b** 委派返四键 | ✅ | `run_in_background: false` ⇒ 返回答复正文 + `[thincoder session] 18`；`status = completed`、`sessionId` 非空 |
| **c** 默认续用同槽 | ✅ | 同会话不传 `new` 再调 ⇒ 仍回 **`18`**；且答复**引用了上一轮 `pwd` 的输出**（跨委派记忆完好） |
| **d** 后台形态 | ✅ | `run_in_background: true` ⇒ 立即返回 `jobId`；`job_output` 读回答复文本（`BACKEND_OK`） |
| **e** cwd 随当前目录 | ✅ | **双组对照**（prompt 逐字相同）：组一当前目录 = 一次性的临时目录 ⇒ 答复该临时目录；组二当前目录 = 仓库根 ⇒ 答复仓库根的绝对路径。**两次不同** ⇒ 证明取当前目录，而非旧 `header.cwd` |
| **f** 显式接回 | ✅ | 显式 `sessionId: 18` ⇒ 返回同一号，且答复**准确复述**前两轮命令（`pwd` 与 `echo BACKEND_OK`）及其输出 |
| **g** 枚举与槽增长 | ✅ | 枚举含 `18`；槽文件 `~/.thincoder/sessions/e7880be0….json.18.d/seg-000007.jsonl` 于委派时段写入（59 行，mtime = 02:34）⇒ 同号**且槽确实在增长** |

**载体盒回带链**：`~/.dsh/storages/subagent_thincoder.json` 的 `session_links` 中 slot `18` 记录的 `updatedAt` 在本次委派后刷新（写入距检查时刻 1.0 分钟）⇒ 盒 → driver → store 落盘链路实通。

**仍未验（据实保留）**：
- **D4 失败抛错的实跑**：本轮全部成功，未触发失败路径；该分支仍只有单测覆盖（用例 85）。
- 判定面 0 的**隔离 `DSH_HOME` 配方本身**未被执行（改为真 profile 实测）；其前置面（`--dump-config` 合成树）此前已单独验过。

**结论**：AC-21 的 a1–a3 / b–g **全部实测通过**；e 项以双组对照满足判据。↑ 三条保留项不属 AC-21 判据面。

### AC-21 判定面（可执行 · 实施末期由父代理执行）

**0 · 工具链与依赖准备**（评审轮次 1 号 5 的补齐；原配方缺版本核验与依赖就位步骤）

- dsh 可执行 = 该版本 dsh 安装树中的 `bin/dsh`（`command -v dsh` 可解出）；`--version` 必须**逐字** `0.2.1-rc.2`。
- **版本核验**（不得以「npx 装过」推断）：读 `@deepseek-ai/dsh-subagent` / `@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app` 三个 `package.json` 的 `version`，把读数记进报告。
- **依赖就位**：隔离 profile 的 `node_modules` **不新装** —— 用符号链接指向上述 npx 树里的两个 bundle 包，本插件用 `link:<repo>`；
  随后在 profile 目录里对三个包逐个 `require.resolve` 一次（任一失败即装载期必失败，先在此报出）。

**0.1 · 隔离根与 profile 形态**

- `DSH_HOME=<repo>/.thincoder/tmp/b12-dsh-home`（**不进 git**，收尾前删）；profile 目录 `profiles/b12/`：
  `package.json`（bundles = `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`；dependency `dsh-subagent-thincoder: link:<repo>`）、
  `node_modules/dsh-subagent-thincoder` → 本仓符号链接、`cordis.patch.yml` = 顶层 `insert` 本插件行（与部署 profile 同形）。
- **模型路由与凭据**：从部署 profile 的 patch **只复制路由行**（provider / model / 凭据引用）。复制后必须自检：
  ① `DSH_HOME=… dsh --profile b12 --dump-config` 的合成树里**插件行与路由行都在**；
  ② 起会话发一条空提示，确认**模型真的回话**（证明路由可用）；
  ③ 凭据若指向宿主 `~/.dsh` 下的文件，确认它在隔离 `DSH_HOME` 下**仍被读到** —— 读不到就如实报「凭据在隔离根下不可用」，
  **不得**去改 `~/.dsh/profiles/web/` 凑通（边界）。

**0.2 · 会话与 preset**

- 启动 = `DSH_HOME=… <dsh> --profile b12`（交互 TUI）；**preset 取该 profile 缺省**（不指定 `--preset`），
  会话创建后先让模型「列出你可用的工具名」—— 这一步同时承担 a2 与 a3（两类失败要能分开看）。

**a 装载（三件分开判）**

- a1：启动后日志**无** loader / `SyntaxError` / `is not a function` 报错。
- a2：模型能正常应答（路由可用，不与插件混判）。
- a3：模型工具面含 `subagent_thincoder` 与 `subagent_thincoder_sessions`（**preset 会话内**，不是裸会话）。

**b 委派**：`subagent_thincoder(description:…, prompt:…, new: true, run_in_background: false)` ⇒ 返回四键，`status = completed`、`sessionId` 非空。

**c 默认续用**：同会话再调一次（**不传 `new`，且显式 `run_in_background: false`** —— 缺省口径可能走后台，只回 `jobId` 就无法比号）⇒ 返回**同一** `sessionId`。

**f 显式接回**（AC-4 的证据面）：`subagent_thincoder(…, sessionId: <b 的号>, run_in_background: false)` ⇒ 返回同一号；**且**答复能引用上一轮内容（证明真的接回旧槽，不是新建）。

**g 枚举与槽增长**（AC-7 / AC-2 的持久面）：`subagent_thincoder_sessions()` ⇒ 列表含该号；
再比对 thincoder 会话槽文件（布局 `{hash}.json.N` + `.manifest`，见 §6 事实表；路径取该 CLI 的会话目录）在 **b → c** 之间的消息条数**增长** —— 同号但槽没长，就等于没接回。

**d 后台**：`run_in_background: true` ⇒ 立即返回 `{kind:'background', jobId}`；`job_output` 读回答复文本与 `[thincoder session] <id>`。

**e cwd**：会话内 `working_directory({ cd: <非仓库内目录 X> })`，然后 `subagent_thincoder(prompt: '运行 `pwd`，只回复输出', run_in_background: false)`；
答复文本**逐字**等于 X。对照组 = 同一条调用在仓库根目录下再做一次（prompt 一字不变）⇒ 答复 = 仓库根。
**两次结果不同**才算证明；只跑一次无法区分「当前目录」与旧 `header.cwd`。两组均**必须传 `run_in_background: false`** —— 否则默认走后台、只回 `jobId`，拿不到答复文本。

**不重叠声明**：AC-21 只判**宿主版本面**；AC-19 / AC-20 的判据**原样不动**，其残余面仍归台账 #34。

## 5. 依赖

- dsh 安装态 **`0.2.1-rc.2`**（**单版本支持**，见 P12；`0.2.0-rc.2` 及更早不支持），宿主服务：`subagents`、`subprocess`、`tools`、
  以及持久化所需的服务（按设计定）。
- 后台形态另用 dsh 的 **`jobs` 服务**（`ctx.jobs.start` + 模型面 `job_output` / `job_kill` / 完成通知）——
  **软取**，不进本插件的硬注入面（P11）。
- `@agentclientprotocol/sdk` 1.4.0（已随 dsh 安装），提供 `session/{new,load,resume,list,delete,close}` 等客户端方法。
- dsh 的 `subprocess` 服务**公开方法** `resolveExecutable(command, env?, signal?)` —— 命令解析（win32 下按 PATH + PATHEXT 展开候选），
  平台适配面唯一用到的 dsh 能力（`deepseek-harness/packages/subprocess/subprocess/src/index.ts:133`）。
- ThinCoder CLI 可执行文件（容器外依赖），其 ACP 服务需具备会话族能力（见第 6 节出处）；
  **适配验证基线 = `0.12.76` + core `0.10.9`**（见 §5.1；`0.12.73` / `0.12.75` 的 ACP 面与之零断点）。
- 工程模式会话要求目标工作区的工程档**可解析**；缺档时 thincoder 就地建档，不算失败（详见 P6）。

### 5.1 ThinCoder 兼容基线（版本钉定 + 依赖的 ACP 面清单）

**钉定的验证基线**：`thincoder` **`0.12.76`**（core `0.10.9`）。这是**验证基线**，不是运行期硬校验 ——
插件不读 `thincoder --version`，也不在启动前比版本号；基线变了只说明「需要重新验证一次」，不改代码。

**为什么是「面清单」而不是版本下界**：插件与 ThinCoder 之间只有 ACP 协议这一层契约。只要下面这张面向后兼容，
版本号怎么涨都不影响本插件；反过来，版本号没变而面被改掉，才是真断点。故兼容性判据 = **面**，版本只是取证的锚点。

| # | 依赖的 ACP 面 | 本插件的用法 | 断点会怎样 |
|---|---|---|---|
| 1 | `initialize`（`protocolVersion` 协商） | 发 `PROTOCOL_VERSION`（SDK 侧 = 1）；不声明任何 `clientCapabilities` | 握手失败 ⇒ 委派在 `stage: initialize` 报 transport 失败 |
| 2 | `session/new` | 传 `{ cwd, mcpServers: [] }`；**响应必须带非空 `sessionId`** | 缺 id ⇒ 「published a session without a session id」 |
| 3 | `session/resume` | 传 `{ sessionId, cwd }`；**不读返回值**（ACP 不回 id，请求里的 id 即本会话 id） | 报错 ⇒ `sessionError('resume', …)`，不静默换新槽 |
| 4 | `session/prompt` | 传 `{ sessionId, prompt: textBlock[] }`；读 `stopReason` ∈ `end_turn` / `max_tokens` / `refusal` / `cancelled` / `max_turn_requests` | 未知值一律映射 `error`（不谎报 `completed`，见 `src/stop-reason.mjs`） |
| 5 | `session/cancel`（notification） | 取消时尽力发一次，进程 teardown 仍是权威 | 发不出去仅少一次协作取消，不影响结算 |
| 6 | `session/close` | **在 reap 进程之前**释放槽；未知会话应静默成功 | 失败 ⇒ 槽保持占用 ⇒ 下次委派被 thincoder fork 到新槽 |
| 7 | `session/list` | 读 `sessions[].{sessionId,title,updatedAt}`（`cwd` 本插件不消费） | 字段缺失被 `normalizeSession` 兜成空串，不崩 |
| 8 | `session/request_permission`（agent→client 请求） | `allow` 取首个 `allow_once`/`allow_always`；否则答 `cancelled` | 子进程等不到应答 ⇒ 委派挂起至超时 |

**不依赖、因此不作为断点判据的面**（2026-10-20 逐项核对源码确认）：

- `session/load`（本插件从不调用，只用 `resume`）、`session/delete`、`session/set_*`、`session/update` 的非 `agent_message_chunk` 成员
- thincoder 的 `ledger/*`、`batch/*`、`read-data` watcher、TUI 与配置面 —— 与 ACP 委派路径无关

**两处「读 child 自有文本」的软依赖**（匹配不到也不会坏，只是少一条提示）：

- `AUTH_REQUIRED`：出现在错误里时，把裸协议码翻成「thincoder 未认证」
- `项目不可解析`：出现在错误里时，补一句「目标工作区的工程档无法解析」

**已实测的零断点区间**：`0.12.73` → `0.12.75` → `0.12.76` 三次升版，`thincoder-cli/src/acp/` 的变更均不落上表 1–8 面。
`0.12.76` 的实测见下方「§6 末行」与 `docs/USER-SKILL-delegate-to-thincoder.md` 并行记录的踩坑面。

## 6. 关键事实出处

本节只登记外部事实，供设计与实现引用；不复述设计。

| 事实 | 出处 |
|---|---|
| dsh ACP 客户端每次 run 只走 `initialize`→`session/new`→`session/prompt`，无 load/resume | `deepseek-harness/packages/subagent/subagent-acp/src/run.ts:483-507` |
| dsh ACP 客户端 dispose 直接关进程，不发 `session/close` | `deepseek-harness/packages/subagent/subagent-acp/src/run.ts:193-213`、`:604-617` |
| dsh 续用管理器把子代理由本进程物化，provider 只提供 `prepareContinuable` 种子 | `deepseek-harness/packages/subagent/subagent/src/types.ts:219-244`、`:374-389` |
| dsh 工具面 `backgroundMode: one-shot \| continuable`，continuable 需要 provider 具备续用能力 | `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent/lib/types/index.d.ts:37-41` |
| thincoder ACP 宣告 `loadSession: true` 与会话族能力 | `thincoder/thincoder-cli/src/acp/client-caps.mjs:57-60` |
| thincoder 会话族实现（会话号 = 持久槽号字符串；占用则 fork 新槽） | `thincoder/thincoder-cli/src/acp/handlers-slots.mjs` |
| thincoder `session/new` 要求 `params.cwd === process.cwd()` | `thincoder/thincoder-cli/src/acp/handlers-session.mjs:177-181` |
| thincoder 槽认领由 `session/close` 释放 | `thincoder/thincoder-cli/src/acp/handlers-session.mjs:275-290` |
| 接回工程模式旧槽要求工作区工程档可解析，否则拒载 | `thincoder/thincoder-cli/src/acp/handlers-slots.mjs:79-84` |
| 工程档判据树：缺档 + init 默认 true ⇒ 就地建档（**不拒**）；拒载仅 invalid / ambiguous / init-failed，文案族「项目不可解析」 | `thincoder/thincoder-core/manifest.mjs:200-235` |
| designToken 落会话槽文件并在装载时回内存 | `thincoder/thincoder-core/token-ttl.mjs:112-147`、`:233-296` |
| designToken 默认有效期 7 天 | `thincoder/thincoder-core/agent-tools/design-token.mjs:36` |
| thincoder 槽文件布局 `{hash}.json.N` + `{hash}.json.manifest` | `thincoder/thincoder-core/session.mjs:9-10` |
| Windows 上 thincoder 以 npm shim 落地（`thincoder` / `.cmd` / `.ps1`），无 `.exe` | 本机实测（`where thincoder` + `existsSync`），2026-10-07 |
| win32 上 spawn 裸名只追加 `.exe` ⇒ `ENOENT`；直接 spawn `.cmd` 抛 `EINVAL` | 本机实测，Node v24.13.0 |
| 批处理内容即使挂 `.exe` 名也执行不了（CreateProcessW 不执行批处理） | 本机实测（硬链接 + spawn → `UNKNOWN`） |
| `cmd.exe /d /s /c <cmd>` 包装下 ACP 可通：`initialize` 正常应答，关 stdin 后 230ms 正常退出 | 本机实测，2026-10-07 |
| dsh subprocess 接口不做 shell 解释 | `deepseek-harness/packages/subprocess/subprocess/src/types.ts:78` |
| dsh win32 解析器只探 `.com` / `.exe`，解析结果直交 `CreateProcessW` | `.../subprocess-local/src/runner-launch.ts:231-240`、`spawn-runner.ts:295-317`、`.../win32-process/src/process.ts:562-570` |
| dsh 另有一处按 PATHEXT（含 `.CMD`）展开的解析器，公开为 `resolveExecutable` | `.../subprocess-local/src/index.ts:140`、`:173-180` |
| `env: {}` 语义 = 继承（清洗后的）宿主环境，不是空环境 | `.../subprocess-local/src/spawn.ts:44-54` |
| thincoder 自身已做 win32 路径大小写归一 | `thincoder/thincoder-cli/src/acp/handlers-session.mjs:169-180` |
| dsh 0.2.1 启动面 = `startActivation`（`{provider,label,request,signal,delivery}`）；无 `ctx.subagents.start` | `deepseek-harness/packages/subagent/subagent/src/index.ts:269`、`.../src/types.ts:31-43` |
| `receipt()` 只回 `{childId,result,dispose}` —— provider 返回值不透传 | `.../subagent/src/manager.ts:1221-1227` |
| external run 的 `childId = run.id`，要求全运行时唯一 | `.../subagent/src/manager.ts:869`、`.../src/types.ts:288` |
| cwd 由 manager 解析后以绝对路径注入 provider | `.../subagent/src/manager.ts:525`、`:497-501` |
| `Session.header.cwd` = 原始项目身份；当前目录另存（两处会分叉） | `docs/upgrade-guide/v0.2.1-alpha.1/working-directory/guide.md` |
| `working-directory` 服务为 0.2.1 新增：`get(session)` / `ensure(agent,signal)` / `set(...)` | `deepseek-harness/packages/session/working-directory/src/index.ts:122/134/163` |
| thincoder `v0.12.73..v0.12.75` 的 ACP 面零断点（三项变更均不落本插件调用面） | `git diff v0.12.73 v0.12.75 -- thincoder-cli/src/acp/`（2026-10-17 实测） |
| thincoder `0.12.76` 的 ACP 面零断点：安装版与源码树 `src/**` 逐文件一致；`src/acp/` 仅 `read-data.mjs` 有别，且属 `ledger/count` 出参与 watcher 错误日志，不在本插件调用面 | 2026-10-20 逐文件比对 |
| thincoder `0.12.76` 真进程握手实测：`initialize` 回 `protocolVersion: 1` + `sessionCapabilities{list,resume,delete,close}`；`session/new` 建会话回 `sessionId`；`session/list` 回 `{sessionId,cwd,updatedAt,title}`；`session/close` 释放；teardown 干净 | 2026-10-20 端到端探针（走本插件 `platform`/`connection` 真实代码路径） |
| 全局安装与源码树版本一致性判据 = `src/**` 逐文件 `diff` 为空（不是「同名版本号」） | 2026-10-20 实测（升级前 0.12.75 vs 源码 0.12.76 有 8 个文件差异） |

## 7. 变更记录

- 2026-10-05 首版：需求讨论定稿（交付落点=本仓；默认续用旧会话、显式可新开；九项适配建议全部采纳）。
- 2026-10-05 P6/AC-6 修订：原判据「无工程清单 ⇒ 可读错误」与代码事实不符（缺档会就地建档，不拒载）；
  改为拒载面 = 工程档不可解析（invalid / ambiguous / init-failed），并给出可复现构造。
- 2026-10-07 增补 P9（跨平台启动）与 P10（续用键路径归一），及 AC-10..AC-13、§6 的 Windows 实测事实；
  起因 = 在 Windows 上核对平台可用性时实测发现 P2/P3 的默认形态在 win32 上必失败
  （`command: 'thincoder'` 解析不到 npm shim，且 CreateProcessW 不执行批处理）。
- 2026-10-07 P9 补判据 + AC-13：win32 上配置 `args` 含解释器元字符（`%` `&` `|` `<` `>` `^`）须起进程前拒绝；
  用户裁定取「快速失败」口径（备选 B），检出集经实测收窄（`(` `)` 不含）。
- 2026-10-08 P9/P10 收口（B3）：P10 判据由「平台枚举」改回**目标文件系统的大小写语义**（macOS 默认 APFS 亦属
  大小写不敏感面），并补「符号链接别名与真实路径同键」「realpath 失败回退不抛错」两条；P9 补「解释器候选
  `ComSpec` 的读取与 dsh seam 同口径（win32 大小写不敏感）」。随之 AC-12 判定方式改写，新增 AC-14 / AC-15。
  起因 = mac 端实测：同一工作区三种形态落成 3 个键（P10 要治的缺陷在 mac 未被覆盖）。
- 2026-10-08 P10 措辞收窄（用户裁定）：判据句删去「不是平台枚举」的绝对表述，改为「判据 = 目标路径所在文件系统
  的大小写语义；win32 折仅作 realpath 给不出答案时的**补充**，且由冻结面钉死」—— 与设计档 §5.9 的实现口径一致
  （上抛 #15 取 A：保留 win32 折并把口径写正，不取「去掉折」或「改用文件系统探针」两条会改红冻结面的备选）。
- 2026-10-08 P9 补两条判据 + AC-16 / AC-17（B4 条目的验收面）：启动形态单一来源、解析结果必须可用；
  随 B4 批次（台账 #25 启动面收敛 / #24 目标解析面校验）落定。措辞按设计档 §8 的暂用口径收正（数字与机检命令同源）。
- 2026-10-09 AC-16 判定方式补边界（响应 B4 设计评审 round 1 的 🟡2）：入参形状明确为**行为叶三字段**；
  并要求断言两处传入**同一字段集合**（不只是 argv 相同 + 调用计数）。
- 2026-10-10 补 AC-18（B6 条目的验收面 · **条件性**）：Linux 宿主实证 —— 在可用的 Linux 宿主（容器或真机）上跑通
  四档既有单测与两条探针，读数逐格等于取证契约的期望读数表；触发条件与不满足时的处置写进判定方式
  （路线选择与降级口径见设计档 §5.10）。行为判据未新增：Linux 已在 P9「非 Windows 启动形态不变」与
  P10「文件系统大小写语义」语义内（真 Linux 实测见设计档 §5.10），本 AC 补的是**判定面**。
- 2026-10-16 增补 **P11（非阻塞委派 · 后台 job）**：委派默认改走 dsh 的后台 job 路径，主会话在 thincoder 执行期间不阻塞、
  且能被插入对话的消息响应；配 P4 加 `run_in_background` 参数与后台形态的返回面、P3 补「续用的层次」一句、
  §3 边界补「后台 job = one-shot 后台路径」一句、§5 补 `jobs` 依赖，并新增 **AC-19 / AC-20**。
  起因 = 用户实测：委派期间主会话既不能推进、也不能被插入对话响应（机制判据见 `docs/batches/B11-dsh-subagent-thincoder-nonblocking.md` §1 二）。
- 2026-10-17 增补 **P12（宿主版本面 · dsh 0.2.1-rc.2 单版本）** 与 **AC-21**；§5 依赖上修为 `0.2.1-rc.2`
  （thincoder 基线 `0.12.75` / core `0.10.8`）；P2 的 cwd 判据句按「cwd 权威上收」改口径（宿主解析，插件不自算）；
  §6 补 7 条 dsh / thincoder 事实。起因 = 两侧升版（dsh `0.2.0-rc.2` → `0.2.1-rc.2`，thincoder `0.12.73` → `0.12.75`）；
  四个断点与四处前提更正见 `docs/batches/B12-dsh-subagent-thincoder-dsh-021.md` §1 二 / 三。
- 2026-10-17 设计评审核正（轮次 1，changes-required，6 条全接受）：**AC-21 判定面重写**（新增 0 / 0.1 / 0.2 前置、a 拆成 a1–a3、新增 f 显式接回与 g 枚举+槽增长、e 改双组 `pwd` 对照）；
  P12 的失败分支口径收正为「**启动未完成**」而非「会话未建立」（宿主可能建立后回滚，可观测面无法区分）。
- 2026-10-20 **thincoder 兼容基线升版并显式钉定**：基线 `0.12.75` / core `0.10.8` → **`0.12.76` / core `0.10.9`**；
  §5 新增 **5.1「ThinCoder 兼容基线」**：钉定验证基线 + **依赖的 ACP 面清单（8 条）** + 不作为判据的面 + 两处软依赖锚句。
  口径：基线是**验证锚点**、不是运行期硬校验（插件不读 `thincoder --version`）；兼容性判据 = **面是否向后兼容**，版本号只是取证坐标。
  起因 = thincoder 升版至 `0.12.76`，需评估是否适配；结论 = **零代码适配**，依据为逐文件比对（安装版与源码树 `src/**` 完全一致）
  + 真进程端到端实测（见 §6 末行）。
