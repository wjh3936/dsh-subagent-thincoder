# 设计：dsh-subagent-thincoder（dsh 侧可续用 ThinCoder 子代理插件）

> 本档是本模块的设计档（架构 + 模块设计同处一档）。需求档见 `docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md`，实施记录见批次档 `docs/batches/B1-dsh-subagent-thincoder.md`。
> 本批落点 = 本仓（仓根）。零构建：源码为纯 ESM `.mjs`，dsh 直接加载。
> 「落点」列约定：新文件给 `文件#符号` 锚（行号在实现时按本表顺序落位）；既有外部文件给真实 `file:line`。
>
> **路径迁移说明（2026-10-20 · 只读提示）**：本档 §4 各批的动作表是**当时**的行数预算记录，其中测试文件路径写作
> `docs/batches/B<n>-…test.mjs`（批次期的实际落点）。自开源整理起，测试文件已迁至 **`test/`** 并按覆盖面重命名
> （B1→`core`、B2→`platform-win32`、B3→`platform-closeout`、B4→`launch-face`、B11→`background`、B12→`host-seam`）。
> 表中路径保持原样以保留历史真实性；**要读现行测试请以 `test/` 为准**（见 `docs/README.md` 的对照表）。

## 1. 问题陈述

dsh 想把手上的活委派给 ThinCoder CLI，走 ACP（Agent Client Protocol）：dsh 起一个 `thincoder acp` 子进程，用 ACP 会话与它对话。

现状断点（dsh 侧）：`@deepseek-ai/dsh-subagent-acp` 每次 run 的握手写死三步 `initialize` → `session/new` → `session/prompt`，run 结束就关进程；
既不保存远端会话号，也没有可用的续用调用面（`deepseek-harness/packages/subagent/subagent-acp/src/run.ts:483-507`；dispose 只关进程、不发 `session/close`，`:193-213`、`:604-617`）。

后果（用户实测）：同一个 dsh 会话里第二次委派 thincoder，等于开了一条全新的 thincoder 会话槽；上一条会话里评审通过后拿到的 designToken 存在**旧槽**里，新槽看不见，工程模式的多步流程接不上。

ThinCoder 侧已齐备：ACP 服务宣告 `loadSession: true` 与会话族能力（`thincoder/thincoder-cli/src/acp/client-caps.mjs:57-60`），并实现了 `session/{list,load,resume,delete}`（`handlers-slots.mjs`）。
designToken 的权威台账是**会话槽文件**，装载旧槽时会被读回内存（`thincoder-core/token-ttl.mjs:112-147`、`:233-296`），所以「接回同一条槽」就等于「token 回来了」。

本模块不改 dsh 核心、不改 `@deepseek-ai/dsh-subagent-acp`，以独立插件补足「接回旧槽」的能力并做 thincoder 场景适配。

**平台断点（B2）**：上述机制在 win32 上**默认配置必失败** —— `command` 默认 `thincoder` 在 Windows 上落成 npm shim
（`thincoder` / `.cmd` / `.ps1`，无 `.exe`；出处见需求档 §6），而 dsh 的 win32 启动路径只探 `.com` / `.exe`
（`deepseek-harness/packages/subprocess/subprocess-local/src/runner-launch.ts:231-240`），并把解析结果直交 `CreateProcessW`
（`.../win32-process/src/process.ts:562-570`）：裸名 ⇒ `ENOENT`；把 `.cmd` 直接交给 `CreateProcessW` ⇒ 批处理不可执行（Node 侧还会先抛 `EINVAL`）。
第二条断点更隐蔽：续用键 `parentSessionId + NUL + resolve(cwd)` 只做 `resolve()`，在**大小写不敏感**的文件系统上
同一工作区两种大小写形态会落成两条记录，P3 的默认续用**静默失效**。两条合为 B2 的修复面（P9 / P10）。

**B3 收口键归一这条**：B2 的折法只认 `platform === 'win32'`，而判据是**目标路径所在文件系统的大小写语义** ——
macOS 默认 APFS 卷同属「大小写不敏感」这一面，故该缺陷在 mac 端原样存在（实测：同一工作区三种形态落成 3 个键）；
B3 改为 realpath 规范化 + 失败回退（§5.9），并把 P9 侧解释器候选的 `ComSpec` 读取改为大小写不敏感（§5.9 规则 3）。

**B4 启动面收敛这条**：同一件事 —— 「把配置里的命令与参数解析成**最终 argv**」—— 在同一仓里有**两个实现点**：
委派面在 `src/provider.mjs:130-136` 调一次 `resolveLaunchArgv`，把结果 `argv` 交给 `startThincoderRun`；
枚举面在 `src/driver.mjs:450-455` **自己再算一遍**（`src/tools.mjs:246-251` 把 `{ ctx, ...behaviour, cwd }` 整体铺给 lister）。
两处各自构造同一份解析入参（`{ subprocess, command, args, env, platform: currentPlatform() }`）⇒ 同一件事有两个知识副本，
两条面交给 driver 的 spec 形状也随之不一致（委派面带 `argv`，枚举面带 `command` / `args`）；
`currentPlatform()` 随这份入参散在三处（`provider.mjs:135` · `driver.mjs:454` · `session-store.mjs:92` 默认参）。
B4 把「解析最终 argv」收敛成**一个函数 + 一个调用形状**（§5.9），并顺带收掉目标解析面缺的可用性校验（台账 #24）。

**B6 平台实证这条（Linux 收口）**：平台差异已收敛到 `src/platform.mjs`，而 Linux 走的是那里**既有的分支** ——
`resolveLaunchArgv` 的非 win32 早退（`src/platform.mjs:95`：`if (platform !== 'win32') return [command, ...argv]`）逐字原样、不解析、不包装，
故本批**没有缺失的实现要补**。B6 的未闭环点是**证据面**：此前所有 Linux 结论都来自「注入平台的单元测试 + 源码走查」，
**没有一次在真实 Linux 上跑过**（AC-10 只覆盖 Windows 真机，AC-11 是注入 POSIX 语义的单测）。本批把那一次跑出来，并把「怎么跑、期望读数是什么」钉死（§5.10）。

**B11 非阻塞委派这条（本批）**：委派现在**占住 dsh 的一个 step** —— 工具内 `await run.result` 一直等到子代理跑完
（`src/tools.mjs:179`，`:180` 才是 `settleRun`），而插入对话的消息只在**步边界**被取走
（`@deepseek-ai/dsh-agent-loop/lib/index.js:906` 的 `preStep` → `inbox.claim`；`claim` 体 `:103-105`）。
用户实测 = 委派期间主会话**既不能推进、也不能被插入对话响应**。本批把**默认路径**改成 dsh 的后台 job：
工具建立 job 后**立即返回 job 号**，子代理在 job 的 `done` 里跑完并结算 ⇒ 该 step 不再被 thincoder 的时长占用
（七条机制事实见本批次档 §1 二）。

**后台路径是 dsh 的 one-shot 后台，不是续用面**：`ctx.jobs.start` + 普通一次性 `ctx.subagents.start`；
官方同类先例 = `@deepseek-ai/dsh-tool-subagent/lib/index.js:534-553`。
边界明文见需求档 §3（**不触** `startContinuable` / `prepareContinuable` / `send_message`）。

**B12 宿主版本面这条（本批）**：dsh 升到 `0.2.1-rc.2` 后，subagent seam 换了一套启动面 —— 插件当前**导入即失败**：
`resolveChildCwd` / `validateConfiguredCwd`（`src/provider.mjs:29-30`）与 `settleRun`（`src/tools.mjs:23`）三个具名导出已被删除；
且 `run` 句柄的私有回带通道被宿主截断（`receipt()` 只回 `{childId,result,dispose}`）⇒ 会话号**静默丢失**（不报错、每轮开新槽、槽内状态全丢）。
四个断点与判据坐标见批次档 §1 二；本批把它们一次迁完，**只支持 `0.2.1-rc.2`**（需求档 P12 / AC-21）。

## 2. 方案与理由

**一句话机制**：本插件注册一个 ACP 子代理 provider 与两个模型面工具；
每次委派 = 起一个 `thincoder acp` 子进程，走 `initialize` → 会话建立（`session/new` 或 `session/resume`，默认续用）→ `session/prompt` → 取最终答复文本 → **先 `session/close` 再断开进程**；
会话号按「父 dsh 会话 + 工作区」落盘，进程重启后仍可续用。

理由（逐条对应需求 §2）：

- **续用是本模块存在的理由（P3）**：默认续用、显式可新开、显式可指定；续用走 `session/resume`（不重放历史），不走 `session/load`（会重放历史而不被消费）。
- **每次起进程（P2）**：不做长驻子进程；断开前先 `session/close` 释放槽认领，否则残留认领会让下一次接回被迫 fork 到新槽，续用形同虚设（P5/AC-5）。
- **只取最终答复（P2）**：`agent_message_chunk` 累积；思考 / 工具调用 / 计划不上抛。
- **不自造全局锁（P5）**：同工作区多路并发一律放行；槽冲突交给 thincoder 自己的「占用则 fork」语义。会话号回报：`session/new` 面取应答的会话号；`session/resume` 面应答无号，取请求里的会话号。
  并发下若发生静默 fork，回报/记录的是请求号，可能与实际槽不一致 —— 见 §12-3。
- **工程前置失败可读（P6）**：按用户裁定，拒载面 = 工程档**不可解析**（invalid / ambiguous / init-failed），**缺档不是拒载面**（thincoder 会在锚处就地建档后照常接回）；插件不得吞掉 thincoder 的稳定文案族 `/项目不可解析/`。
- **平台自适应（P9 / P10）**：`command` 的语义是「可执行名或路径」，win32 下由插件按该平台规则（PATH + PATHEXT）解析成**绝对路径**；
  解析结果为 `.cmd` / `.bat`（npm shim 形态）时经命令解释器启动，其余形态与非 win32 平台一律原样启动。
  平台差异**只存在于一个模块**（`src/platform.mjs`）：启动解析与包装、续用键的路径形态两条都在那里，其余模块平台中立（§5.9）。
  **键归一的判据是文件系统给的大小写语义**（B3）：路径先经 `realpath` 规范化 ⇒ 大小写不敏感卷上的两种形态与符号链接别名合一；
  平台参数只补 win32 的折，且该折只在 `realpath` 给不出答案的回退面起作用（§5.9）。
- **启动面单一来源（B4）**：解析最终 argv 这件事全仓**只有一个函数、一个调用形状**（`platform.mjs#resolveChildArgv`，§5.9）——
  委派面与枚举面都用它，谁也不能自己拼解析入参；平台读点由 `resolveLaunchArgv` 的**默认形参**承担（非 win32 逐字原样、win32 解析 + 按需包装）。
  交付形状仍受两条冻结约束（D-1 与 `argv` spec，§4.6）⇒ 收敛的是**解析的实现与入参形状**，不是「解析落在哪一层」。

**平台实证（B6）**：真 Linux 的取证走**容器**（§5.10）—— 本批的证据面不是产品代码（`src/**` 零改动），而是
「在 Linux 容器内跑四档既有单测 + 两条真 Linux 探针（POSIX 分支逐字、卷的大小写语义），读数与期望表逐格比对」（§8-AC-18）。
路线取舍与被否备选见 §7-K31；取证配方、期望读数表与降级口径见 §5.10。

**B11 后台委派（默认路径）**：委派的默认路径改走 dsh 的**后台 job** —— 工具**建立 job 后立即返回 job 号**，
子代理在 job 的 `done` 里跑完；主会话的 step 只花「建立 job」的时间，不再被 thincoder 的时长占用。

- **路径选择（P11）**：`ctx.jobs.start` + **普通一次性** `ctx.subagents.start` —— 即 dsh 的 one-shot 后台路径，
  **不触** `startContinuable` / `prepareContinuable` / `send_message`（需求档 §3 边界明文）。
  最近先例 = 官方 subagent 工具的 background 分支（`dsh-tool-subagent/lib/index.js:534-553`）：同 spec 形状（`{kind,label,owner,run}`）、同 `run()` 同步返回 `{cancel,done}`；
  偏离之一 = 它另有一条 continuable 分支而本插件没有（本插件的续用由 P3 的会话槽承担，ACP 跨进程进不了那条路）。
  完整坐标（实现坐标 / 本仓镜像章节 / **先例批次 = 无**（显式声明）/ 对齐与偏离）与自定 `kind` 的旁证见 §7 注②。
- **两种形态的回报面等价（P11）**：后台形态下**答复文本**与**本次 thincoder 会话号**仍须等价可达 ——
  会话号进 job 的环（执行期间即可读回），答复文本走 `JobOutcome.result`（结算后经 `job_output` 读回）。
- **默认后台、前台可达**：叶 `runInBackground`（默认 `true`）只给默认值，参数 `run_in_background` 逐次覆盖、**显式恒胜**；
  给 `false` 时逐字走既有前景链路（§2.1 的既有流程）⇒ 前景面零回归。
- **软取与降级（P11）**：`jobs` **不进**硬注入面（`inject` 保持四项）；**显式**要求后台而 `jobs` 不在位 ⇒ **可读工具错误**（不得静默阻塞调用方）；
  **默认路径**取不到 `jobs` ⇒ 退回前景（零回归）。
- **终止路径沿用既有 teardown（AC-19）**：job 取消 = abort 一个**自建**的 `AbortController`（**不沿用** `exec.signal` —— 它是**当前回合**的 step 信号，
  `dsh-agent-loop/lib/index.js:815-820` / `:1036-1040`：phase 跨回合会换新 controller），abort 驱动 §5.8 的既有阶梯（**先 `session/close` 再收进程**）⇒ 槽无残留认领。
- **不加新阈值**：并发沿用宿主既有 `maxConcurrentJobsPerOwner`；本插件不新增判据、不新增阈值叶。

**B12 宿主 seam 迁移（本批）**：`src/**` 的改动全部围绕四个断点，**不新增功能点**（P12 只换宿主契约）：

1. **启动面**：`ctx.subagents.start` → `ctx.subagents.startActivation({ provider, label, request, signal, delivery: 'caller' })`；
   `label` 从 request 移到 spec 顶层，`request` 不再带 `label` / `signal`；内层 `delivery: 'caller'` 保住 B1 的四键前景契约（R1）。
2. **会话号回带**：工具每条委派放一个**私有载体盒**（`request.thincoderCarrier = { sessionId: undefined }`），driver 在会话建立成功那一刻写入；
   宿主只保留 `{childId,result,dispose}`，但盒是工具闭包里的普通对象 ⇒ `dispose()` 之后仍可读（§5.2）。
3. **cwd**：provider 不再自算，直接用宿主注入的绝对 `request.cwd`；`config.cwd` 保留为**请求覆盖**（空 = 不传），枚举面软取 `workingDirectory`（§5.9-B12）。
4. **结算**：自实现 `settleActivation`（映射表见 §5.3-B12）；工具侧显式 `dispose()`；取消经 `activation.dispose()` 生效（前景接步信号、后台接 job controller）。

### 2.1 数据流

```
模型 → 工具 subagent_thincoder(args)
  → 校验参数（description/prompt 必填；sessionId 与 new 互斥）
  → 读 config.cwd：非空 ⇒ assertUsableCwd 后作 request.cwd；'' ⇒ 不传（宿主取父会话当前目录）
  → ctx.subagents.startActivation({ provider, label, request, signal, delivery: 'caller' })
      → 宿主解析 cwd（绝对路径）、建 activation（childId = run.id）后注入 provider.start(request)
          → provider 只用 request.cwd，不再自算
          → 解析会话选择（显式 sessionId / 显式 new / 默认按 §5.9 归一的键查记录）
          → resolveChildArgv(ctx.subprocess, behaviour) → 最终 argv（启动面单一来源）
          → startThincoderRun(request, spec)
              → ctx.subprocess.spawn(argv, cwd)
              → initialize → session/new | session/resume
              → 写入载体盒 request.thincoderCarrier.sessionId + 记录会话号（store.remember，仅成功建立后）
              → 返回 run 句柄（id = randomUUID；宿主只留 { childId, result, dispose }）
  → 工具读载体盒 ⇒ sessionId（dispose 之后仍可读；盒空 ⇒ 可读错误，不得返回空串）
  → 工具 await activation.result → 自实现 settle 映射 → 显式 activation.dispose()
      → teardown：session/close（best-effort）→ stdin EOF →（必要时）terminate → waitForExit
  → 工具返回：最终答复文本 + 一行本次会话号
```

枚举面走**同一个解析函数、同一个入参形状**（唯一区别是它的 spec 由工具铺下来，见 §5.9 单一来源段）：

```
工具 subagent_thincoder_sessions → lister(request, spec)   // spec = { ctx, ...behaviour, cwd }
  → [默认 lister] listWorkspaceSessions(request, spec)
      → resolveChildArgv(spec.ctx.subprocess, spec) → 最终 argv（与委派面同一来源）
```

后台分支的**完整链路**（前景分支 = 上面那张图的既有链路，逐字不变）：

```
模型 → 工具 subagent_thincoder(args)            // run_in_background 缺省 ⇒ 读叶 runInBackground（默认 true）
  → 校验参数（与前景同：description / prompt 非空；sessionId 与 new 互斥）
  → 两级解析 ⇒ 后台：jobs = ctx.get?.('jobs')   // 惰性；取不到时：显式 true ⇒ 可读错误 / 默认路径 ⇒ 退前景
   → jobId = jobs.start({ kind:'thincoder', label, owner: parent.id, run })   // 不设 outputLimitBytes（§7-K43）
      → run(job) 同步返回 { cancel, done }      // 工具到此立即返回，不 await 终态
      → done（在后台继续）：startActivation({ …, signal: controller.signal, delivery: 'caller' })
          → 宿主解析 cwd、建 activation；provider.start → startThincoderRun（会话号写入载体盒）
        → job.append('[thincoder session] <id>')  // 盒有效才写（空盒不写环）；执行期间即可读回
        → await activation.result → settle 映射 → 显式 dispose（内含 session/close → 收进程）
  → 工具返回 { kind:'background', jobId }       // 主会话的 step 到此结束，不被 thincoder 的时长占用
  → 终态：job 结算 ⇒ 完成通知按 completionDelivery（默认 wakeup）投递：owner 空闲 ⇒ followup 开新回合；忙 ⇒ inject
   → 读回：模型调 job_output ⇒ JobRead.result = 答复文本（本插件不设读回上限 ⇒ 与前景形态同源）
  → 终止：job_kill / owner 释放 / 服务卸载 ⇒ controller.abort + activation.dispose()（发布后）⇒ 既有 §5.8 阶梯
```

## 3. 包与插件身份（P1）

| 项 | 定值 |
|---|---|
| 包名 | `dsh-subagent-thincoder` |
| 包形态 | `type: module`；`main: src/index.mjs`；零构建，无 tsc / 无打包 |
| `exports` | `"."` → `./src/index.mjs`；`"./package.json"` → `./package.json` |
| bundle 指向 | `dsh.bundle.patch` → `./cordis.patch.yml` |
| 插件 id（装载行 `id`） | `dsh-subagent-thincoder` |
| 插件 `name` 导出 | `dsh-subagent-thincoder`（loader 诊断名） |
| `inject` | `['tools','subagents','subprocess','storageDomain']`（硬注入：缺任一项启动即失败，不静默降级） |
| 身份导出落点 | `src/index.mjs` 导出 `name` / `inject` / `apply` / `Config`；`Config` 由 `src/config.mjs` 定义并再导出 |
| peerDependencies | 见下方清单 |

peerDependencies：`@agentclientprotocol/sdk ^1.4.0` · `@deepseek-ai/cordis ^4.0.2` · `@deepseek-ai/dsh-subagent >=0.2.1-rc.2`
· `@deepseek-ai/dsh-subprocess >=0.2.1-rc.2` · `@deepseek-ai/dsh-tools >=0.2.1-rc.2` · `@deepseek-ai/dsh-storage-domain >=0.2.1-rc.2`
· `@deepseek-ai/schemastery ^3.18.2` · `zod ^4.0.0`

### 3.1 配置面（`src/config.mjs`）

schemastery `Config`。**身份叶非 volatile、行为叶 volatile**：

| 叶 | 类型 / 默认 | volatile | 读取时机 |
|---|---|---|---|
| `providerName` | string，`thincoder` | 否 | 装载时（注册 provider，工具派发按名字） |
| `toolName` | string，`subagent_thincoder` | 否 | 装载时（工具注册名） |
| `sessionToolName` | string，`subagent_thincoder_sessions` | 否 | 装载时（枚举工具注册名） |
| `command` | string，`thincoder`；语义 = **可执行名或路径**（win32 下按 PATH + PATHEXT 解析，`.cmd`/`.bat` 经解释器启动，见 §5.9） | 是 | 每次委派 |
| `args` | string[]，`['acp']` | 是 | 每次委派 |
| `cwd` | string，`''`。非空 = **请求覆盖**（按 `assertUsableCwd` 校验后作 `request.cwd`）；`''` = **不传** `request.cwd`，宿主取父会话**当前**目录 | 是 | 每次委派（经 `readLiveLeaf`） |
| `permission` | `'allow' \| 'reject'`，`reject` | 是 | 每次委派 |
| `env` | dict(string)，`{}` | 是 | 每次委派 |
| `disposeEofGraceMs` | number，`6000` | 是 | 每次委派 |
| `disposeGraceMs` | number，`3000` | 是 | 每次委派 |
| `runInBackground` | boolean，`true` | 是 | 每次委派（经 `readLiveLeaf`）；**只决定默认值**，参数 `run_in_background` 逐次覆盖 |

理由：身份叶决定注册面（provider 名、工具名），**运行期改名必须触发重挂载**才能重注册目录，故不标 volatile；行为叶在每次委派/teardown 读取，标 volatile 使设置写入就地生效、不打乱已注册目录。

本批（B2）**不新增配置叶**：平台自适应必须自动发生（P9 要求「默认配置即可完成一次委派」）。
若加 `shell` / `interpreter` 之类的叶，等于把自适应退回成手工配置，与 P9 相悖（§7-K24）。

B4 同样不新增配置叶：启动面收敛只改解析的**调用形状**与平台读取的默认位置，上表逐行不变（§4.5）。

B11 **新增一行行为叶** `runInBackground`（默认 `true`）：它是**行为叶** —— 每次委派经 `readLiveLeaf` 读取，**装载期不读**。
这一条不只是体例：它就是 §4.10 第 5 条（「默认后台」的叶在冻结用例里读作 `undefined` ⇒ 走前景）成立的前提 ——
装载期解析会把「叶缺省」变成「装载即定值」，而冻结用例的 `config: {}` 必须读作缺省。
该叶**不是能力门**：它只决定默认值，显式参数恒胜（§5.11 门表、§7-K39 / K46）。

**B12 改的是 `cwd` 叶的语义落点，不改叶本身（显式裁定）**：0.2.1 把 cwd 解析上收到宿主（`workingDirectory`），provider 拿到的 `request.cwd`
已是**绝对路径** ⇒ 插件不再自算。叶的用法 = 「非空 ⇒ 作为 `request.cwd` 传入」（起进程前 `assertUsableCwd` 校验：必须**绝对**且可进入），
「`''` ⇒ **不传** `request.cwd`」——宿主取父会话**当前**目录。
**与旧 `header.cwd` 不等价（钉死口径）**：旧叶空值走的是 `parent.session.header.cwd`（**原始项目身份**，用户切过目录后已过期）；
新口径走的是**当前目录**（`working-directory` 投影）——这是迁移的**实质收益**，不是等价改写。
**备选（直接退役该叶）不取**：需求档 P2 明写「可配置覆盖」，且部署 profile 已带 `cwd: ''`（§3.2）；退役会削需求并让现有配置变成未知叶。

### 3.2 装载形态

本插件自带的 `cordis.patch.yml` 声明一行（`- insert:` → `id: dsh-subagent-thincoder` / `name: dsh-subagent-thincoder` / `config:` 为上面的默认形态）。

落地后须**替换**用户 profile 里现有的两行（`subagent-acp` 与 `tool-subagent-acp`，见 `~/.dsh/profiles/web/cordis.patch.yml:108-123`）为一行本插件行。替换后的 profile 片段（作为交付物给出，本批不修改该文件）：

```yaml
- insert:
    - id: dsh-subagent-thincoder
      name: dsh-subagent-thincoder
      config:
        providerName: thincoder
        toolName: subagent_thincoder
        sessionToolName: subagent_thincoder_sessions
        command: thincoder
        args:
          - acp
        cwd: ''
        permission: allow        # 子代理要写文件；reject 会拒掉每一次写入
        env: {}
        disposeEofGraceMs: 6000
        disposeGraceMs: 3000
```

这一份默认形态在 win32 与 POSIX 上**同一份配置**即可用（P9）：Windows 上 `command: thincoder` 解析到 npm shim `.cmd`，由插件经命令解释器启动（§5.9）。

## 4. 受影响文件清单

工程清单 `checkConfig.lineCounts` 为空 ⇒ 无声明行数上限，故无需拆分计划，按职责分档即可。
「现况行数」= 本批开工时该文件的行数（`docs/batches/B1-dsh-subagent-thincoder.md` 收口后）；profile 文件（`~/.dsh/profiles/**`）不在本仓写域内。

### 4.1 交付面总览（现况 + 本批动作）

| # | 文件 | 职责（一句话） | 现况行数 | B2 动作 |
|---|---|---|---|---|
| 1 | `package.json` | 包身份、bundle 指向、peerDependencies | 31 | 不变（无新依赖：用的是已声明的 `subprocess` 服务面） |
| 2 | `cordis.patch.yml` | 装载行与默认配置 | 46 | 不变 |
| 3 | `src/config.mjs` | `Config`（schemastery）+ `readLiveLeaf` + 装载期身份叶解析 | 104 | 不变（`command` 的语义变化只改注释口径，不改 schema） |
| 4 | `src/session-store.mjs` | 存储面：domain/表/键/读写（父会话+工作区 → 会话号） | 148 | **修改**：`linkKey` 加平台参数、键路径走 `platform.mjs`（P10）· **+10（≤+10 行）** |
| 5 | `src/errors.mjs` | 固定安全诊断文本 + 可读工具错误构造（含 `/项目不可解析/` 透传） | 131 | **修改**：加 `launchError`（解析失败的可读工具错误）· **+21（≤+21 行）** |
| 6 | `src/stop-reason.mjs` | ACP `StopReason` → harness `SubagentStopReason` 映射（自持） | 44 | 不变 |
| 7 | `src/connection.mjs` | 子进程 spawn + ACP 连接 + 权限应答 + 断开阶梯（EOF→terminate） | 237 | **修改**：`spawnChild` 改收 `spec.argv`，不再自拼 `[command, ...args]` · **结构不变（±0 行）** |
| 8 | `src/driver.mjs` | 一次委派的线驱动：握手、会话建立、prompt、结果折叠、会话号回报；含会话枚举 | 500 | **修改**：两处 `spawnChild` 改传 `argv` · 枚举面起进程前解析 argv（§6.1-L9 落点）· 起始回滚释放竞争修复（拉回 §5.8「先释放后回收」语义）· **+4（≤+4 行）** |
| 9 | `src/provider.mjs` | `SubagentProvider` 实现（capabilities / inheritsParentContext / start） | 139 | **修改**：`start` 起进程前先解析 argv（解析失败 ⇒ 可读错误、零进程）· **+21（≤+21 行）** |
| 10 | `src/tools.mjs` | 两个模型面工具：`subagent_thincoder`、`subagent_thincoder_sessions` | 255 | 不变（枚举面的解析按 §6.1-L9 落在 `driver.mjs` 的默认 lister 内；本文件逐字未动） |
| 11 | `src/index.mjs` | 插件身份与注册（provider + 两工具 + 存储生命周期） | 61 | 不变 |
| 12 | `src/platform.mjs` | **新增**：全仓唯一读平台/按平台分支的模块（启动解析与包装、续用键路径形态） | — | **新增（≤95 行）** |
| 13 | `docs/batches/B1-dsh-subagent-thincoder.test.mjs` | B1 单元测试文件（随批次档存放，`node --test` 直跑） | 696 | **修改**：`linkKey` 用例注入平台（理由见 §4.2）· **+3（≤+3 行）** |
| 14 | `docs/batches/B2-dsh-subagent-thincoder-win32.test.mjs` | **本批**单元测试文件（随本批次档存放，`node --test` 直跑） | — | **新增（≤140 行）** |
| 15 | `docs/USER-SKILL-delegate-to-thincoder.md` | 随仓发布 skill 的**契约依赖清单**（设计族档，非代码） | 58 | **修改**：§3 表第 4 行（键形态）加 P10 口径、§5 补一行变更记录 · **+3（≤+3 行）** |

「B2 动作」列的增量口径：`+N（≤+N 行）` = 该文件本批最多新增 N 行（上限，非目标值）；`结构不变（±0 行）` = 只就地改写既有行、行数不增；新增文件给 `≤N 行` 的总量上限。每行都给实现者可核验的行数预算，行数上限依据见 §4 首段。

### 4.2 为什么 B1 的单元测试文件也要改（本批唯一的跨批改动）

`docs/batches/B1-dsh-subagent-thincoder.test.mjs:216` 现断言 `linkKey('dsh-1', '/tmp/ws')` 逐字等于 `` `dsh-1\u0000${resolve('/tmp/ws')}` ``。
P10 落地后，win32 上该键会折叠大小写（`C:\tmp\ws` → `c:\tmp\ws`），**在本机（Windows）跑这一行会红** ——
而该文件是后续批次复跑的回归面，必须保持全绿。改法：把这条用例的平台显式注入（`linkKey('dsh-1', '/tmp/ws', 'linux')`），
POSIX 语义逐字保留；两种大小写形态的新用例落在 B2 自己的测试文件里，**不塞进 B1 文件**（一个批一个测试文件）。

`docs/USER-SKILL-delegate-to-thincoder.md` 同理：它第 4 行复述了键的构造式，P10 后该复述不再完整（win32 还折叠大小写），
补一句指向 §5.6 即可（该档只登记依赖关系，正文真源仍是本设计档）。

### 4.3 本批（B3）受影响文件与行数预算

| # | 文件 | 职责 / 本批动作 | 现况行数 | B3 动作 |
|---|---|---|---|---|
| 1 | `src/platform.mjs` | 全仓唯一平台/主机语义模块：加 `canonicalPath`（realpath 规范化 + 回退）与 `environmentValue`（win32 大小写不敏感读），`resolveInterpreter` 收 `platform` | 94 | **修改**：**+24（≤+24 行）** |
| 2 | `src/session-store.mjs` | 续用键构造：`linkKey` 加第四参 `canonicalize`（默认 `canonicalPath`），键 = `keyPath(canonicalize(resolve(cwd)), platform)` | 155 | **修改**：**+5（≤+5 行）** |
| 3 | `docs/batches/B3-dsh-subagent-thincoder-platform-closeout.test.mjs` | **本批**单元测试文件（随本批次档存放，`node --test` 直跑） | 0 | **新增**：**+≤160 行**（0 → ≤160 行） |
| 4 | `docs/USER-SKILL-delegate-to-thincoder.md` | 随仓发布 skill 的**契约依赖清单**（设计族档）：§3 表第 4 行键形态改写 + §5 变更记录一行 | 59 | **修改**：**+2（≤+2 行）** |
| 5 | `docs/batches/B1-*` · `docs/batches/B2-*`（含两档 `.test.mjs`） | 冻结面（跨批回归面） | — | **不改**：结构不变（±0 行） |

增量口径同 §4.1（`+N（≤+N 行）` = 上限，非目标值）；新增文件的基线记 `0`、动作栏记 `+≤N 行`（= 该新文件从 0 到 ≤N 的总量上限）；行数上限依据见 §4 首段（本项目未声明行数上限）。

### 4.4 与冻结面共存（B3 的硬前提）

realpath 归一改变了 `linkKey` 对**已存在路径**的取值，而两档冻结测试文件里有四条断言直接依赖键的取值：

| 冻结断言 | 期望 | B3 后为何仍成立 |
|---|---|---|
| `B1-dsh-subagent-thincoder.test.mjs:218` | `linkKey('dsh-1','/tmp/ws','linux')` 逐字等于 `dsh-1\u0000resolve('/tmp/ws')` | `/tmp/ws` **不存在** ⇒ realpath 抛 ENOENT ⇒ 回退字符串归一 ⇒ 取值逐字不变 |
| `B2-...-win32.test.mjs:109` / `:110` | win32 注入 ⇒ 同键；POSIX 注入 ⇒ 两键 | `<仓根>/WS` 与 `<仓根>/ws` **都不存在** ⇒ 回退 ⇒ win32 折 / POSIX 逐字两向皆不变 |
| `B2-...-win32.test.mjs:121` | 默认平台下 `key === 'p\u0000' + resolve('Mixed','Case')` | `Mixed/Case` 不存在 ⇒ 回退；本机默认平台非 win32 ⇒ 不折 |
| `B2-...-win32.test.mjs:111` | `keyPath('C:\WS','win32') + keyPath('C:\WS','linux') === 'c:\wsC:\WS'` | `keyPath` **逐字未改**（纯字符串折；realpath 落在新函数 `canonicalPath`，不进 `keyPath`） |

实机核对（2026-10-08，darwin）：`ls -d /tmp/ws` ⇒ 不存在；`/tmp` 是 `→ private/tmp` 的符号链接；仓根只有 `docs/` `src/` `node_modules/` 等条目、无 `WS` / `ws`；`realpath(仓根) === 仓根`（仓根路径本身无符号链接）。
⇒ 上表四条在本机成立；Windows 机上三条入参同样不存在（`/tmp` 落 `C:\tmp` 类）。
**该前提若被打破（某台机器上 `/tmp/ws` 或仓根 `WS` 真实存在）⇒ 冻结用例会变色 ⇒ 上抛用户裁定（§12.1-13），不得改冻结档、不得缩需求。**

### 4.5 B4 受影响文件与行数预算（启动面收敛 + 台账 #24）

| # | 文件 | 职责 / 本批动作 | 现况行数 | B4 动作 |
|---|---|---|---|---|
| 1 | `src/platform.mjs` | 全仓唯一平台模块：加**启动面单一来源** `resolveChildArgv`（行为叶 in → 最终 argv out）；`resolveLaunchArgv` 加 `platform = currentPlatform()` 默认形参；目标解析结果加可用性守卫（台账 #24） | 117 | **修改**：**+12（≤+14 行）** |
| 2 | `src/provider.mjs` | 委派面：`start` 的 argv 解析块（7 行）改一行 `resolveChildArgv` 调用；平台导入随之改掉 | 156 | **修改**：**净减（增长上限 +0 行）** |
| 3 | `src/driver.mjs` | 枚举面：`listWorkspaceSessions` 的解析块（4 行）改一行 `resolveChildArgv` 调用；平台导入随之改掉 | 504 | **修改**：**净减（增长上限 +0 行）** |
| 4 | `docs/batches/B4-dsh-subagent-thincoder-launch-face.test.mjs` | **本批**单元测试文件（随本批次档存放，`node --test` 直跑） | 0 | **新增**：**+≤130 行** |
| 5 | `docs/design/DESIGN-dsh-subagent-thincoder.md` | 本设计档（本批增补 §1 / §2 / §2.1 / §3.1 / §4.5–§4.7 / §5.9 / §6.3 / §7 / §8 / §9.4 / §10 / §11 / §12.2 / §13） | 775 | **修改**：**+175（≤+180 行）** |
| 6 | `src/session-store.mjs` | 续用键构造（键面，与启动面无关） | 160 | **不改**：结构不变（±0 行）—— 平台默认参保留，理由见 §4.7-② |
| 7 | `src/tools.mjs` | 两个模型面工具；枚举面的 spec 由本文件铺给 lister | 255 | **不改**：逐字未动（D-1，§4.6） |
| 8 | `src/connection.mjs` · `src/errors.mjs` · `src/config.mjs` · `src/index.mjs` · `src/stop-reason.mjs` | 连接 / 错误文本 / 配置 / 装配 / stopReason 映射 | 237 · 150 · 104 · 61 · 44 | **不改**：结构不变（±0 行） |
| 9 | `docs/batches/B1-*` · `B2-*` · `B3-*`（含三档 `.test.mjs`） | 冻结面（跨批回归面） | — | **不改**：结构不变（±0 行） |

增量口径同 §4.1 / §4.3：`+N（≤+N 行）` = 上限、非目标值；「净减（增长上限 +0 行）」= 本批只减不增；
新增文件基线记 `0`、动作栏记 `+≤N 行`。行数上限依据见 §4 首段（本项目未声明行数上限）。

**预算顶格面不动**：`src/session-store.mjs`（现 160 行）与 B3 测试文件（现 159 行）本批**一行不碰**（第 6 / 第 9 行）⇒ 无需向设计评审申请新预算。

### 4.6 B4 的两条冻结约束（D-1 与 `argv` spec）

**D-1（正面处理）**：`docs/batches/B2-dsh-subagent-thincoder-win32.md:58-69` 的裁定仍然有效 ——
枚举面的解析**不得**落在 `src/tools.mjs#createSessionsTool.execute`：该工具的 lister 是**可注入依赖**（`src/tools.mjs:199`），
而 B1 的两条 sessions 用例以 `ctx: {}` + 桩 lister 构造（`docs/batches/B1-dsh-subagent-thincoder.test.mjs:422-447`）——
在 `execute` 里解析必然触到 `ctx.subprocess`（`undefined`）⇒ 在 win32 宿主上必红。
本批**不推翻**该裁定：枚举面的解析仍在**默认 lister 内部**（`driver.mjs#listWorkspaceSessions`），`tools.mjs` 逐字未动。

**第二条钉死（B4 新发现 · 任务书未记）**：`startThincoderRun` 的 spec 里 `argv` 是**冻结测试的入参** ——
`docs/batches/B2-dsh-subagent-thincoder-win32.test.mjs:116` 与 `docs/batches/B3-dsh-subagent-thincoder-platform-closeout.test.mjs:110`
都以 `{ ctx: { subprocess: { spawn: () => child } }, argv: ['thincoder', 'acp'], ... }` 直调它，而那两个桩 `ctx` **没有** `resolveExecutable`。
⇒ 任何「把解析下移进 `startThincoderRun` / spec 改带 `command` / `args`」的方案，都会在 **win32 宿主**上让这两档测试变红
（解析面缺 `resolveExecutable` ⇒ `launchError` ⇒ 该 `await` 抛出，而这两例没有 `assert.rejects`）；POSIX 宿主上不红。
⇒ 结论（与 D-1 一起钉死 B4 的形状）：**解析留在两条面各自「起进程之前」的调用点，但两条面调用同一个函数、同一个入参形状**；
`driver` 收的 spec 形状按面不同**不是**两个实现点，而是**冻结面钉死的交接形状**（上抛 §12.2-20）。

### 4.7 B4 四问回答（逐条 · 结论；细节落在指针处）

1. **单一来源的落点与形状**：落点 = `src/platform.mjs#resolveChildArgv(subprocess, spec)`（§5.9 导出表）；
   形状 = 「行为叶（`command` / `args` / `env`）in → 最终 argv out」，两条面各一行调用（`provider.mjs#start` · `driver.mjs#listWorkspaceSessions`）；
   `resolveLaunchArgv` 仍是唯一的规则实现，而这次收敛后它**只有一个调用点**（即该函数）。
   **不能收到「一个调用点」**：D-1 禁 `tools.mjs` 内解析，而把委派面的解析下移进 `startThincoderRun` 会在 win32 宿主改红冻结的 `B2:116` / `B3:110`（§4.6）
   ⇒ 本批收的是**实现与入参形状**，不是**调用层**。
2. **`currentPlatform()` 的传染面**：**不能收敛到一处，收敛到两处**（3 → 2）—— 启动面两处归零（平台默认值落在 `resolveLaunchArgv` 的形参上，
   两条面不再 import `currentPlatform`），键面一处保留（`session-store.mjs:92` 的 `linkKey` 默认参）。键面为何不收敛见上抛 §12.2-21；
   **`process.platform` 的唯一读点**仍只有 `platform.mjs:26` 一处（本批不动，机检 `grep -rn "process.platform" src/` = 1 命中）。
3. **#24 收不收**：**收**（win32 分支的目标解析结果加非空 / 字符串守卫，2 行 + 1 例）；取舍、被否备选与「该路径经当前 seam 契约不可达」的如实登记见 §7-K30 与上抛 §12.2-18。
4. **行数预算**：逐文件见 §4.5 —— `src/platform.mjs` **+12（≤+14 行）**、`src/provider.mjs` 与 `src/driver.mjs` **净减（增长上限 +0 行）**、
   新增 B4 测试文件 **+≤130 行**、本设计档 **+175（≤+180 行）**；`src/session-store.mjs`（160）与 B3 测试文件（159）本批不碰 ⇒ 不申请新预算。

### 4.8 B6 受影响文件与行数预算（Linux 收口）

| # | 文件 | 职责 / 本批动作 | 现况行数 | B6 动作 |
|---|---|---|---|---|
| 1 | `src/**`（九个模块；平台分支集中在 `src/platform.mjs`，见 §5.9） | 产品代码 | `platform.mjs` **131** · 其余见 §4.5 | **不改**：结构不变（**±0 行**）—— Linux 走 `platform.mjs:95` 的既有早退，**本批不出产品实现** |
| 2 | `docs/design/DESIGN-dsh-subagent-thincoder.md` | 本设计档（本批增补 §1 / §2 / §4.8 / §5.10 / §6.2 / §6.4 / §7 / §8 / §9.5 / §10 / §11 / §12.3 / §13） | 955 | **修改**：**+176（≤+180 行）** —— 结算期实测 **1131**；原记 `+169` 系**设计期读数**（差额来自评审三条建议的就地修） |
| 3 | `docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md` | 需求档：新增 **AC-18**（Linux 宿主实证） | 229 | **需求档 2026-10-10 已落 AC-18**（本档 §8 同步；行为判据未新增） |
| 4 | `docs/batches/B1-*` · `B2-*` · `B3-*` · `B4-*` · `B5-*`（含四档 `.test.mjs`） | 冻结面（跨批回归面） | 四档 `.test.mjs` **698 / 140 / 159 / 129** | **不改**：结构不变（±0 行）—— 本批只**跑**它们，一行不改 |
| 5 | `PROJECT-MANIFEST.json` | 机器可读声明 | 41 | **不改**：结构不变（±0 行） |
| 6 | `docs/batches/B6-dsh-subagent-thincoder-linux.md` | 本批次档（记录面；§2 由本设计书写入） | 56 | **记录面**：随本批书写（`docs/batches/**` 不受行宽判据，§6.1） |

增量口径同 §4.1 / §4.3 / §4.5（`+N（≤+N 行）` = 上限、非目标值）；行数上限依据见 §4 首段（本项目未声明行数上限，亦不引通用 300 / 500 行阈值）。
**本批不新增任何文件**：不新增测试文件 / 脚本 / CI 配置（判据见 §7-K33）—— 故上表没有「新增」行。

### 4.9 B11 受影响文件与行数预算（非阻塞委派）

| # | 文件 | 职责 / 本批动作 | 现况行数 | B11 动作 |
|---|---|---|---|---|
| 1 | `src/config.mjs` | 配置面：加行为叶 `runInBackground`（默认 `true`、`.volatile()`） | 104 | **修改**：**+1（≤+2 行）** |
| 2 | `src/tools.mjs` | 工具面：参数 + `oneOf` 输出 schema + `render` 分流 + 执行体（两级解析、后台分支、job 组装） | 255 | **修改**：**+80（≤+90 行）** |
| 3 | `src/errors.mjs` | 错误文本构造面（§5.3 的单一构造点）：加 `backgroundUnavailable()` / `jobFailureDetail(error)` | 150 | **修改**：**+12（≤+16 行）** |
| 4 | `src/index.mjs` | 插件身份与注册（`inject` 四项不变） | 61 | **不改**：逐字未动（±0 行） |
| 5 | `src/driver.mjs` | 一次委派的线驱动（信号取自请求 `:244`；后台分支复用同一条路径） | 501 | **不改**：逐字未动（±0 行） |
| 6 | `docs/batches/B11-dsh-subagent-thincoder-nonblocking.test.mjs` | **本批**单元测试文件（随本批次档存放，`node --test` 直跑） | 0 | **新增**：**+≤200 行** |
| 7 | `docs/design/DESIGN-dsh-subagent-thincoder.md` | 本设计档（本批增补 §1 / §2 / §2.1 / §3.1 / §4.9–§4.10 / §5.11 / §6.5 / §7 / §8 / §9.6 / §10 / §11 / §12.4 / §13） | 1135 | **修改**：**+≤400 行**（新预算 · 见下） |
| 8 | `docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md` | 需求档：P11 + P4 参数行 / 返回段 + §3 边界 + §5 依赖 + AC-19 / AC-20 | 264 | **不改**：主 agent 已落（§8 同步；本批未新增行为判据） |
| 9 | `docs/USER-SKILL-delegate-to-thincoder.md` | 随仓发布 skill 的**契约依赖清单**（设计族档）：§3 第 2 行参数面（补 `run_in_background`）+ §3 新增第 11 行（后台委派形态与答复读回）+ §3.1（skill 侧待落的目标句）+ §5 一行 | 60 | **修改**：**+7（≤+8 行）**（已落 · 依 §5.11 的裁定落位） |
| 10 | `docs/README.md` | 文档地图（**主 agent 的笔**） | 45 | **主 agent 已改**（设计相）：需求档描述行的计数 `P1–P10 → P1–P11` · `AC-1..AC-18 → AC-1..AC-20`、批次表新增 B11 行；**实施批不再动** |
| 11 | `PROJECT-MANIFEST.json` | 机器可读声明 | 41 | **不改**：结构不变（±0 行） |
| 12 | `docs/batches/B1-*` … `B11-*`（含四档 `.test.mjs`） | 冻结面（跨批回归面） | 四档 `.test.mjs` **698 / 140 / 159 / 129**（B6 档 §4.8 读数） | **B12 的例外**：B1 / B11 两份 `.test.mjs` 按 §4.12 改（B2/B3/B4 仍零改动） |

增量口径同 §4.1 / §4.3 / §4.5 / §4.8（`+N（≤+N 行）` = 上限、非目标值；新增文件基线记 `0`、动作栏记 `+≤N 行`）。
**第 4 / 第 5 行「不改」是设计要求，不是暂缓**：`src/index.mjs` 的四项注入与 `src/driver.mjs` 的驱动路径都不许动（§4.10、§6.5 面 10 机检）。

**新行数预算申报（本批）**：设计档 **+≤400 行**（现 1135 行 ⇒ 上限 1535 行）。依据五条：

1. **本项目未声明行数上限**：`PROJECT-MANIFEST.json:12-27` 的 `checkConfig.lineCounts = []`（该键的元素形态是 `{doc, section}`，属**文档章节**声明，不是文件上限 —— 口径同 `docs/STANDARDS.md` §6.2）。
2. **旧额度已用尽**：B6 的 `955 + ≤180` 在结算期实测 1131，B7 修正批又 +4 ⇒ 现 1135 = 该额度**用尽**，本批必须另开新的增量上限，不能沿用。
3. **本批内容面更大**：新增 6 节（§4.9 / §4.10 / §5.11 / §6.5 / §9.6 / §12.4）+ 14 条 K 号 + 2 条 AC 面行 + 1 张新动作表 + 1 张新用例表；
   B4 / B6 各增 5 节左右、实测约 176 行。逐节估算合计约 271 行，留约 29 行评审修正余量 ⇒ 初步申报 **≤+300 行**。
4. **落地实测（本相完工后读数 · 可机检）**：`git diff --numstat` 实测 **+330 行**（1135 → 1465）⇒ 逐节估算偏低约 59 行
   （K 表 14 行与 §12.4 六条为把理由写全而多行展开）。上限**据实上浮至 350**（= 330 + 约 20 行评审修正余量），
   与 B6 的「设计期读数 vs 结算实测」同类差额先例一致（§13）；**不删内容去凑估算**。
5. **裁定落位轮增量（2026-10-16 · fix · 可机检）**：C-1 / C-2 裁定落位 + §5.11 目标文案 + 措辞面 `open` + 预算同步 共 **+41 行**（`1465 → 1506`；`git diff --numstat` 本轮读数）
   ⇒ 旧上限 350（= 1485 行）被这轮内容顶破 ⇒ **据实上浮至 400**（= 净增 371 + 约 29 行评审修正余量，上限 1535 行）。同依据④的理由：内容由裁定与本轮任务书给定，**不删内容去凑估算**。

### 4.10 与冻结面共存（B11 的硬前提）

后台化改的是**工具的返回面与执行体**，而 B1 的单元测试文件（冻结面）**直调**这两处。五条约束逐条设计过：

| # | 冻结断言（`docs/batches/B1-dsh-subagent-thincoder.test.mjs`） | 期望 | B11 后为何仍成立 |
|---|---|---|---|
| 1 | `:366-371` | 委派返回值 `assert.deepEqual` **恰四键** `{text, sessionId, stopReason, status}` | 前景分支**逐字**就是这四键对象；`kind` 只出现在**后台**分支（另一分支）⇒ 该用例走前景、逐字全等 |
| 2 | `:397-415` | **直调** `output.render({}, {text, sessionId, stopReason, status})` | `render` 以 `value.kind === 'background'` 分流；入参**无** `kind` ⇒ 落前景块，两处输出逐字不变 |
| 3 | `:695` | `assert.deepEqual(module.inject, ['tools','subagents','subprocess','storageDomain'])` | `inject` **一字不改**（`src/index.mjs:36`）；`jobs` 走 `ctx.get?.('jobs')` 软取 |
| 4 | `:315-324` | 工具构造的 `ctx` **只有** `subagents`；`config: {}` | `jobs` 解析**只在后台分支内**（`ctx.get?.('jobs')`）；前景用例根本不进该分支 ⇒ 不触 `get` |
| 5 | `:324` | `config: {}` ⇒「默认后台」的叶读作 `undefined` ⇒ 假值 ⇒ 前景 | 叶是**行为叶**、**装载期不读**（§3.1）；`readLiveLeaf(undefined)` 原样返回 `undefined`（`src/config.mjs:72-76`）⇒ 前景 |

第 4 / 第 5 条是**同一道闸的两重保险**：即便叶被读作真值，冻结用例的 `ctx` 也取不到 `jobs` ⇒ 落「默认路径 + 无 `jobs`」⇒ **退回前景**（§5.11 门表第三行）。
⇒ 冻结文件在任一平台上都不变色；本批**不改** B1–B10（含四档 `.test.mjs`，冻结纪律见 `docs/STANDARDS.md` §4.3）。
**B12 的两处例外**：B1 / B11 两份 `.test.mjs` 的**假件与 cwd 用例**必须随 seam 改（§4.12 逐行表）；
四键断言、`{}` 断言、`render` 入参、`inject` 四项、`jobs` 惰性五条**一律一字不改**。
**该前提若被打破**（例如把叶改成装载期解析、或把 `jobs` 加进硬注入面）⇒ 冻结用例变色 ⇒ 属上抛面（§12.4），**不得**改冻结档、**不得**缩 P11。

### 4.11 B12 受影响文件与行数预算（宿主 seam 迁移）

行数基线 = 2026-10-17 本批开工时 `wc -l` 实测（不估算）；增量口径同 §4.1（`+N（≤+N 行）` = 上限，非目标值）。

| # | 文件 | 职责 / 本批动作 | 基线行数 | B12 动作（上限） |
|---|---|---|---|---|
| 1 | `src/provider.mjs` | provider 契约：去掉 `resolveChildCwd` / `validateConfiguredCwd` 导入与自算；只用 `request.cwd`；导出改名（配置覆盖解析） | 150 | **修改**：**+6（≤+6 行）**（净额预计为负，上限照报） |
| 2 | `src/tools.mjs` | 工具面：`startActivation` 调用形态、载体盒、`settleActivation` 映射、取消接线、`config.cwd` 应用、枚举面 cwd 回退链 | 342 | **修改**：**+72（≤+72 行 ⇒ ≤414）**（原报 +70；D4 的抛错 +1 行与其注释 +1 行，按「内容先落定、计数后量取」调申报） |
| 3 | `src/driver.mjs` | 线驱动：会话建立成功后写载体盒（`request.thincoderCarrier?.sessionId`，无盒则跳过） | 501 | **修改**：**+8（≤+8 行）** |
| 4 | `src/errors.mjs` | 错误构造面：新增「会话号未回带」与「失败抛错」两个可读错误入口（区分未建立 / 回带丢失 / 终态失败） | 165 | **修改**：**+20（≤+20 行 ⇒ ≤185）**（原报 +14；`delegationFailed` 是 D4 新增的公开构造点，含两行注释） |
| 5 | `src/config.mjs` | `cwd` 叶注释口径随动（语义落点改了） | 105 | **修改**：**+3（≤+3 行）** |
| 6 | `src/index.mjs` | 插件身份与注册（`inject` 四项） | 61 | **不改**：逐字未动（±0 行） |
| 7 | `src/connection.mjs` / `session-store.mjs` / `platform.mjs` / `stop-reason.mjs` | 线连接 / 存储 / 平台 / stopReason | 262 / 160 / 131 / 44 | **不改**：±0 行 |
| 8 | `docs/batches/B12-dsh-subagent-thincoder-dsh-021.test.mjs` | **本批**单元测试文件（随本批次档存放，`node --test` 直跑） | 0 | **新增**：**+≤281 行**（原报 ≤260；D4 裁定要求补「前景失败抛错」用例 85，实测 281） |
| 9 | `docs/batches/B1-dsh-subagent-thincoder.test.mjs` | 冻结回归面：假件形状与 cwd 用例必须随 seam 改（逐行见 §4.12） | 698 | **修改**：**+20（≤+20 行）** |
| 10 | `docs/batches/B11-dsh-subagent-thincoder-nonblocking.test.mjs` | 冻结回归面：假件形状、cancel 断言、面 10 的零改动断言（逐行见 §4.12） | 196 | **修改**：**+25（≤+25 行）** |
| 11 | `docs/batches/B2/B3/B4-*.test.mjs` | 冻结回归面 | 140 / 159 / 129 | **不改**：±0 行（已实读：不含本批任何被改符号） |
| 12 | `docs/design/DESIGN-dsh-subagent-thincoder.md` | 本设计档 | 1535 | **修改**：**+360（≤+360 行）**（新预算，见下） |
| 13 | `docs/README.md` | 文档地图：批次表加 B12 行 + 两行 P/AC 范围随动 | 46 | **修改**：**+3（≤+3 行）** |
| 14 | `docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md` | 需求档（P12 / AC-21 判定面 / §5 / §6） | 307 | **修改**：**+40（≤+40 行）**（评审轮次 1 号 4 / 5 的补齐：AC-21 判定面重写 + P12 失败分支口径收正；实测 342） |
| 15 | `PROJECT-MANIFEST.json` / `package.json` / `cordis.patch.yml` | 声明与装载形态 | 41 / 31 / 47 | **package.json 改、其余不改**：四个 dsh peer 由 `>=0.2.0-rc.2` 上修为 **`>=0.2.1-rc.2`**（用户 2026-10-18 直接落笔）。旧下界只保证「新版本被接受」，不保证「旧版本被拒」—— 0.2.0 下装载期 import 就崩（`MISSING_EXPORT`），所以下界必须抬到实际支持版本；`PROJECT-MANIFEST.json` / `cordis.patch.yml` 仍 ±0 |
| 16 | `docs/USER-SKILL-delegate-to-thincoder.md` | 随仓发布 skill 的**契约依赖清单**：B12 追加第 12 行（前台失败抛错）+ 第 13 行（cwd 权威在宿主），并把第 11 行收正为「前台**成功**返回四键」 | 67（B11 收口后的实测） | **修改**：**+14（实测 81）**（用户 2026-10-18 直接落笔；B11 的 +7 已在 §4.9 记录，不重算） |

**新预算申报**：设计档 **+≤360 行**（1535 ⇒ ≤1895）。依据同 §4.9 五条：本项目未声明行数上限（`checkConfig.lineCounts = []`）；旧额度已在 B11 用尽；
本批新增 2 节（§4.11 / §4.12）+ 四块接口契约改写（§5.1 / §5.2 / §5.3 / §5.9-B12）+ 5 条 K 号 + 1 条 AC 行 + 1 张用例表；逐节实测后按上限报，**不删内容去凑估算**。
**收口期调整申报（用户 2026-10-18 裁定）**：本批上限由 **≤1895 调至 ≤1900**，三处代码/测试申报按实测上调（tools ≤414 · errors ≤185 · B12 单测 ≤281）。
依据 = `docs/STANDARDS.md` §4.2「计数在内容落定之后量取」：增长全部来自 D4（失败抛错）这一**用户批准的契约变更**，压回旧数字反而本末倒置。

### 4.12 冻结测试文件的逐行改动表（B12 唯一的跨批改动）

授权依据：`docs/STANDARDS.md` §4.3 冻结的是**批次档正文**；测试文件按 B2 先例（曾改 `B1-…test.mjs:218` 的 `linkKey` 用例）可改，但必须**逐行**列明。
先例的性质：假件跟着被替换的宿主 seam 走，**断言的四键契约本身一字不改**。

**A. `docs/batches/B1-dsh-subagent-thincoder.test.mjs`（698 行）**

| # | 行 | 改什么 | 为什么必须改 | 不改会怎样 |
|---|---|---|---|---|
| A1 | `:49` | import 里的 `resolveDelegationCwd` → 新导出（`resolveConfiguredCwd`） | 旧导出已从 `src/provider.mjs` 移除（seam 的 helper 被删） | `SyntaxError`（导出不存在）⇒ 整档不可跑 |
| A2 | `:313-325` | `delegationTool` 假件：`ctx.subagents.start(name, request)` → `startActivation(spec)`；捕获 `spec`，并在假件里写载体盒 | 工具的调用面已换 | 工具调 `startActivation` 落空 ⇒ 所有工具用例 TypeError |
| A3 | `:328-338` | `fakeRun` → activation 收据 `{ childId, result, dispose }`，删 `thincoderSessionId` | 宿主现在只回 `{childId,result,dispose}` | 工具读不到会话号（回带丢失分支）⇒ 四键用例红 |
| A4 | `:366-371` | **不改**（四键 `assert.deepEqual` 逐字保留） | 这是被保住的前景契约本体 | —— |
| A5 | `:372` | `calls[0].name` → `calls[0].provider` | `provider` 现在是 spec 顶层字段 | `undefined` 断言红 |
| A6 | `:373` | `calls[0].request.label` → `calls[0].label` | `label` 已从 request 移到 spec | 同上 |
| A7 | `:376` | **不改**（`request.thincoderSession` 仍 `{}`） | 载体盒走**独立字段** `thincoderCarrier`，不污染会话选择 | —— |
| A8 | `:377` | 注释 `settleRun disposes exactly once` → `the tool disposes the activation exactly once` | `settleRun` 已删 | 注释失真（非红，但违反一处口径） |
| A9 | `:379` | `run.disposed` 计数语义保留（假件的 disposed） | 断言意图不变 | —— |
| A10 | `:453-470` | 面 7 三条 cwd 用例改写（①非空作 `request.cwd`；②空 ⇒ 不传；③删除） | 新旧 cwd 契约不同（§5.9-B12） | 三连红；③ 在测一个已不存在的失效面 |
| A11 | `:424-443` | **不改**（枚举用例用 `ctx: {}`） | 设计约束：枚举面的回退链必须容忍无 `workingDirectory` 服务，落到 `header.cwd` | ——（若回退链写错，这里会红，属设计保护） |
| A12 | `:486-499` | 能力枚举断言：硬编码五键 → **对共享常量的恒等断言**（`assert.equal(provider.capabilities, NO_START_CAPABILITIES)` + 全值 `false`） | 0.2.1 的常量是四键；写死四键会在 0.2.0 树上红、写死五键在 0.2.1 上红 —— 恒等断言在两边都红不了，且正是 §5.1 「复用共享常量」的本意 | 任一侧红（键集随宿主变） |

**B. `docs/batches/B11-dsh-subagent-thincoder-nonblocking.test.mjs`（196 行）**

| # | 行 | 改什么 | 为什么必须改 | 不改会怎样 |
|---|---|---|---|---|
| B1 | `:24-31` | `fakeRun` → 收据形状；会话号改为写入 `spec.request.thincoderCarrier.sessionId` | 回带通道换了 | 工具读不到会话号 ⇒ 面 3/7 红 |
| B2 | `:42-47` | `delegation` 假件 `start` → `startActivation(spec)` | 工具的调用面已换 | 全部后台用例 TypeError |
| B3 | `:79-89` | **断言不改**；随 B1/B2 的假件形状自动适配 | 四键 / `{}` / inject 都是被保住的契约 | —— |
| B4 | `:92-99` | **断言不改**（立即返回） | 行为不变 | —— |
| B5 | `:102-112` | **断言不改**（job spec 逐字四键） | job 规格不变 | —— |
| B6 | `:115-130` | cancel 断言：`seen.signal` → `seen.signal`（spec 上的 signal）；新增 `disposed === 1` | 取消现在必须落到 `activation.dispose()` | 取消只 abort 不 dispose ⇒ 断言不完整（测试空洞） |
| B7 | `:133-155` | **断言不改**（`disposed === 1` / ring 一条会话号） | 结算语义不变 | —— |
| B8 | `:158-168` | **断言不改**（启动拒绝的 detail 前缀） | 错误面不变 | —— |
| B9 | `:171-187` | **断言不改**（三态降级） | 门表不变 | —— |
| B10 | `:190-196` | 面 10 的 `git diff --stat -- src/index.mjs src/driver.mjs` 收窄为**只查 `src/index.mjs`** | B12 **改 driver**（载体写入） | 断言红（B12 的改动被当成违规） |

  B10 的**性质说明**：该断言是 **B11 批的范围主张**（「B11 不动驱动」），不是永久冻结的不变式。
  B12 另立批次，并在 §4.11 第 3 行**显式登记** driver 的改动面 ⇒ 收窄为 `src/index.mjs` 是**正确处置**，
  不是绕过冻结纪律（`.md` 正文仍一字不改）。

  A10 的逐条口径（自表内迁出，内容未删）：①`config.cwd` 非空 ⇒ 作 `request.cwd`；②`''` ⇒ **不传**该键；
  ③「无父 cwd 即错」用例**删除** —— 前提已失效（宿主解析），不是放宽断言。

**C. `B2` / `B3` 两档**：**零改动**。已逐个 grep：不含 `subagents.start` / `startActivation` / `thincoderSessionId` / `settleRun` / `resolveDelegationCwd` / `validateConfiguredCwd` 引用。
**C2. `B4` 一行（D2 裁定 · 2026-10-18）**：`B4:75` 的 `provider.start` 请求补 `cwd: process.cwd()`。
理由 = 0.2.1 起空 `request.cwd` 必须在发布前拒绝（§5.1），而该用例的主题是 argv、不是 cwd；不改则 `[43]` 必红。除这一行外 `B4` 零改动。
**D. 冻结纪律**：`B1–B11` 的 **`.md` 正文**一字不改（§4.3）；上表只涉及两份 `.test.mjs`，且每条都给了「不改会怎样」。

## 5. 接口契约

### 5.1 provider（P2）

实现 `SubagentProvider`（`@deepseek-ai/dsh-subagent`）：

- `name` = `config.providerName`（默认 `thincoder`）。
- `capabilities` = `NO_START_CAPABILITIES`（复用共享常量）。**B12 口径更正**：0.2.1 的该常量是**四键**全 `false` ——
  `agentOptions` / `agentPreset` / `outputSchema` / `depthLimit`（`packages/subagent/subagent/src/types.ts` 的 `SubagentCapabilities`），
  **不再有** 0.2.0 的 `toolFilter` / `persona`；本插件仍全部 `false`（不接续用管理器、不接输出 schema、不接预设）。
- `inheritsParentContext` = `false`（跨进程子代理不继承父会话上下文）。
- **不实现 `prepareContinuable`**（方法存在即能力；本模块不接入 dsh 的续用管理器，见边界）。
- `start(request)`：**只读 `request.cwd`** → 解析会话选择 → `startThincoderRun(request, spec)`。

**B12 · cwd 契约（钉死）**：cwd 解析已**上收到宿主**（`manager.ts:525` 的 `resolveDirectory`：先 `workingDirectory.ensure(parent)`
再解析 `request.cwd`），provider 拿到的是**绝对路径**（`manager.ts:497-501` 注入）。故：

- provider **不再调用** `resolveChildCwd` / `validateConfiguredCwd`（两个 helper 已在 0.2.1 删除）；也不调 `workingDirectory.ensure`（那是宿主侧）。
- `request.cwd` 不是非空字符串 ⇒ **发布前拒绝**（可读错误，零进程）：这是宿主契约被破坏，不是用户可修复的配置错误。
- 子进程 cwd 与 `session/new` / `session/resume` 的 `cwd` **仍是同一值**（thincoder 单 cwd 模型：`handlers-session.mjs:177-181` 要求 `params.cwd === process.cwd()`，比较为规范化 + 大小写不敏感）。
- 导出面：`resolveDelegationCwd`（读 `request.parent`）**删除**，替以 `resolveConfiguredCwd(config)` —— 只读配置叶，不碰请求与父会话；
  `cwd` 非空时的校验（`assertUsableCwd`）在**工具侧**调用（起进程前、可读报错），见 §5.9-B12。

### 5.2 插件私有扩展（工具 ⇄ provider 的会话选择 / 会话号回带）

公共 seam 没有 provider 私有启动参数的开口。本插件用**两个插件私有字段**承载，运行期依据已核实：

- 传参：0.2.1 的 `startActivation` 把 `request` **浅拷贝**后交给 provider（`manager.ts:497-501` 的 `...spec.request`），
  未知字段原样透传；能力校验只查已知字段（`types.ts` 的四键能力面）⇒ 请求可携带 `thincoderSession`（会话选择）与 `thincoderCarrier`（回带载体）。
- **浅拷贝 ⇒ 引用同一」**：`thincoderCarrier` 是普通对象引用，provider 与工具看到的是**同一个对象**（不是克隆），这是载体盒成立的前提。

**两个字段的分工（钉死）**：

| 字段 | 方向 | 形状 | 语义 |
|---|---|---|---|
| `thincoderSession` | 工具 → provider | `{ sessionId?: string, new?: boolean }` | **会话选择**（P3）；缺省 = 默认续用 |
| `thincoderCarrier` | 工具 → driver → 工具 | `{ sessionId?: string }`（可变） | **回带载体盒**（B12）：建立成功后由 driver 写入，工具读回 |

**载体盒契约（B12 · 钉死）**：

- **结构**：工具每条委派新建一个 `{ sessionId: undefined }`（**不复用**、不跨调用共享）；随 `request.thincoderCarrier` 传入。
- **写入时机**：`src/driver.mjs` 在会话**建立成功那一刻**（`sessionId = established` 那一行之后）写入 `carrier.sessionId = sessionId`；
  无盒时 `src/driver.mjs` **跳过**（可选参数 ⇒ B1 的驱动用例不传盒也能跑）。
  时序保证（已核实）：`startActivation` **会 await provider.start**（`index.ts:214` 的 `startExternal` → `manager.ts:498` 的 `start(signal)` 被 await）⇒
  工具拿到 activation 时，盒必已写完（不会因「异步写入未落地」而误报「回带丢失」）。
- **读取时机**：工具在 `startActivation` 返回后读；`activation.dispose()` 之后**仍可读**（盒在工具闭包里，不随宿主收据消失）。
- **建立失败的判定分支（硬要求 · 区分两种情形）**：

| 情形 | 可观测信号 | 工具行为 |
|---|---|---|
| **启动未完成** | `startActivation` 抛出（启动 / 握手 / `session/new` 失败；宿主在抛出前已**回滚并 dispose** 刚物化的 activation，`manager.ts:503-512`） | 原错误路径（§5.3 既有错误面 / 后台 `failed to start:`）；**不去读盒** |
| **已建立但回带丢失** | `startActivation` 已 resolve，但 `carrier.sessionId` 为 `undefined` / 空串 | **可读错误**（`errors.mjs#carrierLost`）：文本含「建立已成功、回带丢失」+ 不把空串当会话号返回；后台面 ⇒ `failed` 带同一 detail |

  两条都必须能分辨：把两种情形写成同一条错误文本会误导排查（一个该查启动，一个该查插件自身）。
  **口径收紧（评审轮次 1 号 3 · 据实声明）**：第一行的文本**不得**写「会话未建立」—— 会话建立成功后、收据发布前若再抛错
  （`assertAdmitting` / `assertLiveParent` / `signal.throwIfAborted()` / catalog 登记，`manager.ts:502-512`），宿主会回滚，工具看到的仍是**一次 reject**
  ⇒ 可观测面上**无法区分**「建立成功后被回滚」与「根本没建立」。因此错误文本统一写「启动未完成（宿主已回滚）」，
  并把「号是否曾落盘」交给枚举面（§5.4 的 `session/list`）去核 —— **不猜**。
- **契约定性**：`thincoderCarrier` / `thincoderSession` 都是**本插件两个模块之间的私有约定** —— 不改公共 seam、不进 `childId`、
  不写目录面、不打印进日志 / 诊断；宿主看到的只是一个不透明字段（与 `thincoderSession` 同族）。
- **备选（不取）**：
  - **A. 把槽号编码进 `run.id`**（如 `tkc:<sessionId>`）：无状态、不靠引用；但 `run.id` 会被宿主当作 `childId`（`manager.ts:869`）并进入**目录面 / 日志面 / 碰撞集**（`assertChildIdAvailable`），
    且必须在插件内反向解析 ⇒ 把一个私有数据搬到公共标识位，**不取**。
  - **B. 插件内 `Map<childId, sessionId>`**：不污染请求；但 `dispose()` 后条目的回收时机只能靠猜（宿主的 disposed 回调不在本插件的面上），漏删会内存长存，**不取**。
- **与旧通道的关系**：旧的 `{...handle, thincoderSessionId}` 回带**已失效**（0.2.1 `receipt()` 只回三键，`manager.ts:1221-1227`）——该写法在本批被**删除**，不保留死分支。

### 5.3 工具面（P4）

工具 `subagent_thincoder`：

工具描述（`description`，模型操作者可见）须含一句并发限制说明：「同一工作区并发委派同一槽时，thincoder 可能静默 fork 到新槽；此时回报的会话号取自请求，未必等于实际槽号（见 §12-3）。」

| 参数 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `description` | string | 是 | 这次委派的短标签（给人看） |
| `prompt` | string | 是 | 交给 thincoder 的任务正文 |
| `sessionId` | string | 否 | 显式接回指定会话号；与 `new` 互斥 |
| `new` | boolean | 否 | 显式开新会话（默认 false） |

校验（`defineTool` schema 层 + `execute` 体内二次校验，因未声明属性不被拒）：
`description` / `prompt` 非空；`sessionId` 与 `new` **互斥**（同时给出 ⇒ 可读错误，不起进程）；`sessionId` 非空字符串。

输出（`output.schema`）与渲染：

- schema：`{ text: string, sessionId: string, stopReason: string, status: string }`。
- `render`：一个文本块 = 最终答复文本 + 一行会话号，形如：

```
<text>

[thincoder session] <sessionId>
```

`text` 为空时该块为 `thincoder returned no text (<status>).\n\n[thincoder session] <sessionId>`。

错误（工具必须返回可读原因，不得挂死）：cwd 配置非法（非绝对 / 不可进入）、`sessionId`+`new` 互斥、会话号不存在、
工程模式前置不满足（P6）、子进程启动失败、协议失败、「已建立但回带丢失」（B12）。构造点全在 `src/errors.mjs`。
（B12 删去旧错项「父会话无 cwd」：宿主现在负责解析 cwd，该情形已归宿主契约错误。）

### 5.3-B12 工具面在 0.2.1 的调用形态（钉死）

**启动调用（逐字）**：

```js
const carrier = { sessionId: undefined }
const request = {
  prompt: [{ type: 'text', text: args.prompt }],
  parent,                                  // 宿主用它取默认 cwd
  ...(cwd === undefined ? {} : { cwd }),   // config.cwd 非空才传；'' ⇒ 不传（§5.9-B12）
  thincoderSession: choice,                // 会话选择（P3）
  thincoderCarrier: carrier,               // 回带载体盒（§5.2）
}
const activation = await ctx.subagents.startActivation({
  provider: config.providerName,
  label: args.description.trim(),          // label 在 spec 顶层，不再进 request
  request,
  signal,                                  // 前景 = exec.signal；后台 = 自建 controller.signal
  delivery: 'caller',                      // R1：保住四键前景契约（B1:366-371）
})
```

- `request` **不带** `label` / `signal`（spec 的 `request` 类型是 `Omit<SubagentStartRequest,'label'|'signal'>`，`types.ts:38`）；
  **但宿主在调 provider 时会把两者重新拼回**（`manager.ts:498-500`：`{ ...spec.request, cwd, label: spec.label, signal }`）⇒
  provider 侧仍能读到 `request.signal`（`src/driver.mjs` 的既有信号用法**不需要改**），工具也无需另走一条信号通道。
- `delivery: 'caller'` 的含义：本插件自己结算（不交给宿主播报，也不进 catalog）—— 这正是 P4 四键返回面的前提。
- `receipt` 只给 `{ childId, result, dispose }`；会话号走载体盒，**不**从 receipt 取。

**结算映射（自实现 `settleActivation` · 逐条对照 0.2.0 的 `settleRun`）**：

| `activation.result` 的 `stopReason` | 诊断 | `JobOutcome` | 备注 |
|---|---|---|---|
| `completed` | —— | `{ status: 'completed', result: finalText }` | 文本取 `output` 折叠（P2 / K6） |
| `aborted` | 无 | `{ status: 'killed' }` | 取消 / 进程事件导致的终止 |
| `aborted` | 有 | `{ status: 'failed', detail }` | 有诊断即非纯取消 |
| `error` / `max-tokens` / `refusal` / 其它 | —— | `{ status: 'failed', detail }` | detail = stopReason + 诊断（同 0.2.0 的 `failureDetail` 形态） |
| `activation.result` **拒绝** | —— | `{ status: 'failed', detail: jobFailureDetail(error) }` | 基础设施错误（发布后极少） |
| `dispose()` **拒绝** | —— | 在上一条 outcome 上拼接 `dispose failed: <有界原因>`；status 变 `failed` | teardown 失败**只**经这个口子可见（`manager.ts` 的 `finishDisposal` 末尾 throw） |

  **顺序（钉死 · 理由 = 归因，不是防挂）**：`settleActivation({ activation, carrier })` 内部 = ① `await activation.result` → ② `activation.dispose()` → ③ 验盒 → ④ 组装 `JobOutcome`。
  取消路径上 `result` **也会** settle（teardown 驱动：`settleRunResult` 的 `parts.cancelled()` 分支直接返回 `{ output, stopReason:'aborted' }`，`out-of-process.ts:150-165`）
  ⇒ 两种顺序都不会挂；先 `result` 是为了 **(a)** 拿到真实终态（先 dispose 会让 `aborted` 吃掉 completed 的文本）、
  **(b)** 让 dispose 的 rejection **单独归因**、不被 result 覆盖。（评审轮次 1 号 1 指的「相反说明」在本句收正：防挂不是理由。）

**取消接线（钉死 · 最易漏的一处）**：`startActivation` 之后，调用方的 `signal` **不再**连到 run（只有 `dispose()` 能停它）。

| 面 | 接线 | 细节 |
|---|---|---|
| 前景 | `addEventListener('abort', onAbort, { once: true })` + `finally` 移除 | 注册后**补一次** `if (exec.signal.aborted) onAbort()`（覆盖「发布前已中止」的窗口） |
| 后台 | `cancel()` = abort + `activation?.dispose()`，**收据返回后补检** | `activation` 是 `let`（`done` 里赋值）：启动期 cancel ⇒ 只 abort（宿主的 `spec.signal.throwIfAborted()` 使 `startActivation` 不建立，`manager.ts:502`）；发布后 ⇒ abort + `dispose()`；
  **关键补丁（评审轮次 1 号 1）**：`activation = await …` 之后**立即**补 `if (controller.signal.aborted) void activation.dispose()` ——
  abort 恰好落在「宿主已过 `throwIfAborted`、收据尚未交回」这段时，只有这次补检能把取消落到真实 run 上（否则 run 白跑到结束）。
  单测面 = 用例 83（受控 Promise 构造该交错）。 |

  前景的完整写法（与 `src/driver.mjs` 既有同形）：`onAbort = () => void activation.dispose().catch(() => {})`，
  即 `exec.signal.addEventListener('abort', onAbort, { once: true })`，`finally` 里 `removeEventListener`。
  后台的 cancel 体：`cancel: () => { controller.abort(); void activation?.dispose().catch(() => {}) }`。

  `dispose()` 与宿主自动 dispose 的**禁争**：宿主在正常结算时已经 `run.result.then(finish,end)`（`manager.ts:972-978`），
  `close()` 幂等（`manager.ts:781-786`）⇒ 工具侧显式 `dispose()` 与它共享同一事务，**不会双拆**；这也是「工具必须显式 dispose」与「宿主也会 dispose」能共存的原因。

**盒空 = 一种 outcome，不是一条早退路径（评审轮次 1 号 2 的修正 · 钉死）**：
取得 activation 之后，**每一条出口都经过同一次 dispose** —— 盒校验因此**不能**写成「先抛错、跳过清理」：

```js
async function settleActivation({ activation, carrier }) {
  let outcome
  try { outcome = mapStopReason(await activation.result) }     // ① 可能 reject ⇒ 基础设施错误分支
  catch (error) { outcome = { status: 'failed', detail: jobFailureDetail(error) } }
  let disposeError
  try { await activation.dispose() } catch (error) { disposeError = error }   // ② teardown 唯一口子
  if (disposeError !== undefined) outcome = failWith(outcome, `dispose failed: ${boundedText(disposeError)}`)
  const sessionId = carrier.sessionId                          // ③ 验盒（在 dispose 之后 —— 盒在工具闭包里，dispose 不影响它）
  if (typeof sessionId !== 'string' || sessionId === '') {
    return { sessionId: undefined, outcome: { …outcome, status: 'failed', detail: joinDetail(carrierLostDetail(), outcome.detail) } }
  }
  return { sessionId, outcome }                                // ④ 两项诊断都保留，不吞任何一个
}
```

- **前台**：拿 `settleActivation` 的结果；`sessionId === undefined` ⇒ 抛 `carrierLost(detail)`（**抛之前清理已完成**，不存在「先抛错跳过 dispose」的路径）；正常 ⇒ 四键逐字（`B1:366-371`）。
  - **失败路径以抛错表达**（`outcome.status === 'failed'` ⇒ 抛 `delegationFailed(detail)`，与 `carrierLost` 同形）：不抛就是「失败伪装成空结果」，正是 B12 要消灭的静默失效；
    `killed`（用户取消）不是失败，仍走四键返回。成功路径的四键契约一字不动。
- **后台**：**会话号在收据返回时就发布**（`job.append('[thincoder session] ' + carrier.sessionId)`，仅当盒有效）—— 执行期间必须能读回，等到结算后发布就失去意义（轮次 2 发现 1）；
  随后同一个 `settleActivation` 做**权威验盒 + 统一清理**：盒空 ⇒ outcome 即 `{ status:'failed', detail }`（**不**往环里写空串，也不跳过 dispose）。
- 两个面**共用同一个 `settleActivation`** ⇒ 「缺盒且 dispose 也拒绡」时 detail = `<回带丢失文本> | dispose failed: <有界原因>`，两项诊断都在。

### 5.4 会话枚举（P7）

独立只读工具，名 = `config.sessionToolName`（默认 `subagent_thincoder_sessions`）。无必填参数。

- 返回：`{ sessions: [{ sessionId, title, updatedAt }] }`（来自 `session/list` 的 `SessionInfo`，`handlers-slots.mjs:42-62`）；`render` 每会话一行。
- 复用同一条连接路径：spawn → `initialize` → `session/list`（无需 `session/new`）→ 断开。
- 空集合返回空列表，不是错误；thincoder 未配置凭据时把 `AUTH_REQUIRED` 转成可读错误。

### 5.5 会话选择判据（P3 · 钉死）

```
1. choice.sessionId 且 choice.new        → 拒（可读错误），不起进程
2. choice.sessionId                      → session/resume(sessionId)
3. choice.new === true                   → session/new
4. 否则 target = store.lookup(linkKey(parentSessionId, cwd))
     target 存在 → session/resume(target)
     target 不存在（无记录）→ session/new
```

建立与回报：

- `session/new` → 应答 `sessionId` 必须是字符串，否则按协议错误处理；本次会话号 = 该值。
- `session/resume` → 应答**不含**会话号（`ResumeSessionResponse` 只有 `configOptions`；`handlers-slots.mjs:139-194`）；本次会话号 = 请求里的 `sessionId`。并发下若发生静默 fork，回报/记录的是请求号，可能与实际槽不一致 —— 见 §12-3。
- 成功建立后（无论 new 还是 resume）写记录：`store.remember(linkKey, { parentSessionId, cwd, sessionId, updatedAt })`。

**槽不存在 / 建立失败的回退语义（钉死）**：**不自动回退**。
显式 `sessionId` 不存在 ⇒ 可读错误（点明该 id，并提示改用 `new: true` 或用枚举工具挑一条）；
默认记录指向的槽不存在 ⇒ 同样可读错误（点明旧记录已失效 + 上述提示）。记录**只在成功建立后重写**，失败的 resume 绝不改写记录 —— 静默换成新槽会静默丢掉连续性，正是本模块要消除的失效面。

**工程前置失败（P6 · 按用户裁定）**：拒载面 = 工程档**不可解析**（invalid / ambiguous / init-failed）；**缺档不是拒载面**（thincoder 就地建档后照常接回，`manifest.mjs:217-244` 的 `init` 默认 true）。
插件把 thincoder 的建立失败（ACP 错误应答）转成可读工具错误，**必须携带** thincoder 的稳定文案族 `/项目不可解析/`
（ACP 包装形如 `failed to resume session <slot>: <r.message>`，`handlers-slots.mjs:151-155`；load 面同族 `:79-84`），并点明「目标工作区的工程档不可解析」。
ACP 错误应答在客户端侧表现为 SDK 抛出的 `RequestError`（`@agentclientprotocol/sdk` 的 `jsonrpc.d.ts:549-590`，带 `code` / `message`）；
`sessionError` 从 `err.message` 取 thincoder 文本，经 `boundedText`（默认 1024 字符）折叠空白后嵌入；
发布后的 `diagnostic` 仍走 harness 自己的 4096 字节限长（`dsh-subagent/lib/types/types.d.ts:276-279`，`settleRunResult` 内应用）。

### 5.6 存储面（P3）

`src/session-store.mjs`：

- domain：`defineDomain({ name: 'subagent_thincoder', version: 1, layout: 'single', tables: { session_links: domainTable(schema) } })`。
  名字必须是 `subagent_thincoder`：`UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/`（`deepseek-harness/packages/storage/storage/src/backend.ts:10`）**不允许连字符**。落盘 = `~/.dsh/storages/subagent_thincoder.json`。
  **不得复用 `thincoder` domain**：同一 facility 内一个 domain 只能开一次（`already-open`，`deepseek-harness/packages/storage/storage-domain/src/index.ts:104-105` 的 `reserved` 集），而 `dsh-thincoder` 已长开 `thincoder`。
- 表：`session_links`；记录（zod v4）：`{ parentSessionId: string(min 1), cwd: string(min 1), sessionId: string(min 1), updatedAt: number(int ≥ 0) }`。
- 键：`linkKey(parentSessionId, cwd, platform, canonicalize)` = `parentSessionId + '\u0000' + keyPath(canonicalize(resolve(cwd)), platform)`（NUL 分隔是仓内先例，`dsh-thincoder/src/state.mjs:251`）。含父会话维度，避免跨 dsh 会话串槽。
  判据（文件系统大小写语义）、回退与平台参数的职责见 §5.9；入参校验先于归一（空值抛错时一次文件系统读都不发生）；`canonicalize` 抛出的异常由 `linkKey` 兜底（回退到已 `resolve` 的路径）⇒ **键的构造从不抛错**。
- 读写语义：读 `table.get(key)`（同步，来自内存）；写 `table.put(key, value)`（入 domain 写链，最后一个写赢，`deepseek-harness/packages/storage/storage-domain/src/domain.ts:307` 的 `KvTableImpl.put`）。**插件不自造锁**：并发委派各自读写，冲突按 last-write-wins 收敛（P5）。
- 生命周期：`open(ctx)` → `ctx.storageDomain.open(domain)`；`apply` 内 `ctx.effect(() => () => store.close(), 'dsh-subagent-thincoder: close session store')`。
- 版本纪律：`single` 后端的 `parse` 拒绝任何版本差异 ⇒ **将来加表不得 bump version**（version-1 文档缺表 = 空表兼容）。

### 5.7 ACP 线契约

| 步骤 | 调用 | 参数 | 说明 |
|---|---|---|---|
| 握手 | `initialize` | `{ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }` | 不宣告任何可选客户端能力（不 fs / 不 terminal） |
| 新建 | `session/new` | `{ cwd, mcpServers: [] }` | 应答 `sessionId` 必须为字符串 |
| 续用 | `session/resume` | `{ sessionId, cwd }` | 不重放历史；应答不含会话号 |
| 枚举 | `session/list` | `{ cwd }` | 应答 `sessions: SessionInfo[]` |
| 提示 | `session/prompt` | `{ sessionId, prompt: [{type:'text',text}] }` | 只发文本块 |
| 取消 | `session/cancel`（通知） | `{ sessionId }` | best-effort；进程 teardown 仍是权威 |
| 关闭 | `session/close` | `{ sessionId }` | teardown 第一步，释放槽认领（P5/AC-5） |
| 权限 | `session/request_permission`（收） | — | `allow` 取第一个 `allow_once`/`allow_always`；否则 `cancelled`，不上抛给人 |
| 更新 | `session/update`（收） | — | 只消费 `agent_message_chunk` 的文本；思考/工具调用/计划不上抛 |

### 5.8 断开顺序（P5 · 钉死）

```
teardown():
  1) try { await agent.request('session/close', { sessionId }) } catch { log }   // 先释放槽认领
  2) await disposeChild(child, disposeEofGraceMs)                                // stdin EOF → waitForExit(eofGrace)
                                                                                 //   超时 → terminate() → waitForExit()
```

异常路径（取消 / 协议失败 / 启动回滚）同样先尽力 `session/close`（若会话已建立）再走同一阶梯；`dispose()` 幂等。

### 5.9 平台适配（P9 / P10）

**收敛点（钉死）**：全仓只有一个模块读平台或按平台分支 —— `src/platform.mjs`。
其余模块（driver / provider / tools / connection / session-store / config / index）平台中立；
判定方式可机检：`grep -n "win32" src/` 只命中 `src/platform.mjs`。

`src/platform.mjs` 导出六件（另有模块私有的 `environmentValue`，不外泄，见 §5.9 规则 3）：

| 导出 | 语义 |
|---|---|
| `currentPlatform()` | 全仓唯一的 `process.platform` 读点 |
| `resolveLaunchArgv({ subprocess, command, args, env, platform = currentPlatform() })` | 把「配置里的命令 + 参数」解析成**最终 argv**（async）；`platform` 缺省 = 宿主平台（B4） |
| `resolveChildArgv(subprocess, spec)` | **启动面单一来源（B4）**：**只读** `spec` 的**行为叶三字段** `command` / `args` / `env`（规范化输入形状见下）⇒ 最终 argv；全仓唯一调用 `resolveLaunchArgv` 的地方 |
| `keyPath(path, platform)` | 续用键里的**大小写折**：win32 ⇒ `toLowerCase()`，其余 ⇒ 逐字；纯字符串函数，**不读文件系统** |
| `canonicalPath(path)` | 续用键里的**路径规范化**（B3）：`realpathSync.native` 的真实路径；任何错误回退入参、**不抛错** |
| `isBatchTarget(path)` | 扩展名（小写比较）∈ `{'.cmd', '.bat'}` |

**启动面单一来源（B4 · 钉死）**：全仓只有一个函数把「行为叶」解析成「最终 argv」—— `resolveChildArgv(subprocess, spec)`，
两条面都调它：委派面 `provider.mjs#start`（第二参 = `resolveBehaviourSpec(config)` 的产物）、
枚举面 `driver.mjs#listWorkspaceSessions`（第二参 = 工具铺下来的 spec，其 `command` / `args` / `env` 就是同一批行为叶）。
**规范化输入形状（B4 · 钉死）**：解析函数只读 `spec` 的**行为叶三字段** `command` / `args` / `env`（来源 = 该面自己的行为叶）；`ctx` / `cwd` 等铺参数**不进解析输入**。
故「同一入参形状」= **两条面传入的「行为叶键集合」相同**（即各自 `spec` 中命中这三字段的键；同一批行为叶），**不是「两个对象相同」**。可机检：两处调用各捕获实参、取其行为叶键集合断言相等（B4 用例 43 / 44）。
平台读点在 `resolveLaunchArgv` 的默认形参里：调用方**不再传也不再看平台**（§4.7-②）。
机检口径（B4 用例 45）：`src/**` 内 `resolveLaunchArgv(` 出现 **2 次**（1 定义 + 1 调用）；`process.platform` 出现 **1 次**（`platform.mjs:26`）。

**win32 启动规则（钉死，四条）**：

1. **解析**：`await subprocess.resolveExecutable(command, env)` —— dsh 的公开解析面（`@deepseek-ai/dsh-subprocess` 的抽象方法，
   `subprocess/src/index.ts:133`；实现 `subprocess-local/src/index.ts:140`，按 PATH + PATHEXT 展开候选），返回**已探到的绝对路径**。
   实测读数示例：`thincoder` → `<node 安装目录>\thincoder.CMD`（PATHEXT 首序 `.COM;.EXE;.BAT;.CMD`）。
   解析不到 ⇒ 抛可读错误（`errors.mjs#launchError`），**不起进程**；解析**返回的不是非空字符串**（空串 / 非字符串）同样拒绝
   —— 与规则 3 解释器候选面的 `nonEmpty` 判定同口径（B4 · 台账 #24，见 §7-K30）。
2. **分支**（只看解析结果的扩展名）：
   - `.cmd` / `.bat` ⇒ 经命令解释器：`argv = [interpreter, '/d', '/s', '/c', 'call', target, ...args]`；
   - 其他（`.exe` / `.com` / 其他）⇒ `argv = [target, ...args]`，**不加解释器层**。
3. **解释器**（候选来源与优先级钉死；顺序取，第一个命中者即定）：① 配置 `env` 里的 `ComSpec`（若给了且非空）→ ② 宿主 `process.env` 里的 `ComSpec`（若存在）→ ③ 字面 `'cmd.exe'`。
   两个候选的**读取口径与 dsh seam 同口径（B3）**：先取精确大小写的键；未命中且平台为 win32 时，再按 `toUpperCase()` 全表找一次 —— 即 `COMSPEC` 与 `ComSpec` 在 win32 上等价（P9 明文：不得比插件所调用的 seam 更严）。
   该读取由模块私有 `environmentValue(env, name, platform)` 承担，宿主值同样经它读（`process.env` 作入参）；**候选顺序不变**，非 win32 逐字读（`COMSPEC` 在该平台是另一个变量）。
   每个候选都经**同一个解析面** `await subprocess.resolveExecutable(candidate, env)` 解析 —— 与第 1 条解析 `command` 是同一个方法、同一个 `env`，不另立第二套解析规则；
   某候选给了却解析不中 ⇒ 继续试下一候选；三个候选全不中 ⇒ 可读错误（`errors.mjs#launchError`），**不起进程**。
   命中者返回的绝对路径即 argv 的解释器元素（`.exe`，交 dsh 后按原生可执行文件启动，不再被解析）。
   **与宿主环境的关系钉死**：①②③ 是三条**互相独立**的来源，候选顺序只决定「先试哪个字符串」；`resolveExecutable` 内部以宿主环境为基底、把配置 `env` 叠加其上，
   故宿主变量始终在同一环境基底里可见 —— 配置给了 `ComSpec` 且可解析时便不再看宿主值，但解析环境本身不因候选而变。
   **不硬编码任何安装路径**：Node 位置 / 包管理器布局 / 用户主目录一律不进代码与默认值；
   `ComSpec` 是**平台自己声明的**解释器位置，运行时读取，只作候选之一（§7-K22）。
4. **非 win32**：`argv = [command, ...args]`，**逐字原样** —— 不解析、不包装、不加层（P9 明文：非 Windows 启动形态不变）。

**为什么包装里必须有 `call`（本机探针实证，探针见 §12-6）**：

`cmd` 对 `/c` 后面的字符串先做引号处理；带 `/s` 时走「老行为」——**首字符是引号就去掉它，并去掉该串里最后一个引号字符**。
于是「给含空格的路径加引号」在 `/s` 下会自毁：`/c "C:\p s\prog.cmd" acp` 被改写成 `C:\p s\prog.cmd acp`，命令名断在空格处（本机实测失败）。
而 dsh 的 argv→命令行转换是 Win32 规则的**逐元素加引号**（`quoteArg` / `buildCommandLine`，`win32-process/src/process.ts:26-55`），
**产生不出 cmd 需要的双层引号形态**（元素内的引号会被转义成 `\"`）⇒ 靠 dsh 加引号无法覆盖「路径含空格」这一真实场景。
`call` 把这条陷阱整根消掉：`/c` 之后的首个 token 永远是 `call`（不含空格与引号 ⇒ 永不被加引号 ⇒ 首字符永不是引号），
`/s` 的引号剥离因此**永不触发**；含空格的路径作为 `call` 的被调用名由 cmd 自己按引号解析，参数原样续在后面。

**args 转义规则（钉死）**：插件**不自建转义层**。目标与参数各作为**独立 argv 元素**交给 dsh，由平台自己那一层（`quoteArg`）加引号一次；
含空格的参数据此原样到达子进程（本机实测：参数 `a b` 在子进程侧是**一个**参数）。
探针实证的往返边界（§9.2 用例 15–32 与 §12-6）：空白、双引号、尾部反斜杠、非 ASCII 均可逐字往返；
**cmd 元字符（`%` 变量展开；`&` `|` `<` `>` 命令分隔；`^` 被吞）在「无需加引号」时会被 cmd 自己解释** ——
本机复核（2026-10-07）：参数字面 `a&b` 令批处理只收到 `a` 并以 exit 1 报「不是内部或外部命令」，`%PATH%` 被展开成真实 PATH，`a^b` 收到 `ab`。
**`(` / `)` 不在检出集**：实测参数字面 `c(b)` 逐字往返；含 `(x86)` 的**目标路径**（Program Files 常见落点）在 `call` 形态下同样正常 —— 二者不列入检出集。
**cmd 元字符检出与拒绝（钉死 · 用户裁定 2026-10-07 取备选 B）**：win32 下，配置里 `args` 的**任一元素**含检出集任一字符 ⇒ **在起进程前拒绝**、报可读错误、**零进程**。
检出集恒为六个字符：`%`（变量展开）· `&` `|` `<` `>`（命令分隔）· `^`（被吞）—— **不含** `(` / `)`；
对**目标路径**（`command` 的解析结果）与解释器路径**不做此检**（含 `(x86)` 的常见安装路径必须照常放行）。
生效平台**只有 win32**：POSIX 下这些字符是普通字符，`argv` 逐字原样、不拒绝（§9.2 用例 28 守住该反例）。
检出在 `resolveLaunchArgv` 的 win32 分支内、**先于命令解析**执行（纯字符串判定，不需要环境或进程）；
失败点仍在**起进程之前**（`provider.start` / 枚举工具）—— 与解析失败共用同一条零进程路径（§6.1-L13）。
错误形态与解析失败同族（`src/errors.mjs#launchError`）：文本含配置里的命令 + 命中的字符 + 修复提示，经 `boundedText` 限长；**不含环境变量值、不含解析出的路径**。
取舍口径 = 快速失败优先于「照跑但语义已变形」（那些字符会被解释器自己解释）；**只检配置来的 `args`**，ACP 载荷走 stdio、不经参数，默认 `args: ['acp']` 不触及。
不自建转义的依据：自建 `^` 转义实测不可靠（`^%PATH^%` 仍被展开、`^&` 未按预期传递），且一层自建转义会让两平台的参数语义分叉（§7-K21）。

**原子性（不得有「解析成功但 spawn 起不来」的中间态）**：解析发生在**起进程之前**（`provider.start` / 枚举工具；解析失败 ⇒ 直接拒绝、零进程）；
交给 dsh 当 `argv[0]` 的，只会是**本插件已用同一个公开解析面探到过的绝对路径** —— 解释器（`.exe`）或目标本身（非 `.cmd`/`.bat`）。
两种形态都在 dsh 自己那套「先探本名、再补 `.com`/`.exe`」的命中面内（`runner-launch.ts:231-240`）⇒ 不存在「我们解析成功、它再解析失败」的缝。
解析后仍有竞态（文件被删）时，落回既有的启动失败面（`stage: process` / `category: process-start`），行为与 B1 一致。

**失败面**：解析失败 = **可读工具错误**（`launchError`：点明配置里的命令 + 解析器文本（经 `boundedText` 限长折叠）+ 修复提示；
**不含环境变量值、不含解析出的路径**）；`start()` 在发布前 rejects ⇒ 无半态。**解析结果可用性**（空串 / 非字符串 ⇒ `launchError`，B4）与解析失败共用这条失败面。
发布后的诊断面不变（P2 的固定安全形态，§5.5）。

**两级进程与断开阶梯（本批必须给结论的判断项）**：包装形态的进程树 = `cmd` → `node`（`.cmd` shim 里的 `node` 行），
**没有多出进程层** —— `call` 只是让 cmd 在**同一个进程内**跑批处理内容。结论：**两个宽限照旧适用，本批不动默认值**。

1. `disposeEofGraceMs`（第一级：stdin EOF）足够：关掉 stdin ⇒ shim 的 `node` 收到 EOF 退出 ⇒ cmd 跑完批处理收尾退出。
   本机实测：整条包装命令在 piped stdin 上 EOF 后 **1111ms** 退出、exit 0（默认宽限 6000ms）。
2. `disposeGraceMs`（spawn 宽限 + 启动回滚等待）与层数无关：它约束的是 dsh 侧的终止升级与回滚等待（§5.8 阶梯、§5.5 回滚）。
3. `waitForExit` / `terminate` 覆盖整个托管范围（Run job 对象，`win32-process/src/process.ts:503` 的 `assignProcessToJobObject`），
   cmd 与 node 都在范围内 ⇒ 收尾不需要为两级树加宽限。

**P10 键归一（B3 收口 · 钉死）**：键的构造是 `parentSessionId + '\u0000' + keyPath(canonicalize(resolve(cwd)), platform)`，两条输入各司其职：

- **判据 = 目标路径所在文件系统的大小写语义**（P10 明文），由 `canonicalize = canonicalPath` 从文件系统**取得**（`realpathSync.native`）：
  大小写不敏感的文件系统上，两种大小写形态解析到**同一个真实路径** ⇒ 同一个键；大小写敏感的文件系统上它们是两个目录 ⇒ 两个键；
  符号链接别名（`/tmp/ws` ↔ `/private/tmp/ws`）同样合一 —— 纯字符串规范化做不到这一步（旧口径的缺口）。
- **`platform` 参数只决定 win32 上的补充折**（`keyPath`：win32 ⇒ `toLowerCase()`，与 thincoder 自己的 `normalizeCwd(p).toLowerCase()`（`thincoder-cli/src/acp/handlers-session.mjs:169-180`）同语义），**不是判据本身**：
  折只在 realpath 给不出答案时（路径不存在 / 不可解析的回退面）与「win32 上尚未存在的工作区」上起作用。
- 归一**只作用于键**：记录里的 `cwd`、传给子进程的 cwd、`session/new` / `session/resume` 的 `cwd` 一律保持原值（P10 明文）。
- **回退责任分层（钉死）**：`canonicalize`（含注入的桩函数）抛出的**任何**异常由 `linkKey` 捕获、回退到已 `resolve` 的路径 ⇒ 键的构造是**永不抛错**的面；默认 `canonicalPath` 自身也捕获回退，两层各自成立、互不依赖（见三问②与 §6.2-N1/N5）。

**B3 三问回答（逐条）**：

1. **`platform` 注入口径的变化**：注入值不再等于「归一判据」，只等于「win32 补充折」。故 `linkKey(..., 'linux')` 的含义从「键 = `resolve(cwd)` 逐字」变为
   「键 = `canonicalPath(resolve(cwd))`（realpath 不可解析时退回 `resolve(cwd)`）**且不折**」—— 路径真实存在且带符号链接或大小写别名时，两个口径给出的键**不同**（这正是本批要的行为变更）。
   冻结的 B1 / B2 用例仍全绿：其入参（`/tmp/ws`、仓根 `WS`、`Mixed/Case`）在实机上都不存在 ⇒ 回退 ⇒ 与旧口径逐字一致（逐条论证与实机核对见 §4.4）。
   **realpath 的结果不可注入**（它就是文件系统的答案），故可测性由 `linkKey` 的**第四参** `canonicalize` 承担：默认 `canonicalPath`，测试传桩函数即可模拟「大小写不敏感 / 大小写敏感」两种语义（§9.3 用例 33 / 34 / 36）。
2. **realpath 的失败面（两层，钉死）**：`canonicalPath` 内 `try { realpathSync.native(p) } catch { return p }` —— **捕获全部错误**（ENOENT / EACCES / ELOOP / EINVAL 一律回退）、**不抛错**、不写诊断噪声、**不做部分解析**（不回退到「逐级 realpath 到最深存在祖先」）；回退值 = 已 `resolve` 的字符串。
   **`linkKey` 再兜一层**：`canonicalize`（含注入的桩函数）抛出的任何异常由 `linkKey` 捕获、回退到已 `resolve` 的路径 ⇒「键的构造从不抛错」对**任何** `canonicalize` 成立，不只对默认函数（§6.2-N5、§9.3 用例 37）。
   委派本身的失败面不变：仍由 P2 / P6 的既有诊断承担。
3. **realpath 合并旧键的处置 = 不迁移、不扫描**（§7-K26）：旧键在新规则下不再被命中时，表现为「该工作区的默认续用退化为新建槽」；
   **不做一次性迁移脚本，也不在 lookup 未命中时扫描表内记录**。理由：① 键的归一是**构造规则**，不是数据迁移；
   ② 大小写敏感的文件系统上「两个仅大小写不同的工作区」是**合法存在的两个工作区**，扫描合并会误合并；
   ③ 已落盘的现有记录中，realpath 与原值相同者 ⇒ 零影响；不同者按上条退化为新建槽，且救回路径见④；
   ④ 救回路径已在：`subagent_thincoder_sessions` 枚举 + 显式 `sessionId`（§5.5 不自动回退）。影响面与备选见 §12.1-14。

### 5.9-B12 cwd 权威上收（B12 · 钉死）

**一句话**：子进程 cwd 的唯一解析者是**宿主**；插件只做两件事 —— 把配置里的覆盖**转成请求**，以及给枚举面备一条**回退链**。

**① 委派面（钉死）**：

| `config.cwd`（每次委派经 `readLiveLeaf` 读） | 插件动作 | 宿主行为 |
|---|---|---|
| 非空 | `assertUsableCwd(PREFIX, 'config cwd', value)`（**必须绝对**且可进入）通过后作 `request.cwd` | 直接采用该绝对路径 |
| `''` / `undefined` | **不传** `request.cwd` | 取父会话**当前**目录 |

- **显式裁定：保留该叶**（不退役）。备选（退役）不取：P2 明写「可配置覆盖」，且部署 profile 已带 `cwd: ''`（§3.2）；
  退役 = 默默地削需求 + 让现有配置变成未知叶。
- **与旧 `header.cwd` 不等价（钉死口径）**：旧口径空值读 `parent.session.header.cwd`＝**原始项目身份**；新口径读**当前目录**。
  用户切过目录后两者分叉 —— 这是迁移的**实质收益**（子代理终于跟得上「我现在在哪」），不是等价改写；文档与注释**不得**写成等价。
- **一处语义收紧（据实声明）**：`config.cwd` 配成**相对路径**现在报可读错误（`assertUsableCwd` 要求绝对）。
- **目录消失时的宿主分支（B12 自评补 · 必须知道）**：`config.cwd` 为空时宿主走 `workingDirectory.ensure(parent, signal)`（`manager.ts:519-523`）；
  若父会话**当前目录已不存在**，该调用会先把目录**恢复到原始项目目录**再返回（`packages/session/working-directory/src/index.ts:135-146`）——
  即「目录没了」不会报错，而是**静默落回原始项目**。效果 = 子代理落在恢复后的目录；这与旧 `header.cwd`「永远原始项目」在**未切目录**时相同、
  在**切过多级后目录被删**时不同（旧：原始项目；新：原始项目——恰好同一处，但依据不同：旧是常量，新是恢复动作）。
  实现侧**不需要**为这个分支写代码（宿主负责），只需要不假设「空 cwd ⇒ 一定是当前目录」。
  旧实现会先 `resolve()` 再校验（锚 = **服务进程启动目录**）—— 那是本模块一直在消除的锚歧义；守绝对路径是更小的口。

**② 枚举面回退链（钉死 · 软取）**：

```js
const configured = resolveConfiguredCwd(config)          // 非空 ⇒ assertUsableCwd 后的绝对路径；空 ⇒ undefined
const wd = ctx.get?.('workingDirectory')                 // 软取：不进 inject（四项不变）
const projected = typeof wd?.get === 'function' ? wd.get(parent.session) : undefined
const cwd = configured ?? nonEmpty(projected) ?? nonEmpty(parent?.session?.header?.cwd)
if (!cwd) throw workingDirectoryUnavailable()            // 可读错误（三路都没有才报）
```

- `workingDirectory.get(session)` **同步**，入参是 **`Session` 对象**（不是会话号）：`get(session: Session): string`（`packages/session/working-directory/src/index.ts:122-124`）⇒ 调用面写 `wd.get(parent.session)`。
- `assertUsableCwd` 签名 = `(prefix: string, label: string, cwd: string): string`（`out-of-process.ts:104-112`）：
  非绝对 ⇒ 抛「must be an absolute path」；不可进入 ⇒ 抛「is not an accessible directory」⇒ 工具側包成可读错误（不直接外泥）。
- 第三段回退（`header.cwd`）是**为了 B1 的冻结用例**：它用 `ctx: {}` 构造枚举工具（§4.12-A11），没有服务可取。
- 三路全空才报错，且错误文本点明「配置 cwd / workingDirectory / 会话头目录」三路都不给。

**机检口径**：`src/**` 内读 `workingDirectory` 的调用**只在 `src/tools.mjs`**（枚举面）；`provider.mjs` 不碰该服务（cwd 已由宿主解好）。

### 5.10 真 Linux 取证契约（B6 · 钉死）

**路线（钉死）**：真 Linux 取证走**容器** —— 宿主 Docker Desktop 起 `node:22-alpine`，仓根**只读**挂进容器，容器内跑既有四档单测与两条探针。
理由与被否替代（真机 / CI）见 §7-K31。**证据面 = 本插件自己的代码面**；不覆盖的面见 §10 与 §12.3-24。

**挂载与依赖口径（钉死）**：仓根**只读**挂载（`-v "$PWD":/src:ro`）⇒ 容器内一行都写不回仓里。
宿主 `node_modules` 常常是指向 dsh 安装树（如 Homebrew 前缀下）的**符号链接**、而该路径**未必被 Docker 共享** ⇒ 容器内**不挂宿主依赖**，改为在容器内按 `package.json` 的 `peerDependencies` 自行 `npm install`（镜像源见下）。

**取证配方（在仓根执行）**：

```
# E1 镜像（幂等：已就位则打印 Image is up to date）
docker pull node:22-alpine

# E2+E3 容器内准备（只读挂仓根 → 复制一份到容器内可写处 → 按 peerDependencies 装依赖）与四档单测
docker run --rm -v "$PWD":/src:ro -w /tmp node:22-alpine sh -c '
  echo "E2 env:"; uname -s -m; node -v;
  mkdir -p /tmp/run && cp -R /src/src /src/package.json /tmp/run/ && cp -R /src/docs /tmp/run/docs && cd /tmp/run &&
  npm install --no-audit --no-fund --registry https://registry.npmmirror.com &&
  for f in B1-dsh-subagent-thincoder B2-dsh-subagent-thincoder-win32 B3-dsh-subagent-thincoder-platform-closeout B4-dsh-subagent-thincoder-launch-face; do
    echo "== $f =="; node --test docs/batches/$f.test.mjs 2>&1 | grep -E "^not ok|SKIP|^# (tests|pass|fail|skipped)";
  done'

# E4+E5 两条真 Linux 探针（POSIX 分支；卷的大小写语义与符号链接）
docker run --rm -v "$PWD":/src:ro -w /tmp node:22-alpine sh -c '
  mkdir -p /tmp/run && cp -R /src/src /src/package.json /tmp/run/ && cd /tmp/run &&
  npm install --no-audit --no-fund --registry https://registry.npmmirror.com &&
  node --input-type=module -e "
    const { resolveLaunchArgv, resolveChildArgv } = await import(\"/tmp/run/src/platform.mjs\");
    console.log(process.platform, JSON.stringify(await resolveLaunchArgv({ subprocess: {}, command: \"thincoder\", args: [\"acp\"], env: {} })));
    console.log(\"child\", JSON.stringify(await resolveChildArgv({}, { command: \"thincoder\", args: [\"acp\"], env: {} })));
  ";
  node --input-type=module -e "
    import { mkdtempSync, writeFileSync, symlinkSync, realpathSync } from \"node:fs\";
    import { tmpdir } from \"node:os\"; import { join } from \"node:path\";
    const d = mkdtempSync(join(tmpdir(), \"probe-\")); writeFileSync(join(d, \"WS\"), \"1\");
    const a = realpathSync.native(join(d, \"WS\")); let b;
    try { b = realpathSync.native(join(d, \"ws\")); } catch (e) { b = \"ENOENT:\" + e.code; }
    console.log(\"case-sensitive?\", a !== b, JSON.stringify([a, b]));
    symlinkSync(join(d, \"WS\"), join(d, \"link\")); console.log(\"symlink ok ->\", realpathSync.native(join(d, \"link\")) === a);
  "'
```

**期望读数表（B6 实测 · 2026-10-10 · 容器 `Linux aarch64` · `node v22.23.3`）**：

| 步骤 | 期望读数 | 判据 |
|---|---|---|
| E1 | 镜像就位（`Digest: sha256:0a7108bf6c7b…`，`docker.io/library/node:22-alpine`） | 取证前置成立 |
| E2 | 容器内 `uname -s -m` = `Linux aarch64`；`node -v` = `v22.23.3`（配方已含采集命令） | 真 Linux 内核（非注入、非模拟） |
| E3 · B1 | tests 32 / pass 32 / fail 0 / skipped 0 | 与 darwin 逐字相同 |
| E3 · B2 | tests 6 / pass 5 / fail 0 / skipped 1（skip = win32 专属面） | 与 darwin 逐字相同 |
| E3 · B3 | tests 10 / pass 9 / fail 0 / skipped 1（skip 文案 `this volume is case-sensitive — the stub-injection face carries AC-12`） | **与 darwin 差一格**：APFS 上该探针运行（10 pass）；Linux 卷大小写敏感 ⇒ 跳过（§6.2 矩阵第 1 行的不满足支路） |
| E3 · B4 | tests 7 / pass 7 / fail 0 / skipped 0 | 与 darwin 逐字相同 |
| E4 | `linux ["thincoder","acp"]` 与 `child ["thincoder","acp"]`（`subprocess` 传**空对象**仍成立 ⇒ seam 一次未被访问） | P9「非 Windows 启动形态不变」在**真 Linux** 上成立 |
| E5 | `case-sensitive? true ["/tmp/probe-…/WS","ENOENT:ENOENT"]` 与 `symlink ok -> true` | 卷为大小写敏感（同 `ext4` 这一面）；符号链接归一仍生效 —— **键面（「两条记录」）结论由既有桩注入单测承担**，本探针不直接观测 `linkKey`（§9.5 用例 56） |

> **逐格判据 vs 环境记录（钉死，响应评审 #3）**：**固定判据** = 四档的 `tests / pass / fail / skipped` 四个数，与两条探针的**结论**（E4 的 argv 形状；E5 的 `case-sensitive? true` 与 `symlink ok -> true`）；
> **本次环境记录（不作为跨机判据）** = 镜像 digest、`Linux aarch64`、`node v22.23.3`、E5 里的随机临时目录路径（比对时按 `^/tmp/probe-[^/]+/WS$` 这类形态匹配，不逐字比对）。
> 跨机复跑**只要求固定判据逐格相同**；若要复现同一环境，须按记录到的镜像 digest 与依赖版本重装 —— **本次未做依赖快照**（已知局限，如实登记）。

**降级口径（触发条件 + 处置 · 钉死）**：若无可用 Linux 宿主（容器运行时就位不了 / 镜像取不到 ⇒ E1 / E2 不成立），则：

1. **AC-18 判定为不满足**（不是「通过」）—— 本批不得声称「已在真 Linux 上跑过」。
2. **仍然可用**（但**不构成** AC-18 的满足）：AC-11（注入 POSIX 语义的单测）+ 既有模拟平台读数（preload 覆盖 `process.platform = 'linux'` 后 `tests 55 / pass 54 / fail 0 / skipped 1`）+ 源码走查。
3. **必须如实标注为「未在真 Linux 上跑过」的东西**：上表 E1–E5 的**全部格子**（含四档读数与两条探针）与 AC-18 **整条**；批次档 §5 / §6 与设计档 §8 同步标注。
4. **不得用「后续再补」代替处置**：若在这样的环境下收口，Linux 实证须作为一条**带触发条件的待办**入台账（触发条件 = 有可用的 Linux 宿主），由主 agent 登记 —— 而不是在文档里写一句「以后再验」。
5. 本批能否在此降级面收口，由用户在 §4 裁定。

**覆盖 / 不覆盖（钉死）**：本实证覆盖**本插件自己的代码面**（四档单测 + 两条平台探针）；
**不覆盖**「Linux 上 dsh 装载本插件 → 真 `thincoder acp` 委派成功」的宿主端到端（需 Linux 上的 dsh 安装与 thincoder 凭据，本机不具备），
也**不覆盖** dsh 宿主的原生依赖（容器内只跑本插件的单测，**不加载** `node-pty` / `koffi` 的 `linux-*` 预编译面）。两条缺口见 §10 与 §12.3-24。

### 5.11 后台委派契约（P11 · 钉死）

**门与解析（钉死）**：后台与否由**两级**决定，解析式逐字为 `args.run_in_background ?? readLiveLeaf(config.runInBackground)`
（`readLiveLeaf` 见 `src/config.mjs:72-76`）：

| 情形 | 取值 | 行为 |
|---|---|---|
| 参数给了 `true` / `false` | 显式值 | **恒胜**：`true` ⇒ 后台；`false` ⇒ 前景（逐字走既有链路） |
| 参数未给、叶为真 | `true`（默认） | 后台 |
| 参数未给、叶为假（含 `undefined`） | 假 | **前景**（零回归；冻结用例的 `config: {}` 即此支 —— §4.10 第 5 条） |

**`jobs` 软取且惰性（钉死）**：`jobs` **不进**硬注入面（`src/index.mjs:36` 四项不变）；取用点**只在后台分支内**：
`const jobs = ctx.get?.('jobs')`（可选调用 ⇒ 冻结用例的 `ctx` **没有** `get` 时也不抛）。三态：

| 情形 | 处置 |
|---|---|
| 后台 + `jobs` 在位 | 起 job，立即返回 job 号 |
| **显式** `run_in_background: true` + `jobs` 不在位 | **可读工具错误**（`errors.mjs#backgroundUnavailable`），**零进程**；不得静默阻塞调用方（P11 明文） |
| 默认路径 + `jobs` 不在位 | **退回前景**（零回归，P11 明文） |

**job 规格（钉死，逐字）**：`jobs.start({ kind: 'thincoder', label: args.description.trim(), owner: parent.id, run })` —— **不带 `outputLimitBytes`**（本插件不对读回设任何上限；裁决与理由见 §7-K43 与注①）。

- `kind` 取自定义名 `'thincoder'`：注册表把 kind 当**不透明的 id 命名空间**（`dsh-jobs/lib/types/view.d.ts:22-25` 明文），
  且已有插件自定 kind 的先例（`dsh-tool-workflow/lib/index.js:224` 用 `'workflow'`）；**无消费者按 kind 分支**（只渲染，`dsh-tool-jobs/lib/index.js:161` / `:165`）。
- `owner: parent.id`：owner 被释放时注册表取消并等待该 job（`dsh-jobs/lib/types/types.d.ts:117-128`）⇒ AC-19 的「owner 释放」终止路径。
- **不设 `outputLimitBytes`**（本插件不新增任何读回上限）：该字段是本插件**自造的唯一读回上限** —— 设了它，后台读回会被截断而**剩余文本无取回路径**
  （`JobRead.result` 只在结算后的**第一次**读取时交给模型，`dsh-jobs/lib/types/types.d.ts:156-157`）⇒ 后台因此**劣于**前景、直接违 P11（需求档 `:149-150`）；
  不设则读回与前景**同源**。答复体量交**宿主既有的工具结果处理**承担（§7-K43 注①）。
- `run(job)` **同步**返回 hooks（`dsh-jobs/lib/types/types.d.ts:148`）；返回值形状 = `{ cancel, done }`（`JobHooks`，同档 `:97-110`）。

**`run` 体（钉死）**：

```
run: (job) => {
  const controller = new AbortController()            // 自建：不沿用 exec.signal（§7-K40）
  const carrier = { sessionId: undefined }            // D4 载体盒（§5.2）
  let activation                                        // 启动期可能还没赋值
  return {
    cancel: () => {                                     // 同步返回（JobHooks 契约）
      controller.abort()
      void activation?.dispose().catch(() => {})        // 发布后 ⇒ 真停；启动期 ⇒ 只 abort（spec.signal 生效）
    },
    done: (async () => {                              // 本函数在后台继续跑；jobId 早已返回
      try {
        activation = await ctx.subagents.startActivation({
          provider: providerName,
          label: args.description.trim(),             // label 在 spec 顶层（B12）
          request: { …request, thincoderCarrier: carrier },   // 不带 label / signal
          signal: controller.signal,
          delivery: 'caller',                         // R1：自己结算
        })
      } catch (error) {
        return { status: 'failed', detail: jobFailureDetail(error) }  // 启动未完成（宿主已回滚；§5.2）
      }
      // 发布窗口补检（§5.3-B12 · 评审轮次1 号1）：abort 落在「宿主已过 throwIfAborted、收据尚未交回」时，
      // 不补这一下，取消就是一个没人听的信号——run 会白跑到结束
      if (controller.signal.aborted) void activation.dispose().catch(() => {})
      // 会话号先发布（§5.2 时序：收据返回时盒必已写）—— 执行期间就要能读回，不能等结算（轮次2 发现 1 的修正）
      const earlyId = carrier.sessionId
      if (typeof earlyId === 'string' && earlyId !== '') job.append(`[thincoder session] ${earlyId}`)
      // 统一清理口：先 result → dispose → 权威验盒 → 合并两项诊断（盒空不跳过清理）
      const settled = await settleActivation({ activation, carrier })
      return settled.outcome
    })(),
  }
}
```

- `done` **不得 reject**（`dsh-jobs/lib/types/types.d.ts:103-109` 明文），故启动期 reject 必须**就地 catch**；**不靠宿主兜** ——
  注册表的兜底把**原始错误串**塞进 `detail` 并打「producer contract violation」（`dsh-jobs-local/lib/index.js:473-477`）。
- `done` 的终值**直接取** `settleActivation(activation)` 的返回值 —— 它的**形状就是** `JobOutcome`；completed 分支已带 `result` = 最终答复文本。
  （B12 更正：0.2.1 已删 `settleRun`；映射表与「先 result 后 dispose」的顺序见 §5.3-B12。）
- **回报面等价（P11）**：会话号在**环**里（执行期间与结算后都可读回）；答复文本在 `JobOutcome.result` 里（结算后经 `job_output` 读回）。
  前景面的 `stopReason` 在后台面由 `(status, detail)` **可复原**：completed ⇔ `completed`（此时必有 `result`）；failed ⇒ `detail` 头段即 stopReason
  （`run-settlement.js:16-21` 的 `failureDetail`）；`aborted` 且无诊断 ⇒ `killed`（同档 `:34-37`）。
- **环内只一条 chunk（钉死）**：本插件**不**把子代理的过程流灌进环（P2 只取最终答复，§7-K44）⇒ 环的保留量与会话号可达性无关。

**返回面（钉死）**：`output.schema` 改**判别联合** `oneOf`，两分支逐字如下：

| 分支 | 形状 | 何时返回 |
|---|---|---|
| 前景 | `{ text, sessionId, stopReason, status }` + `additionalProperties: false`，**无 `kind`** | 走前景（显式 `false` / 降级 / 冻结形态） |
| 后台 | `{ kind: 'background', jobId }` + `additionalProperties: false` | 起 job 成功 |

- 判别成员用 `const`（官方同形，`dsh-tool-subagent/lib/index.js:437-481`）；工具输出**运行时校验**（`dsh-tools/lib/index.js:3543`）⇒ 声明与返回值必须严格对上。
- 前景分支**逐字**是现四键对象（`src/tools.mjs:114-124`）⇒ 冻结 `B1-…test.mjs:366-371` 的 `assert.deepEqual` 仍全等（§4.10 第 1 条）。
- `render` 分流：`value.kind === 'background'` ⇒ 后台块（`background job <jobId> started; read it with job_output`）；
  **其余一律**落前景块（冻结 `B1-…test.mjs:397-415` 直调且入参无 `kind` —— §4.10 第 2 条）。

**工具 `description` 与随仓发布 skill 的目标文案（D10 口径 · C-1 已裁定取 A ⇒ 写成默认推荐；落笔在实施批，本轮 `src/**` 零改动）**：

工具 `description` **追加三句**（英文 · 与现行句并存 —— 现行两句见 `src/tools.mjs:37-38`；末尾中文 fork 句不动）：

```js
// ① 后台为默认（P11）
'This call starts a background job and returns as soon as the job id is known, so the dsh session is not blocked while the subagent runs; read the answer with `job_output`.',
// ② 适用条件与三处例外（P11 门表）
'Background is the default. This call blocks only when the run goes to the foreground, in three cases: you pass `run_in_background: false`; this instance defaults to the foreground and you pass nothing; or the jobs service is unavailable — the default path then falls back to the foreground.',
// ③ C-1 的落点（新任务 ⇒ 显式 new: true）
'Start each new task with `new: true`; when you are continuing a task already delegated here, keep the default so its slot state (an approved design token, a review round) carries over.',
```

随仓发布 skill 的契约依赖清单（`docs/USER-SKILL-delegate-to-thincoder.md` §3）**目标句**（中文 · 可直接照抄）：

> **按任务工作流选会话**：同一条任务工作流（含「评审 → 令牌 → 实施」这类多步流程）的后续委派**不传会话参数**，默认接回同一槽、槽内状态随之续用；
> **新任务**首次委派显式传 `new: true` 起新会话。判据是**工作流的连续性**，不是对话轮次。插件看不到任务边界，这条靠调用方遵守。
> 另：委派**默认走后台 job**，工具立即返回 jobId，答复稍后用 `job_output` 读回；**阻塞仅三处** —— 显式 `run_in_background: false` / 本实例默认前台且参数缺省 / `jobs` 服务不可用（默认路径退前台）。再：后台 job 与 thincoder 进程内异步池是**两层**，外层不解除内层（内层异步子代理仍须在 prompt 返回前结算）。
> **落笔状态**：**已落到** `skills/delegate-to-thincoder/SKILL.md`。本节原句只列**一处**阻塞，与本档 `:794`（工具 `description`，**三处**）不一致 —— 已按 `:794` 的权威口径收正为**三处**（模型真正读到的契约面是工具 `description`）。

**三句的分工与共存**：① 说默认走后台；② 说**哪三处会阻塞**（显式 `run_in_background: false` ⇒ 前景内联返回；本实例配置为前台且参数缺省 ⇒ 前景内联返回 —— 模型看不到叶，故写成**实例面**；`jobs` 服务不可用 ⇒ 默认路径退前景）；③ 是一任务一会话的调用方约定。
三句都**只加话、不改话**，与现行句并存。

**新旧句如何共存、模型如何区分（判别判据 · 钉死）**：

| 情形 | 传参 | 判据 |
|---|---|---|
| 同一任务工作流的下一步（评审 / 令牌 / 实施…） | **不传**（默认续用） | 该槽里还压着这条工作流要用的状态（designToken / 评审轮次） |
| 本 dsh 会话里**没委派过**的新任务 | **`new: true`** | 新工作流的首步：与本会话已委派过的任何工作流都无承接 |
| 与既有工作流相关、但**另起一件**（如收口后另开一批） | **`new: true`** | 新批 = 新工作流；上一条工作流的状态不该带进来 |
| 指定既有某条会话 | **`sessionId`** | 与 `new` 互斥（现行句不变） |

**与现行句为何不冲突**：现行句说的是「默认接回本 dsh 会话 + 本工作区记录的那条槽，槽内状态随之续用」；
新句说的是**同一件事的续用支**，只**补上现行句没讲的另一半**（新任务 ⇒ 显式 `new: true`）。`new` 的默认值不动（C-2 取 A）
⇒ 现行句**逐字仍为真**、无需改写 —— 两处只加话、不改话。

**措辞面（已裁定 · 取 B · 2026-10-16）**：

- **裁定来源** = 用户原话（2026-10-16 · 父代理转达 · 逐字）：「行，可以用方案 B，如果没有别的疑问，就开实施吧」。
- **裁定结果**：取 **B** —— 工具 `description` 短面**不加**（仍为上段三句）；**再往 skill 补一句不对称提示**。
- **B 相对 A 的增量与理由（从属关系：B ⊇ A，二者不互斥）**：C-1 取 A（§12.4-25）= 工具 `description` 与 skill 明说「新任务传 `new: true`」；措辞面的 B = 在 A 之上**再**往 skill 补一条不对称提示，落点**只在 skill**，工具短面不加话 ⇒ 两处按同一编号 C-1 即可核对。理由：两种错的代价不对称 —— 误传 `new: true` 破的正是用户点名的「评审 → 令牌 → 实施」链路；漏传只是接回一条带旧上下文的槽（可发现、可重发）。
- **灰区仍是事实**（§7-K47）：「新任务」的边界由**模型**判、插件不可检 ⇒ 两例：① 同一 dsh 会话里「相关但另起一件」的委派；② 用户几轮对话推进一步的长流程（看着像几件事，实为同一工作流）。B 这句提示即该灰区的兜底口径。
- **要落到 skill 的不对称提示（逐字 · 落点 = `docs/USER-SKILL-delegate-to-thincoder.md` §3.1）**：
  > 拿不准就保留默认：误开新槽会丢槽内状态，接错槽可用 `new: true` 重发。
- **skill 实体 = 已落笔**（`skills/delegate-to-thincoder/SKILL.md`）。

**实施落地（钉死）**：`errors.mjs` 加两个导出 —— `backgroundUnavailable()`（后台不可用的可读错误）与
`jobFailureDetail(error)` = `'failed to start: ' + boundedText(describeError(error))`（复用既有 `boundedText` / `describeError`，`:74` / `:148`）：
错误文本的构造点仍**只**在 `src/errors.mjs`（§5.3 的既有口径）。

## 6. 逐行动作表

行号约定见开头。实现者按本表顺序落位即可。

| # | 动作 | 落点 | 预期结果 |
|---|---|---|---|
| A1 | 写包身份、`dsh.bundle.patch`、`exports`、peerDependencies | `package.json`（新） | `main`=`src/index.mjs`；`dsh.bundle.patch`=`./cordis.patch.yml` |
| A2 | 写装载行与默认配置（含 `permission: allow`） | `cordis.patch.yml#insert`（新） | `id`/`name` 均为 `dsh-subagent-thincoder` |
| B1 | 定义 `Config`（身份叶非 volatile、行为叶 `.volatile()`） | `src/config.mjs#Config`（新） | 字段与 §3.1 表逐行一致 |
| B2 | 导出 `readLiveLeaf(value)`（引用取 `get()`，否则原值） | `src/config.mjs#readLiveLeaf` | 引用形与普通值读取一致 |
| B3 | 导出 `resolveIdentity(config)`：装载期只解析身份叶 providerName/toolName/sessionToolName（行为叶装载期不解析） | `src/config.mjs#resolveIdentity` | 身份叶一次定值；行为叶由 driver 每次委派按次读取（`cwd` 空串转 `undefined`） |
| C1 | 定义 domain `subagent_thincoder`（version 1、layout single、表 `session_links`） | `src/session-store.mjs#domain` | 名字匹配 `UNIT_NAME_RE`（无连字符） |
| C2 | 定义记录 zod schema（四字段） | `src/session-store.mjs#linkRecord` | §5.6 字段逐字一致 |
| C3 | 导出 `linkKey(parentSessionId, cwd)`（NUL 分隔 + `resolve(cwd)`） | `src/session-store.mjs#linkKey` | 非空入参校验；空值抛错 |
| C4 | 导出 `openSessionStore(ctx)` → `{remember, lookup, close}` | `src/session-store.mjs#openSessionStore` | `remember` 走 `table.put`；`lookup` 走 `table.get`；`close` 幂等 |
| D1 | 导出 `acpStopReason(reason)` 映射表 | `src/stop-reason.mjs#acpStopReason` | `end_turn→completed`、`max_tokens→max-tokens`、`refusal→refusal`、`cancelled→aborted`、`max_turn_requests`/未知→`error` |
| E1 | 导出 `failureDiagnostic({stage,category,stopReason,outcome})` 固定安全文本 | `src/errors.mjs#failureDiagnostic` | 只含 provider/stage/category/stop reason/exit code |
| E2 | 导出 `permissionDiagnostic({policy,request,decision})` | `src/errors.mjs#permissionDiagnostic` | 不含 ACP 标题/选项原文 |
| E3 | 导出 `sessionError(kind, sessionId, serverText)`：建立失败可读错误 | `src/errors.mjs#sessionError` | 保留 thincoder 文本（`/项目不可解析/` 不得吞）并给 `new: true` 提示 |
| E4 | 导出 `boundedText(text, max=1024)`：折叠空白 + 截断 | `src/errors.mjs#boundedText` | 超长截断并标 `…`；`/项目不可解析/` 在消息头部，截断不丢锚句 |
| F1 | 导出 `spawnChild(ctx, spec)`：`ctx.subprocess.spawn` + 缺流校验 | `src/connection.mjs#spawnChild` | `stdio` = `{stdin:'pipe',stdout:'pipe',stderr:'inherit'}`；`graceMs` = 配置 |
| F2 | 导出 `connectChild(child, {permission, onText})`：ACP 客户端 + 通知/权限处理器 | `src/connection.mjs#connectChild` | 只折叠 `agent_message_chunk` 文本；权限按策略应答 |
| F3 | 导出 `disposeChild(child, eofGraceMs)`：EOF → terminate → waitForExit | `src/connection.mjs#disposeChild` | 与 `run.ts:193-213` 同阶梯；错误聚合抛出 |
| F4 | 导出 `closeSession(agent, sessionId)`：best-effort `session/close` | `src/connection.mjs#closeSession` | 失败不抛（记日志）；无会话号时空操作 |
| G1 | 导出 `startThincoderRun(request, spec)`：起子进程 + 连接 | `src/driver.mjs#startThincoderRun` | 见 §5.7 步骤 1-2 |
| G2 | 握手：`initialize{protocolVersion, clientCapabilities:{}}` | `src/driver.mjs#startThincoderRun.initialize` | 失败 ⇒ stage `initialize` |
| G3 | 会话选择（§5.5 四条判据） | `src/driver.mjs#resolveSessionTarget` | 互斥在工具层已拒；此处只分派 |
| G4 | `session/new` 分支：校验字符串 `sessionId` | `src/driver.mjs#establish.new` | 非字符串 ⇒ 协议错误 |
| G5 | `session/resume` 分支：沿用请求 id 为本次会话号 | `src/driver.mjs#establish.resume` | 应答无 id，不误读 |
| G6 | 建立失败 ⇒ 转 `sessionError`（保留 thincoder 文本）并 teardown | `src/driver.mjs#establish.failure` | 启动期拒绝（`start()` rejects），无半态 |
| G7 | 记录会话号（`store.remember`） | `src/driver.mjs#startThincoderRun.remember` | 仅成功建立后写；last-write-wins |
| G8 | 发布结果：`settleRunResult` + `subprocessRunHandle` | `src/driver.mjs#startThincoderRun.publish` | 发布后 result 永不 reject |
| G9 | 回带会话号 `thincoderSessionId`（§5.2） | `src/driver.mjs#startThincoderRun.publish` | 工具可读 |
| G10 | `teardown`：`closeSession` → `disposeChild` | `src/driver.mjs#startThincoderRun.teardown` | 顺序固定（§5.8） |
| G11 | `attempt`：`session/prompt` 与取消赛跑 | `src/driver.mjs#startThincoderRun.attempt` | stopReason 经 `acpStopReason` 映射 |
| G12 | 非 `end_turn` 时构造安全 `diagnostic` | `src/driver.mjs#startThincoderRun.attempt` | `terminalFailure` 同族；不含入参/环境/凭据 |
| G13 | 导出 `listWorkspaceSessions(request, spec)` | `src/driver.mjs#listWorkspaceSessions` | 返回 `SessionInfo[]`；空集合非错 |
| H1 | `createProvider(ctx, config, store)`：capabilities/inheritsParentContext | `src/provider.mjs#createProvider` | `NO_START_CAPABILITIES`；`inheritsParentContext=false` |
| H2 | `start(request)`：cwd 解析（`resolveChildCwd`） | `src/provider.mjs#start` | 无父 cwd 且无覆盖 ⇒ 可读错误，不起进程 |
| H3 | `start(request)`：读 `request.thincoderSession` 并调用 driver | `src/provider.mjs#start` | 缺省 = `{}`（默认续用） |
| I1 | `createDelegateTool(...)`：schema（§5.3）+ 互斥校验 | `src/tools.mjs#createDelegateTool` | 互斥失败 ⇒ 可读错误，无进程 |
| I2 | 委派执行：`ctx.subagents.start` → `settleRun` → 读 `run.thincoderSessionId` | `src/tools.mjs#execute` | 返回 `{text, sessionId, stopReason, status}` |
| I3 | `createSessionsTool(...)`：P7 只读工具 | `src/tools.mjs#createSessionsTool` | 参数为空；返回 `{sessions}` |
| J1 | 导出 `name` / `inject`（四项）/ `Config` | `src/index.mjs` | `node -e "import('./src/index.mjs')"` 可加载 |
| J2 | `apply(ctx, config)`：开 store + 注册 provider + 注册两工具 | `src/index.mjs#apply` | 缺注入项启动即失败 |
| K1 | 单元测试文件（十个变更面见 §6 清单） | `docs/batches/B1-dsh-subagent-thincoder.test.mjs` | `node --test` 全绿（桩/假件） |

K1 单元测试文件的十个变更面：config 身份叶解析与 `readLiveLeaf`；store 键与 schema；stopReason 映射；errors 文本边界；
工具参数互斥与返回文本；sessions 应答解析；provider cwd 解析与缺 cwd 报错；connection 断开阶梯与权限应答；driver 会话选择四判据；index 身份导出。

### 6.1 平台适配动作（B2）

| # | 动作 | 落点 | 预期结果 |
|---|---|---|---|
| L1 | 定义 `currentPlatform()`（全仓唯一 `process.platform` 读点） | `src/platform.mjs#currentPlatform`（新） | 直接返回 `process.platform` |
| L2 | 定义 `keyPath(path, platform)`：win32 折叠大小写，POSIX 原样 | `src/platform.mjs#keyPath`（新） | `C:\WS` 与 `c:\ws` 同值；POSIX 两侧不同值 |
| L3 | 定义 `isBatchTarget(path)`：扩展名小写比较 ∈ `{.cmd,.bat}` | `src/platform.mjs#isBatchTarget`（新） | `.CMD` / `.bat` 命中；`.exe` / 无扩展名不命中 |
| L4 | 定义 `resolveInterpreter(subprocess, env)`：候选 配置 `env.ComSpec` → 宿主 `process.env.ComSpec` → 字面 `'cmd.exe'`，各经 `resolveExecutable(candidate, env)` 取第一个命中者 | `src/platform.mjs#resolveInterpreter`（新） | 全不中 ⇒ 抛错（由 L5 转可读错误） |
| L5 | 定义 `resolveLaunchArgv({subprocess,command,args,env,platform})`：非 win32 原样；win32 解析 + 按扩展名分支（`call` 包装，§5.9 规则 1–4） | `src/platform.mjs#resolveLaunchArgv`（新） | 返回最终 argv |
| L6 | `linkKey` 加第三参 `platform`（默认 `currentPlatform()`），键路径走 `keyPath` | `src/session-store.mjs#linkKey` | 非空校验不变；POSIX 逐字不变 |
| L7 | 加 `launchError(command, detail)`：解析失败的可读工具错误 | `src/errors.mjs#launchError` | 含命令名 + `boundedText` 文本 + 修复提示；不含 env / 解析出的路径 |
| L8 | `spawnChild` 改收 `spec.argv`（不再自拼 `[spec.command, ...spec.args]`） | `src/connection.mjs#spawnChild` | 该模块**无平台知识**；缺流校验与 stdio 形态不变 |
| L9 | 起进程前解析 argv（委派面 + 枚举面各一处） | `src/provider.mjs#start`、`src/driver.mjs#listWorkspaceSessions`（枚举面的解析落在**默认 lister 内部**：真正起进程的是它；可注入的桩 lister 不起进程 ⇒ 不解析；父代理裁定 2026-10-07，见批次档 §1） | 解析失败 ⇒ 可读错误、**零进程** |
| L10 | 两处 `spawnChild` 调用改传 `argv`（spec 里去掉 command/args） | `src/driver.mjs#startThincoderRun`、`src/driver.mjs#listWorkspaceSessions` | spec 形状与 §5.9 一致 |
| L11 | B1 测试文件的两条 `linkKey` 用例注入平台 | `docs/batches/B1-dsh-subagent-thincoder.test.mjs:215-227` | Windows 上仍全绿（§4.2） |
| L12 | 依赖清单补 P10 口径（第 4 行键形态 + 变更记录一行） | `docs/USER-SKILL-delegate-to-thincoder.md` | 复述与 §5.6 一致 |
| L13 | win32 分支内置检出：配置 `args` 含元字符即抛可读错误（先于命令解析） | `src/platform.mjs#resolveLaunchArgv`（新） | 命中 ⇒ 抛与解析失败同族的可读错误、**零进程**；`(` / `)` 不在检出集；POSIX 不检（§5.9、§9.2 用例 21/28/29） |
| M1 | 新增本批单元测试文件 | `docs/batches/B2-dsh-subagent-thincoder-win32.test.mjs`（新） | `node --test` 全绿 |

M1 单元测试文件的七个变更面：

1. `platform.mjs` 的解析与包装规则（注入平台 + 桩 `subprocess`）：非 win32 返回 `[command, ...args]` 逐字；
   win32 下 `.cmd` 目标是逐元素断言 `['<interp>','/d','/s','/c','call','<abs target>', ...args]`；`.exe` 目标不加解释器层；
   解析失败 ⇒ 抛可读错误；解释器候选顺序（配置 `env.ComSpec` → 宿主 `process.env.ComSpec` → 字面 `'cmd.exe'`，各经同一解析面）。
2. `keyPath`：win32 折叠 / POSIX 原样（同一函数两个平台，两向断言）。
3. `linkKey` 注入平台：win32 两种大小写形态同键；POSIX 两种形态两键（AC-12）。
4. `errors.launchError`：文本含命令名与修复提示、经 `boundedText` 限长、不含 env 值与解析出的路径。
5. `connection.spawnChild`：桩 `subprocess.spawn` 断言收到的 `argv` 与 `stdio` / `graceMs` 原样透传。
6. 委派面与枚举面「解析失败 ⇒ 零进程」：桩 `subprocess.resolveExecutable` 抛错时，`ctx.subprocess.spawn` **一次都没被调用**。
7. cmd 元字符检出（§5.9）：win32 下含检出集字符的 `args` ⇒ `launchError` 同族可读错误，且 `subprocess.spawn` 零调用；POSIX 同参数逐字放行；`(` / `)` 不拒绝。

本批测试运行方式（验收前置）：在仓根跑 `node --test docs/batches/B2-dsh-subagent-thincoder-win32.test.mjs`（`node --test` 多个文件时逐个列）。
依赖解析前置：本仓 `node_modules` 必须指向 dsh 安装树的依赖（`.gitignore:1-3` 记录了 mac 侧的同义约定）。
本机（Windows）现状：`node_modules` **已就位** —— 由父代理于 2026-10-07 以 `mklink /J` 就地对 dsh 安装树建立
（此前为空仓，实测 `node --test` 报 `ERR_MODULE_NOT_FOUND '@deepseek-ai/schemastery'`）；建立后 B1 单测实测 **32/32 通过**。
空仓补链可用 `mklink /J node_modules "%USERPROFILE%\.dsh\profiles\node_modules"`（用环境变量，不写死盘符与用户目录）。详见 §12-8。

### 6.2 平台收口动作（B3）

| # | 动作 | 落点 | 预期结果 |
|---|---|---|---|
| N1 | 加 `canonicalPath(path)`：`realpathSync.native(path)`；**任何错误回退入参、不抛错**（本函数自身兜底；`linkKey` 侧另有对注入函数的兜底，见 N5） | `src/platform.mjs#canonicalPath`（新） | 存在的路径 ⇒ 真实路径（去符号链接 + on-disk 大小写）；不存在 / 不可解析 ⇒ 原值 |
| N2 | 加 `environmentValue(env, name, platform)`：精确大小写优先；未命中且平台为 win32 时按 `toUpperCase()` 全表找一次（镜像 dsh seam） | `src/platform.mjs#environmentValue`（新，模块私有） | win32 上 `COMSPEC` ≡ `ComSpec`；非 win32 逐字 |
| N3 | `resolveInterpreter(subprocess, env, platform)`：配置 / 宿主两个候选改经 `environmentValue` 读取 | `src/platform.mjs#resolveInterpreter` | 候选顺序（配置 → 宿主 → 字面 `'cmd.exe'`）不变 |
| N4 | `resolveLaunchArgv` 把 `platform` 透传给 `resolveInterpreter` | `src/platform.mjs#resolveLaunchArgv` | 仅传参；argv 规则（含 win32 包装与元字符检出）逐字不变 |
| N5 | `linkKey` 加第四参 `canonicalize`（默认 `canonicalPath`）；键 = `keyPath(canonicalize(resolve(cwd)), platform)`；入参校验仍在归一之前；**`canonicalize` 抛出的异常由 `linkKey` 捕获并回退**（运行时契约，§5.9） | `src/session-store.mjs#linkKey` | 归一结果只进键；记录与子进程的 cwd 保持原值；注入函数抛错 ⇒ 回退到已 `resolve` 的路径、**键构造不抛错** |
| N6 | 新增本批单元测试文件（十个变更面见下） | `docs/batches/B3-dsh-subagent-thincoder-platform-closeout.test.mjs`（新） | `node --test` 全绿 |
| N7 | 依赖清单第 4 行键形态改写 + §5 变更记录一行 | `docs/USER-SKILL-delegate-to-thincoder.md` | 复述与 §5.6 / §5.9 一致 |

N6 单元测试文件的十个变更面：

1. `canonicalPath`：真实存在的路径 ⇒ `realpathSync.native` 的真实路径（**自建夹具**：`mkdtemp` 建临时目录 + 内建目录 + 指向它的符号链接 ⇒ 链接路径被解析到目标；**不依赖 `/private/tmp`**）；不存在 ⇒ 原值；抛错面 ⇒ 原值且不抛（`/nonexistent-<uuid>`）。
2. `linkKey` 注入 `canonicalize` 桩：大小写不敏感语义 ⇒ 两种形态同一键；大小写敏感语义（恒等桩）⇒ 两个键（AC-12）。
3. 真实文件系统大小写探针（不注入、不桩，**条件运行**）：`mkdtemp` 临时目录上先运行时自检该卷的大小写语义（`realpathSync.native(大写形态) === realpathSync.native(原形态)`）；自检通过 ⇒ 两种大小写形态构造出**同一键**；自检不通过（大小写敏感卷）⇒ **跳过**并打印跳过原因（本项是加值面：AC-12 的必测面由第 2 项桩注入承担）。
4. 别名同键：桩把 `/tmp/ws` 映射到 `/private/tmp/ws`（**必测**）；另有真实夹具（`mkdtemp` 内自建目录 + 指向它的符号链接，**条件运行**）⇒ 同一键（AC-14 前半）。符号链接建不出（`EPERM` / `ENOSYS`，如 Windows 未开开发者模式）⇒ 跳过真实夹具、桩用例仍跑。
5. 回退不抛错（**必测**）：桩抛错 + 真实路径不存在 ⇒ 键 = 字符串归一结果且**不抛错**（`linkKey` 兜底）；默认函数的真实失败面（`/nonexistent-<uuid>`）同样回退；win32 注入时回退后**仍折**（AC-14 后半）。
6. 归一不改 cwd：记录里的 `cwd` 与 `session/new` 的 `cwd` = 委派工作区原值。
7. `resolveLaunchArgv` 的 win32 包装面**逐字不变**（重放 §9.2 用例 15–17 的断言形态，守住「本批没动 argv 面」= AC-11 不变）。
8. `environmentValue` / `resolveInterpreter`：win32 下 `{COMSPEC}` ≡ `{ComSpec}`；非 win32 反例；精确优先；候选顺序三态（AC-15）。
9. 零副作用：`linkKey` 入参非法 ⇒ 抛错，且 `canonicalize` 桩**一次未被调用**（校验先于归一）。
10. 冻结面共存守卫：断言 `/tmp/ws` 不存在（**前提检查、不参与跳过**；该前提若破，B1:218 会变色 ⇒ 指向 §12.1-13）。

本批测试运行方式（验收前置）：仓根跑 `node --test docs/batches/B3-dsh-subagent-thincoder-platform-closeout.test.mjs`；
交付前各跑一次两档冻结面 `node --test docs/batches/B1-dsh-subagent-thincoder.test.mjs` 与 `node --test docs/batches/B2-dsh-subagent-thincoder-win32.test.mjs`（全绿 = 共存前提成立的机械证据，非迭代节律）。
**「三档全绿」的口径**：B3 档的绿**含条件跳过** —— 带跳过判据的真实探针在本机满足判据时运行、不满足时记 skip（`node --test` 的 skip 不算失败）⇒ 三档全绿在任一支持平台上都可达，必测面不被绑到 macOS。

**平台支持矩阵与跳过判据（B3 真实文件系统探针）**

| 探针 | 需要的主机语义 | 满足 ⇒ 运行 | 不满足 ⇒ 跳过 |
|---|---|---|---|
| 大小写不敏感卷（测试面 3） | 临时目录所在卷上两种大小写形态解析到**同一真实路径** | 运行时自检通过 ⇒ 断言同一键 | 自检不通过（如 Linux 默认 `ext4`）⇒ 跳过并打印原因 |
| 符号链接夹具（测试面 1 / 4 的真实夹具） | 文件系统支持符号链接且进程有权创建 | `mkdtemp` 内自建符号链接被解析 ⇒ 断言同一键 | `fs.symlinkSync` 抛错（`EPERM` / `ENOSYS`）⇒ 跳过并打印原因 |
| 桩注入用例（测试面 2 / 4 的桩 / 5 / 8） | 无（纯内存） | **必测**，任何平台都运行 | 无跳过路径 |

主机对照（按语义、不按 OS 枚举）：macOS 默认 APFS 卷 ⇒ 两项真实探针均运行；Linux 默认 `ext4` ⇒ 大小写探针跳过、符号链接探针运行；Windows NTFS ⇒ 大小写探针运行、符号链接探针视权限。

**Linux 实测补充（B6 · 2026-10-10 · 容器 `overlayfs`，与 `ext4` 同属大小写敏感这一面）**：大小写探针**跳过**并打印原因、符号链接探针**运行并通过**
⇒ 上表第 1 行取「不满足 ⇒ 跳过」支路、第 2 行取「满足 ⇒ 运行」支路，与按语义的预判逐格相符；四档读数见 §5.10 期望读数表。
另：宿主 `node_modules` 是符号链接（指向 `/opt/…`，Docker 未共享）⇒ 容器内取证改为按 `package.json` 的 `peerDependencies` 自行安装（§5.10）。
依赖解析前置同 §6.1 末段（`node_modules` 已就位）。

### 6.3 启动面收敛动作（B4）

| # | 动作 | 落点 | 预期结果 |
|---|---|---|---|
| O1 | 加 `resolveChildArgv(subprocess, spec)`：行为叶 in → 最终 argv out；**只在此处调用** `resolveLaunchArgv` | `src/platform.mjs#resolveChildArgv`（新） | 两条面统一走它；`resolveLaunchArgv` 全仓**单一调用点** |
| O2 | `resolveLaunchArgv` 的 `platform` 形参加默认值 `currentPlatform()` | `src/platform.mjs#resolveLaunchArgv` | 调用点不再传平台；缺省 = 宿主平台；注入平台（B2 / B3 用例）逐字不变 |
| O3 | 目标解析结果加可用性守卫：非非空字符串 ⇒ `launchError` | `src/platform.mjs#resolveLaunchArgv`（win32 分支，`resolveExecutable` 之后、扩展名分支之前） | 与解释器候选面同口径（#24）；POSIX 面不受影响 |
| O4 | `start` 的解析块改一行调用 | `src/provider.mjs#start` | 传给 driver 的 spec 仍是 `argv`（冻结面，§4.6）；文档串改写成「解析走启动面单一来源」 |
| O5 | `listWorkspaceSessions` 的解析块改一行调用 | `src/driver.mjs#listWorkspaceSessions` | 与 O4 同一函数、同一入参形状 |
| O6 | 新增本批单元测试文件（六个面见下） | `docs/batches/B4-dsh-subagent-thincoder-launch-face.test.mjs`（新） | `node --test` 全绿 |

O6 单元测试文件的六个面：

1. **单一来源（结构机检）**：`src/**` 内 `resolveLaunchArgv(` 出现 2 次、`process.platform` 出现 1 次（用例 45）。
2. **委派面走单源**：桩 seam + 假 ACP 子进程，`provider.start` 交给 `spawn` 的 argv = façade 对同一行为叶的输出；并捕获 façade 实参的**行为叶键集合**（用例 43）。
3. **枚举面走单源**：`listWorkspaceSessions` 的同一断言（用例 44）—— 两例的**行为叶键集合相同**、argv 逐字相同。
4. **平台缺省**：不传 `platform` 的 `resolveLaunchArgv` 与显式传 `currentPlatform()` 逐字相同（用例 46）。
5. **#24 守卫**：win32 注入 + 解析面返回空串 / 非字符串 ⇒ `launchError` 同族、`spawn` 零调用（用例 47）。
6. **可达路径不变 + POSIX 反例**：`.exe` / 批处理目标逐字重放既有期望；POSIX + 同一「返回空串的解析面」⇒ 不探测、不抛错（用例 48 / 49）。

本批测试运行方式（验收前置）：仓根跑 `node --test docs/batches/B4-dsh-subagent-thincoder-launch-face.test.mjs`；
交付前各跑一次三档冻结面（B1 / B2 / B3 各 `node --test`），读数须与 §8 表逐格相同。
依赖解析前置同 §6.1 末段（`node_modules` 已就位）。

### 6.4 真 Linux 取证步骤（B6）

| # | 动作 | 落点 | 预期结果 |
|---|---|---|---|
| E1 | 确认容器运行时与镜像就位 | 宿主执行 `docker pull node:22-alpine`（命令原文见 §5.10） | 镜像就位（`Digest: sha256:0a7108bf…`） |
| E2 | 容器内准备：只读挂仓根 → 复制 `src` / `docs` / `package.json` → 按 `peerDependencies` 安装 | 容器内 `/tmp/run`（§5.10） | 安装完成、零报错；容器内 `node -v` = `v22.23.3` |
| E3 | 跑四档既有单测 | 容器内 `node --test docs/batches/<四档>.test.mjs` | 与 §5.10 期望读数表逐格相同（含 B3 的一处条件跳过） |
| E4 | 真 Linux 上的 POSIX 分支探针 | 容器内 `resolveLaunchArgv`（`subprocess` 传空对象）与 `resolveChildArgv` | 逐字 `["thincoder","acp"]`；不触 seam |
| E5 | 真 Linux 的卷语义探针 | 容器内 `mkdtemp` + 大写形态 + 符号链接 | 卷大小写敏感（与 P10 一致）；符号链接归一成立 |
| E6 | 读数入档 | 批次档 §5（实施记录） | 六个读数**+ 环境身份（内核 / 架构 / node 版本 / 镜像身份）**逐条落笔；**「未跑」时按 §5.10 降级口径如实标注** |

取证配方（命令原文）、期望读数表与降级口径**只在 §5.10** —— 本表只钉步骤与落点，不重复命令文本。
本批**不新增**测试文件 / 脚本 / CI 配置（§7-K33）；四档既有测试文件**一行不改**（§4.8）。

### 6.5 后台委派动作（B11）

| # | 动作 | 落点 | 预期结果 |
|---|---|---|---|
| P1 | `Config` 加行为叶 `runInBackground`（`z.boolean().default(true).volatile()`） | `src/config.mjs#Config` | 与 §3.1 表逐行一致；装载期不读 |
| P2 | 加 `backgroundUnavailable()` 与 `jobFailureDetail(error)` | `src/errors.mjs` | 可读、经 `boundedText` / `describeError`（`:74` / `:148`） |
| P3 | 参数面加 `run_in_background`（boolean，非必填） | `src/tools.mjs#createDelegateTool.parameters` | 与 §5.11 门表逐行一致 |
| P4 | 输出面改 `oneOf`：前景分支逐字四键、后台分支 `{kind:'background', jobId}` | `src/tools.mjs#createDelegateTool.output.schema` | 运行时校验通过；冻结 `B1:366-371` 仍绿 |
| P5 | `render` 加 `value.kind === 'background'` 分支 | `src/tools.mjs#createDelegateTool.output.render` | 其余入参落前景块；冻结 `B1:397-415` 仍绿 |
| P6 | 执行体：两级解析（显式恒胜）+ 三态降级 | `src/tools.mjs#execute` | 显式 `true` 无 `jobs` ⇒ 可读错误、零进程；默认路径无 `jobs` ⇒ 前景 |
| P7 | 后台分支：`ctx.get?.('jobs')` → `jobs.start(spec)` → **立即**返回 job 号 | `src/tools.mjs#execute` | 返回 `{kind:'background', jobId}`；不 await 终态 |
| P8 | `run(job)`：自建 `AbortController`；`cancel` = `abort()`；`kind` / `owner` 按 §5.11（**不设** `outputLimitBytes`） | `src/tools.mjs`（新私有函数 `startBackgroundDelegation`） | 同步返回 `{cancel, done}`；规格逐字 |
| P9 | `done`：`start` → 会话号 `job.append` → `settleRun` → `JobOutcome`；启动期 reject 就地 catch | 同 P8 落点 | `done` 不 reject；`completed` 带 `result` |
| P10 | `description` 补三句（后台默认 + 适用条件与两处例外 + 一任务一会话约定） | `src/tools.mjs#DELEGATE_DESCRIPTION` | D10 口径（§5.11 末段） |
| P11 | 新增本批单元测试文件（十个面见下） | `docs/batches/B11-dsh-subagent-thincoder-nonblocking.test.mjs`（新） | `node --test` 全绿 |

P11 单元测试文件的十个面：

1. **两级解析四态**：显式 `true` / 显式 `false` / 缺省 + 叶真 / 缺省 + 叶假（含冻结形态 `config: {}`）⇒ 逐态断言走哪条分支。
2. **显式恒胜**：叶 `false` + 显式 `true` ⇒ 后台；叶 `true` + 显式 `false` ⇒ 前景。
3. **冻结共存三条**（本批自己守，不改 B1）：前景返回值逐字四键；`render` 直调（无 `kind`）⇒ 前景块；`inject` 四项。
4. **立即返回**：桩 `jobs` registry ⇒ `execute` 在**子代理不结算**的情形下仍返回 `{kind:'background', jobId}`（桩 `subagents.start` 返回一个永不 settle 的 run）。
5. **job 规格**：捕获 `jobs.start` 实参 ⇒ `kind` / `label` / `owner` / `run` 逐字；`outputLimitBytes` **不出现**（键不存在 —— 本插件不设读回上限，§7-K43）。
6. **`run` 同步**：`run(job)` 的返回值同步可得（不是 Promise）；`cancel` 调两次不抛（幂等）；调用后交给 `subagents.start` 的 `signal` 已 `aborted`。
7. **`done` 三态**：桩假 run（`completed`）⇒ `{status:'completed', result:<文本>}` 且环内恰一条会话号 chunk；`error` / `refusal` ⇒ `{status:'failed', detail}`；`aborted` 无诊断 ⇒ `{status:'killed'}`。
8. **启动期 reject**：桩 `subagents.start` reject ⇒ `done` **resolve**（不 reject）、`status:'failed'`、`detail` 以固定前缀开头且长度有界（不是裸 `String(error)`）。
9. **降级三态**：显式 `true` + `ctx.get` 缺或返 `undefined` ⇒ 抛可读错误、`subagents.start` 与 `jobs.start` 均零调用；默认路径 + 无 `jobs` ⇒ 前景；`ctx` 无 `get` ⇒ 前景且**不抛**。
10. **零改动不变量（结构机检）**：`git diff --stat -- src/index.mjs src/driver.mjs` 输出为空；`inject` 仍四项。

本批测试运行方式（验收前置）：仓根跑 `node --test docs/batches/B11-dsh-subagent-thincoder-nonblocking.test.mjs`；
交付前各跑一次四档冻结面（B1 / B2 / B3 / B4 各 `node --test`），读数须与 §8 与 §5.10 期望读数表逐格相同。
依赖解析前置同 §6.1 末段（`node_modules` 已就位）。

## 7. 关键决策记录

| # | 决策 | 理由 / 被否替代 |
|---|---|---|
| K1 | 独立插件，不并包 `dsh-thincoder`、不改 dsh 核心与 `dsh-subagent-acp` | 边界要求；被否：patch / fork `subagent-acp`（改他人包，且它的握手就是本模块要修的断点） |
| K2 | 自持模型面工具，不复用 `dsh-tool-subagent` | P4 钉死 `sessionId`/`new` 参数，通用委派工具无此参数面；被否：挂通用工具（参数面不符） |
| K3 | 委派经 `ctx.subagents.start`，会话选择走私有字段 `thincoderSession` | `{...request}` 运行期透传（`deepseek-harness/packages/subagent/subagent/src/index.ts:569`）；不校验未知字段（同档 `:645-651` 只查五个已知能力）；被否：直连 driver（丢生命周期事件）、预写 store（丢连续性/竞态） |
| K4 | run 句柄回带 `thincoderSessionId` | `observeRun` 原样返回同一对象（`deepseek-harness/packages/subagent/subagent/src/lifecycle.ts:134`）；被否：事后 `session/list` 反查最新槽（脆弱、有竞态） |
| K5 | 复用 `@deepseek-ai/dsh-subagent` 的 out-of-process 助手；自持 ACP 线驱动与 stopReason 映射 | 共享助手是该 seam 契约的唯一实现（结果永不 reject、能力宣告、cwd 解析），复用即单源 |
| K6 | 结果折叠复用 `AssistantOutputFold`（`pushText`），只上抛最终答复文本 | 与 harness 自己的「最后一条非空 assistant 消息，否则累积流」选择规则同源 |
| K7 | 续用走 `session/resume`，不走 `session/load` | P3：load 会重放历史而不被消费 |
| K8 | 存储面用 `storageDomain`，domain 名 `subagent_thincoder`（下划线，非连字符） | `UNIT_NAME_RE` 不容连字符；不得复用 `thincoder`（domain 单开，已被 `dsh-thincoder` 长开） |
| K9 | 存储键含父会话维度：`parentSessionId + NUL + resolve(cwd)` | 避免跨 dsh 会话串槽；NUL 分隔是仓内先例 |
| K10 | 断开顺序 = 先 `session/close` 再 EOF/终止 | P5/AC-5：不释放认领会让下次接回被迫 fork |
| K11 | 槽不存在不自动回退，报可读错误；记录只在成功建立后重写 | 静默换新槽会静默丢失连续性（本模块要消除的失效面）；被否：默认回退新建 |
| K12 | P7 = 独立只读工具，不改 P4 参数面 | P4 参数面已钉死；被否：把枚举做成同一工具的动作参数 |
| K13 | 权限默认 `reject`（安全默认），装载行显式 `allow` | 沿用 `run.ts` 的安全默认；子代理要写文件，故部署显式放行；不向人上抛 |
| K14 | 工程前置失败：`start()` 发布前拒绝，工具错误必须携带 thincoder 的 `/项目不可解析/` 文本 | 用户裁定（2026-10-05）；P2 的固定安全形态用于**发布后**的 `diagnostic`，两者不同面 |
| K15 | 身份叶非 volatile、行为叶 volatile | 运行期改名须重挂载才能重注册目录；行为叶就地生效不打乱目录 |
| K16 | 不实现 `prepareContinuable`（不进 dsh 续用管理器） | 边界：该机制要求子代理在本进程内物化，跨进程 ACP 结构上进不去 |
| K17 | 平台差异收敛到 `src/platform.mjs` 一个模块 | 用户裁定（2026-10-07）：差异收敛一处，不让 win32 分支散落到 driver / provider / tools；分仓判据（独立部署 / 发布 / 生命周期）三条均不成立，故不分仓 |
| K18 | win32 命令解析复用 dsh 公开面 `ctx.subprocess.resolveExecutable`，不自研 PATH + PATHEXT 展开 | 公开且有文档例（`subprocess/README.md:44`）；解析环境与子进程同源（同一个 `childEnv` 规则）；被否：自写 PATHEXT 展开（第二份平台规则，且要从环境猜安装位置） |
| K19 | `.cmd` / `.bat` 经 `cmd.exe /d /s /c call <target> <args>` 启动 | 唯一在本机实测能同时覆盖「路径含空格」与「参数含空格」的形态；`call` 使 `/s` 的引号剥离永不触发（§5.9 实证）；被否：`/c` 直呼（路径含空格 + 任意参数会自毁，实测失败）、`node <cjs>`（硬编码安装路径，用户否决）、部署侧配 `command: cmd.exe`（用户否决的 B 案） |
| K20 | 解析发生在起进程之前（provider / 枚举工具），spec 传最终 argv | 原子性：解析失败 ⇒ 零进程、无半态；失败面天然可读（`start()` rejects / 枚举面走 `sessionError`）；被否：放进 `spawnChild`（要么 async 化并把可读文本丢进固定诊断，要么加错误标记分支） |
| K21 | 插件不自建 args 转义层；win32 下配置 `args` 含 cmd 元字符（`%` `&` `|` `<` `>` `^`）⇒ 起进程前拒绝并报可读错误 | 自建 `^` 转义实测不可靠（§12-6③）；一层自建转义会让两平台参数语义分叉；交解释器「照跑」= 语义静默变形，不如快速失败（用户裁定 2026-10-07）；被否：接受登记、自建转义层 |
| K22 | 解释器经同一解析面取（配置 `env.ComSpec` → 宿主 `process.env.ComSpec` → 字面 `'cmd.exe'`，见 §5.9 第 3 条），不硬编码 | 用户禁令：安装路径不进代码与默认配置；`ComSpec` 是平台自述位置、运行时读取、只作候选 |
| K23 | P10 键归一：`toLowerCase()`、只作用于键、平台可注入 | 与 thincoder 自身 `normalizeCwd(p).toLowerCase()` 同语义（同源判据）；`cwd` 原值不动（P10 明文）；注入平台使 AC-11 / AC-12 可单测 |
| K24 | 本批不新增配置叶 | 新增叶等于把自适应退回手工配置，与 P9「默认配置即可完成一次委派」相悖 |
| K25 | 键归一的判据改为**文件系统给的大小写语义**（`realpathSync.native`），规范化函数落在 `canonicalPath`，`keyPath` 只做 win32 折且逐字不改 | 判据要能覆盖 macOS APFS（实测 3 键 → 1 键）；冻结的 B2:111 把 `keyPath` 钉成纯字符串函数、B2:109/:110 钉死注入平台下的折与不折 ⇒ realpath 不能进 `keyPath`；回退分两层、键构造不抛错（§5.9）；被否：把 realpath 写进 `keyPath`（破 B2:111）、按平台枚举扩散（不覆盖 mac） |
| K26 | realpath 合并旧键不需要迁移：**不迁移、不扫描**；失效面 = 默认续用退化为新建槽 | 键归一是构造规则、不是数据迁移；大小写敏感 FS 上「两个大小写工作区」合法存在，扫描会误合并；实机现有记录 realpath 与原值相同（零影响）；救回路径已在（枚举工具 + 显式 `sessionId`）；被否：lookup 未命中时扫描同父会话记录（备选 B，§12.1-14） |
| K27 | 解释器候选读取镜像 dsh 的 `environmentValue`（精确优先 → win32 未命中再按大写全表找）；判定用**注入的 platform** 而非 `process.platform` | P9 明文：不得比所调用的 seam 更严（源码树 `.../subprocess-local/src/index.ts:333-338`）；注入值才能在 mac 上测 win32 语义（B2 先例）；被否：读 `process.platform`（不可测）、POSIX 也做不敏感读（`COMSPEC` 在 POSIX 是另一个变量） |
| K28 | 可测性靠 `linkKey` 第四参 `canonicalize`（函数型注入，默认 `canonicalPath`）；realpath 本身不可注入 | AC-12 要求两种语义均可测，而本机只有大小写不敏感的卷 ⇒ 桩函数能同时造出两种语义；位置参数（而非选项对象）是为了不破坏两档冻结用例的 `linkKey(id, cwd, 'linux')` 形态；真实文件系统探针是加值面、按主机语义条件运行（§6.2 平台支持矩阵）；被否：把 `platform` 参数改成语义枚举（破冻结档的实参） |
| K29 | 启动面收敛 = 「一个函数 + 一个调用形状」：`resolveChildArgv` 是唯一调用 `resolveLaunchArgv` 的地方，`platform` 默认值落在后者形参上 | 两条面各自构造解析入参 = 同一知识的两个副本 ⇒ 收敛后可机检；两面零平台知识（§4.7） |
| K30 | 收 #24：`resolveLaunchArgv` 的目标解析结果加非空字符串守卫（与解释器候选面同口径） | 与 K29 同面同一不变式（`argv[0]` 必为可用绝对路径）+ 成本 2 行；该路径经当前 seam 契约不可达（守卫非修缺陷，B3 §6） |

| K31 | 真 Linux 取证走**容器**（Docker Desktop + `node:22-alpine`），不走真机、不走 CI | 本机无 Linux 真机；仓内无 `.github`（无 CI runner）⇒ CI 配方**无从执行**，写一份从不运行的配置比不写更差（证据面为零、且不可机检）。容器在同一台机上给出真 Linux 内核 + 真实大小写敏感的卷，且一条命令可复跑（§5.10）。被否：真机（不可得）· CI（无 runner） |
| K32 | Linux **已在** P9 / P10 语义内 ⇒ **不新增需求句**；只为「真 Linux 宿主跑通」立一条**条件性验收** AC-18 | P9 的实现即 `platform.mjs:95` 的早退（真 Linux 实测逐字 `[command, ...args]`，§5.10-E4）；P10 的「文件系统大小写语义」覆盖 `ext4`（敏感 ⇒ 不折，§5.10-E5）⇒ 行为判据无需新增。缺的只是**判定面**：AC-10 只覆盖 Windows 真机、AC-11 是注入语义的单测。被否：并入 AC-11 的判定方式（两个判定面混进一条 AC） |
| K33 | 本批**不新增**测试文件 / 脚本 / CI 配置；「可复跑物」= §5.10 的取证配方 + 期望读数表 | `src/**` 零改动 ⇒ 没有新的变更面可配单测（P8 的单测随变更面走）；配方是一条**已实测可复跑**的命令，包成脚本会多一个无维护主体的构件、包成 CI 会多一份无 runner 的配置（K31）。被否：加 `scripts/*.sh` · 加 `.github/workflows/*.yml` |

> K29 / K30 的被否备选与详细理由：
> ① 把解析下移 `startThincoderRun` —— 在 win32 宿主改红冻结的 `B2:116` / `B3:110`（§4.6）；
> ② 两面各自展开 `{ subprocess, ...behaviour }` —— 省 9 行，但规则函数留两个调用点，「单一来源」只剩约定；
> ③ 给 driver 加「无 `command` 时回落 `spec.argv`」的条件分支 —— 静默回退，违 driver 规则 1；
> ④ #24 留池 —— 该口径不一致将无触发条件地永久留存（可单独回退，§12.2-18）；
> ⑤ 把 #24 扩大为「对 `args` 逐元素做类型校验」—— 越界，`resolveBehaviourSpec` 已收口。

> K5 复用的共享导出（`@deepseek-ai/dsh-subagent`）—— **B12 更正（0.2.1 实测）**：
> 现可用的 = `NO_START_CAPABILITIES`、`assertPositiveFinite`、`assertUsableCwd`、`AssistantOutputFold`、`settleRunResult`、`subprocessRunHandle`；
> **已删** = `resolveChildCwd` / `validateConfiguredCwd` / `settleRun` —— 本批改用自己实现的 `resolveConfiguredCwd` / `settleActivation`（K48–K50）。
> K5 被否替代：依赖 `@deepseek-ai/dsh-subagent-acp` —— 该包已安装在 `~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-subagent-acp/`（`0.2.0-rc.2`），但包根 `exports["."]` → `./lib/index.js` 只导出 `name`/`inject`/`Config`/`apply`，
> `acpStopReason`/`disposeAcpChild`/`startAcpRun` 不在导出面，复用不到线驱动；且其握手正是本模块要修的断点。

| K34 | 后台路径 = dsh 的 **one-shot 后台**（`ctx.jobs.start` + 普通 `ctx.subagents.start`） | 需求档 §3 边界明文；最近先例 `dsh-tool-subagent/lib/index.js:534-553`（同 spec 形状、同 `run()` 同步返回）；偏离 = 它另有 continuable 分支而本插件没有（续用由 P3 会话槽承担，ACP 跨进程进不去）；被否：`startContinuable`（结构上进不去） |

| K35 | 返回面用 `oneOf` 判别联合：前景分支逐字四键（**无** `kind`）、后台分支 `{kind:'background', jobId}` | 冻结 `B1:366-371` 钉死四键全等 ⇒ 不能加 `kind`；官方同形（`dsh-tool-subagent:437-481`，判别成员用 `const`）；`dsh-tools` 支持 `oneOf`（`lib/index.js:792`）+ 输出运行时校验（`:3543`）；被否：统一加 `kind`（改红冻结）· 拆两个工具（破 P4 参数面）· 宽 `json`（放弃校验） |
| K36 | `render` 以 `value.kind === 'background'` 分流，其余落前景 | 冻结 `B1:397-415` **直调** `render` 且入参无 `kind`；被否：按 `jobId` 是否存在判别（脆）· 把前景判定写成 `kind === 'foreground'`（改红冻结） |
| K37 | `jobs` 软取 + **惰性**（`ctx.get?.('jobs')`，只在后台分支内） | 冻结 `B1:695`（`inject` 四项）与 `:315-324`（`ctx` 无 `get`）；被否：加进硬注入面（改红冻结，且让「无 jobs」变成装载即失败，与 P11 软取相悖） |
| K38 | 降级口径：显式 `true` 无 `jobs` ⇒ 可读错误；默认路径无 `jobs` ⇒ 退回前景 | P11 明文两条；被否：一律退前景（显式请求被静默阻塞，正是用户实测的毛病）· 一律报错（默认路径从「能用」变「不能用」） |
| K39 | 叶 `runInBackground`（行为叶 · `.volatile()` · 默认 `true`）；解析式 `args.run_in_background ?? readLiveLeaf(config.runInBackground)`，显式恒胜 | 用户裁定 2 的口径；行为叶体例同 §3.1（每次委派读、**装载期不读**）—— 这正是 §4.10 第 5 条的前提；被否：身份叶（要重挂载才生效，与该叶用途不符） |
| K40 | job 的 `cancel` = 自建 `AbortController.abort()`（同步、幂等）；**不沿用** `exec.signal`；`owner = parent.id` | `exec.signal` 是**当前回合**的 step 信号（`dsh-agent-loop/lib/index.js:815-820` / `:1036-1040`）；`owner` ⇒ owner 释放时注册表取消并等该 job（`dsh-jobs/lib/types/types.d.ts:117-128`） |
| K41 | `done` 的终值**直接取** `settleRun(run)` 的返回值 | 它的返回类型**就是** `JobOutcome`（`dsh-subagent/lib/types/run-settlement.d.ts:16`），completed 分支已带 `result` = 最终答复文本（同包 `run-settlement.js:30-46`）；被否：自建折叠 + 映射（第二份实现，违 K6 单源） |
| K42 | 启动期 reject **就地 catch**，`detail` = 固定前缀 + 有界原因（`errors.mjs#jobFailureDetail`）；不靠宿主兜 | 宿主兜把**原始错误串**塞进 `detail` 并打「producer contract violation」（`dsh-jobs-local/lib/index.js:473-477`）；且 `done` 不得 reject（`dsh-jobs/lib/types/types.d.ts:103-109`） |
| K43 | **不设** `outputLimitBytes`（本插件不对读回设任何上限） | 裁决、理由与被否备选见下表后注① |
| K44 | 环内**只一条 chunk**（会话号），不把子代理过程流灌进环 | P2 只取最终答复；⇒ 后结算环保留量与会话号可达性无关，主会话也不被过程噪声干扰；被否：把 `onText` 增量灌进环（违 P2 + 把过程噪声带进主会话） |
| K45 | 并发沿用宿主 `maxConcurrentJobsPerOwner`（默认 10，`dsh-jobs-local/lib/types/index.d.ts:20-25`）：不新增判据、不新增叶；job 注册表纯内存登记为已知限制 | 用户裁定 5（「没必要调高」）；且 thincoder 子会话**不占**该并发 —— `dsh-jobs-local/lib/index.js:548-552` 只按 owner 数 `store` 里的 job（同档 `:363`） |
| K46 | **不设能力门**（不照抄 dsh 的「叶关掉后显式传 `true` 即抛错」分支） | 裁定 2 的复核更正：`dsh-tool-subagent/lib/index.js:355-360` 那个分支是**能力门**语义（「本实例不支持后台」），与用户口径（叶只改默认值）不是同一件事；同族旁证 = shell 工具的软取 + 降级（`dsh-tool-bash/lib/index.js:701`） |
| K47 | 「一任务一会话」= **调用方约定**（落工具 `description` + 随仓发布 skill 的契约依赖清单）；**不改** `new` 的默认值 | 插件没有任务边界的信号（参数面只有 `description` / `prompt`，`src/tools.mjs:94-113`），且翻默认会破 P3 本条与 AC-9；C-1 / C-2 均**已裁定取 A**（§12.4-25 / -26），目标文案见 §5.11 末段 |
| K48 | 会话号回带 = **插件私有载体盒** `request.thincoderCarrier`（独立字段，每次委派新建） | 见注④-1 |
| K49 | cwd **单一解析者 = 宿主**；`config.cwd` 保留为请求覆盖 | 见注④-2 |
| K50 | settle **自实现** `settleActivation` + 工具侧**必显式 `dispose()`** | 见注④-3 |
| K51 | 取消经 **`activation.dispose()`** 接线（前景步信号 / 后台 controller） | 见注④-4 |
| K52 | 冻结测试文件的改动面 = **B1 + B11 两份 `.test.mjs`**（逐行表 §4.12） | 见注④-5 |

> **注①（K43 的裁决、理由与被否备选 · 评审 round1 号 1 的裁决）**：**不设** —— 本插件**不自造**任何读回上限。
> **为什么**：`outputLimitBytes` 是本插件**唯一**的读回上限来源 —— 消费点 `finalizeJobContent`（`dsh-tool-jobs/lib/index.js:240-243`）在 `maxBytes === void 0` 时
> **直接返回 `void 0`**（不 bound）；而上限来源 `visibleOutputLimit`（同档 `:195-200`）**只**返回 `job.outputLimitBytes`（查不到 job 或字段未设 ⇒ `undefined`），
> `fitWithSuffix` / `fitCompletionNotice`（同档 `:147-149` / `:163-169`）在 `maxBytes === undefined` 时**原样返回完整文本** ⇒ **不设即不截断**。
> **设了会怎样**：读回被截断，而剩余文本**没有取回路径** —— `JobRead.result` 只在结算后的**第一次**读取时交给模型（`dsh-jobs/lib/types/types.d.ts:156-157`）
> ⇒ 后台**劣于**前景（前景无插件级截断），直接违 P11（需求档 `:149-150`：答复文本**等价可达**、不得因后台化丢失 P4 返回值）。
> **答复体量谁承担**：宿主的**工具结果处理**（与前景同源）；本插件不新增阈值 —— 与 §7-K45「不自造判据 / 不自造阈值叶」同精神。
> **被否**：**留一个固定读回上限**（后台劣于前景，破等价）· **把限值抬到环的 live 保留量级**（`retainBytes`）—— **任何固定上限都破等价**，只把截断的点推远；
> 且「多大的答复算正常」本插件无从判定（同 K45 的口径）。

> **K45 的已知限制（为何登记而不在本批治）**：`dsh-jobs-local` 是**纯内存**注册表（`lib/types/index.d.ts:38-39` 的类说明）⇒
> 进程重启后 job 号失效：模型手里的旧 jobId 读不到，**那一轮的答复文本也拿不回**。与 P3 **不冲突** ——
> 续用记录**是落盘的**，重启后仍能接回同一条 thincoder 槽（枚举工具 / 显式 `sessionId`）；丢的是那一轮的答复文本，不是会话连续性。
> 处置与登记请求见 §12.4-29。

> **注②（K34 的最近先例坐标 · 逐类补齐 · 评审 round1 号 3）**：
> ① **实现坐标**：one-shot 后台路径 = 官方 subagent 工具的 background 分支（`dsh-tool-subagent/lib/index.js:534-553`：同 spec 形状 `{kind,label,owner,run}`、同 `run()` 同步返回 `{cancel,done}`）；
> 自定 `kind` 的旁证 = `dsh-tool-workflow/lib/index.js:224`（用 `'workflow'`）。
> ② **本仓镜像章节**：后台契约 = §5.11；后台动作表与测试十面 = §6.5。
> ③ **先例批次 = 无**（显式声明）：本仓**没有任何批次**落过 job 面 —— B1–B10 的批次档内 `jobs.start` / `ctx.jobs` **零命中**（B1–B10 的变更面在 provider / 平台 / 启动面，见 §4.1–§4.8）⇒ 本批是该面的**首例**，无可引的批内先例。
> ④ **对齐 / 偏离**：对齐 = spec 形状与 `run()` 的同步返回（同 ①）；偏离 = 它另有一条 continuable 分支而本插件没有（本插件的续用由 P3 的会话槽承担，ACP 跨进程进不了那条路）。

> **注③（B12 的最近先例坐标 · 评审轮次 1 号 6 的补齐）**：
> ① **实现坐标**：0.2.1 的 provider 启动面 = `manager.startExternal`（`manager.ts:483-512`）→ 宿主 `startExternal: (name, request) => provider.start(request)`（`index.ts:214`）；
> 会话号回带的**反例** = 本仓 0.2.0 时代的 `{...handle, thincoderSessionId}`（已失效，`receipt()` 只回三键）；
> cwd 上收的**正例** = 宿主 `resolveDirectory`（`manager.ts:519-525`）；取消接线的**正例** = `subprocessRunHandle` 的 dispose 语义（`out-of-process.ts:198-215`）。
> ② **本仓镜像章节**：§5.2（载体盒）/ §5.3-B12（调用形态 · settle 映射 · 取消接线）/ §5.9-B12（cwd）/ §4.12（测试逐行）。
> ③ **先例批次**：部分有 —— B1（provider 契约与四键返回）/ B11（取消 + job 面）；**无先例**的部分显式声明：`startActivation` 调用形态、载体盒、`workingDirectory` 软取——**本仓首例**。
> ④ **对齐 / 偏离**：对齐 = provider 仍只实现 `start` + `capabilities` + `inheritsParentContext`（与 B1 同形）；
> **偏离（必须点名）** = ① `config.cwd` **保留为请求覆盖**，而内部升级说明的退役形式是「cwd 交给宿主、删插件侧解析」（需求档 §1 事实/委派正文转述）——
> 不照办的理由：P2 明写「可配置覆盖」，且部署 profile 已带 `cwd: ''`（退役会让现有配置变成未知叶）；
> ② 会话号回带改用**私有载体盒**（公共回带通道被 0.2.1 截断），这是一条**本仓自定**的私有约定，官方无对应先例。

> **注④（K48–K52 的完整理由与被否备选 · 为行宽自表内迁出，内容未删）**：
> **-1（K48）**：0.2.1 `receipt()` 只回三键（`manager.ts:1221-1227`）；`request` 到 provider 是**浅拷贝**（`manager.ts:497-501`）⇒ 盒引用同一对象，driver 写入即工具可见。
> 盒与 `thincoderSession` **并列而不合并** —— 合并会破 `B1:376` 的 `{}` 断言。
> 被否：A 槽号编码进 `run.id`（污染 childId / 日志面）、B 插件内 `Map<childId,sessionId>`（回收时机不可知）。
> **-2（K49）**：0.2.1 已把解析上收（`manager.ts:525`）；`''` 的语义 = 父会话**当前**目录，与旧 `header.cwd`（原始项目身份）**不等价**。
> 被否：退役该叶（削 P2 明文 + 现有 profile 配置变未知叶）· 插件继续自算（第二份平台/目录知识）。
> **-3（K50）**：0.2.1 已删 `settleRun`；`close()` 幂等（`manager.ts:781-786`）⇒ 与宿主自动 dispose（`manager.ts:972-978`）共享同一事务，不会双拆。
> teardown 失败**只**经 `dispose()` 的 rejection 可见（唯一口子）。
> **-4（K51）**：`startActivation` 之后调用方的 `signal` **不再**连到 run ⇒ 不接就是「取消只 abort 了个没人听的信号」（P11/AC-19 会静默失效）；
> 后台启动期 `activation` 未赋值 ⇒ 只 abort，靠 `spec.signal` 阻止建立；收据返回后的补检见 §5.3-B12。
> **-5（K52）**：两份档的假件直接模拟被换掉的 seam（`subagents.start` / `thincoderSessionId` / `resolveDelegationCwd` / 面 10 的 driver 零改动断言）—— 不改就红。
> **断言本体**（四键 / `{}` / render / inject）一字不改 ⇒ 冻结的契约语义未变；先例 = B2 改过 `B1…:218`。

## 8. 验收对照（P1–P12 ↔ AC-1..AC-21）

| 需求点 | 验收 | 怎么验（命令 / 可观测读数） |
|---|---|---|
| P1 | AC-1 | 按 §3.2 形态挂载后启动 dsh，日志无 loader 报错；`node -e "import('./src/index.mjs').then(m=>console.log(m.name,m.inject))"` 输出 `dsh-subagent-thincoder` 与四项注入 |
| P2 / P4 / P8 | AC-8 | `node --test docs/batches/B1-dsh-subagent-thincoder.test.mjs` 全绿（十个变更面见 §6 清单；桩/假件，不含真起进程的集成级） |
| P3 | AC-2 | 同 dsh 会话 + 同工作区连续两次调用 `subagent_thincoder`：两次返回的 `sessionId` 相同；该槽文件的 history 条数在第二次后继续增长（同一文件） |
| P3 | AC-3 | 第二次带 `new: true`：返回的 `sessionId` 与第一次不同 |
| P3 | AC-9 | 端到端一次：第一条会话内评审通过产出 designToken → 第二次委派接回同槽 → 该会话内令牌可用；以 thincoder 侧令牌台账（槽文件）存在且被接受为准 |
| P4 | AC-4 | 传入 AC-2 的 `sessionId`：返回同一 `sessionId` |
| P5 | AC-5 | 委派结束即刻再次接回同一槽：返回的 `sessionId` 仍相同；thincoder 日志为 `resumed as session <id> (no replay)`，无 `slot busy, forked to` 后缀（`handlers-slots.mjs:190`） |
| P6 | AC-6 | 在目标工作区放一份**非法工程档**，再接回工程模式会话：工具错误文本含 `/项目不可解析/`（按用户裁定，缺档不是拒载面） |
| P7 | AC-7 | 调用 `subagent_thincoder_sessions`：返回集合含 AC-2 的 `sessionId` |
| P9 | AC-10 | 在 Windows 上按扩展方式挂载后调用 `subagent_thincoder`，成功返回子代理答复，不出现 `ENOENT` / `EINVAL` 类启动失败；本机已过的等价读数：`cmd.exe /d /s /c call <node 安装目录>\thincoder.CMD --version` → 正常输出版本号、exit 0（§12-6） |
| P9 | AC-11 | 单测断言：POSIX（注入平台）解析结果 = `[command, ...args]` 逐字、无解释器包装；win32 语义由注入平台的用例覆盖（§9.2 用例 15–17） |
| P9 | AC-13 | win32 上配置的 `args` 含 cmd 元字符（`%` `&` `|` `<` `>` `^`）⇒ 起进程前拒绝、可读工具错误、零进程；POSIX 同参数逐字放行（单测：§9.2 用例 21/28/29） |
| P10 | AC-12 | 单测：大小写不敏感语义下两种形态构造出**同一键**；大小写敏感语义下仍是**两个键**（桩注入，**必测**）；另加一条真实文件系统探针（本机 APFS 真实目录两种形态 ⇒ 同一键；**条件运行**：卷的大小写语义运行时自检，不满足则跳过）（§9.3 用例 33–35） |
| P10 | AC-14 | 单测：符号链接别名（`/tmp/ws` ↔ `/private/tmp/ws` 类）构造出同一键（桩**必测** + `mkdtemp` 内自建符号链接的真实夹具，**条件运行**）；`realpath` 失败（路径不存在 / 不可解析）时回退为字符串归一结果且**不抛错**（`linkKey` 兜底捕获注入函数异常）（§9.3 用例 36–37） |
| P9 | AC-15 | 单测：win32 语义下 `{COMSPEC: …}` 与 `{ComSpec: …}` 取到**同一解释器**；候选顺序（配置 → 宿主 → 字面 `'cmd.exe'`）不变（§9.3 用例 39–40） |
| P9 · 台账 #25（启动面收敛） | AC-16（需求档 2026-10-08 已落） | 结构机检：`src/**` 内 `resolveLaunchArgv(` 出现 2 次（1 定义 + 1 调用）、`process.platform` 出现 1 次（B4 用例 45）；行为：委派面与枚举面**传入同一字段集合**（入参形状 = 行为叶三字段 `command` / `args` / `env`，来源均为该面行为叶），且同一行为叶下交给 `spawn` 的 argv 逐字相同（B4 用例 43 / 44） |
| P9 · 台账 #24（目标解析面校验） | AC-17（需求档 2026-10-08 已落） | win32 语义下解析面返回空串 / 非字符串 ⇒ `launchError` 同族可读错误、`spawn` 零调用（B4 用例 47）；POSIX 面逐字不受影响（用例 49） |
| P9 / P10（Linux 宿主面） | AC-18（需求档 2026-10-10 已落） | 在**可用的 Linux 宿主**上跑 §5.10 的四档读数与两条探针，逐格等于期望读数表 —— **条件性验收**：触发条件与不满足时的处置见下方 AC-18 注 |
| P11 / P5 | AC-19 | 后台委派三条终止触发皆释放槽认领：① 取消（`job_kill`）/ ② owner 释放 ⇒ abort 驱动 `cancel`，teardown 走「先 `session/close` 再收进程」（`src/driver.mjs:428-432`）—— **有单测面**（§6.5 面 6 / 7）+ 端到端（§9.6 用例 67）；③ **服务卸载**（`dsh-jobs-local/lib/index.js:418-426`）—— **只端到端**（§9.6 用例 69，无单测面）。终止后均可接回同槽、同号、无 fork 后缀 |
| P11 | AC-20 | 端到端：发起后台委派后、thincoder 仍在执行期间向主会话插入一条消息 ⇒ 该消息在**下一个步边界**被消费并得到回应；机制判据 = `inbox.claim` **无条件**先清空整条 `next-step`（`dsh-agent-loop/lib/index.js:104`）⇒ 不丢（**无单测面**：宿主循环不在本仓，缺口见 §12.4-30） |
| P12 | AC-21 | 隔离 profile 上装载并跑通一次委派（a1–a3 · b–e · f · g 逐项） | 判定面 = **需求档 AC-21 判定面块**（隔离 `DSH_HOME` / dsh 可执行路径 / 逐项断言）；**本轮 `unverified`**，实施末期由父代理执行 |
| P8 · AC-8 | 三档冻结读数不变 + 本批新面全绿 | `node --test docs/batches/B1-dsh-subagent-thincoder.test.mjs` = **32 pass / 0 fail**；`…B2-…win32.test.mjs` = **5 pass + 1 skip / 0 fail**；`…B3-…platform-closeout.test.mjs` = **10 pass / 0 fail**；`…B4-…launch-face.test.mjs` 全绿（六面见 §6.3） |

> **不在 B4 变更面的验收（显式区分）**：**AC-10**（Windows 端到端）与 **AC-1..AC-9**（B1 的九个功能面）本批一行不改；
> **AC-11**（非 win32 逐字原样、无解释器包装）与 **AC-13**（`args` 元字符检出）的规则行**逐字未动** ——
> B4 只加两处：`resolveLaunchArgv` 的「默认形参」与「目标可用性守卫」（§6.3-O2 / O3），并把调用点收成一个；
> ⇒ AC-11 仍由 B2 用例 15–17 与 B3 用例 [7] 覆盖，AC-13 仍由 B2 用例 21 / 28 / 29 覆盖；
> B4 用例 46 / 49 另钉「缺省平台 = 宿主平台」与「POSIX 面不探测」两条不变式。
>
> **AC-18（需求档 2026-10-10 已落）· 条件性验收（钉死）**：
> ① **判据**：在**可用的 Linux 宿主**（容器或真机）上执行 §5.10 的取证配方（E1–E5），四档读数与两条探针读数**逐格等于** §5.10 期望读数表。
> ② **触发条件**：存在可跑的 Linux 宿主 —— 即 §5.10 的 E1 / E2 成立（容器运行时就位、镜像可得）。
> ③ **不满足时的处置**：AC-18 判定为**不满足**（不是「通过」）；按 §5.10 降级口径处理（如实标注「未在真 Linux 上跑过」+ 台账登记触发条件），**不得**写成「已验证」、**不得**用「后续再补」代替处置。
> ④ **读数口径**：B1 / B2 / B4 与 darwin 逐字相同；**B3 在 Linux 上为 9 pass + 1 skip**（大小写探针按 §6.2 矩阵跳过）。
> 故本档 §8 表内 AC-8 行的 B3 读数 `10 pass` 是 **macOS APFS** 读数；Linux 侧以 §5.10 期望读数表为准。
>
> **B11 新增两行（AC-19 / AC-20）与「不在本批变更面」的口径**：AC-1..AC-18 一行不改；本批**不改**前景面的任何判据
> （`run_in_background: false` 时逐字走既有链路），也不改 §8 表内既有读数。AC-19 的①取消 / ②owner 释放有单测面（本批测试文件 · §6.5 面 6 / 7），③服务卸载同 AC-20 **只有端到端面**（§9.6 用例 69）；
> AC-20 **只有端到端面**（宿主步边界不在本仓单测面）—— 缺口如实登记（§12.4-30），**不得**用一条假单测充数。
>
> **B12 新增一行（AC-21）与复核口径（钉死）**：AC-1..AC-20 的**判据一行不改**；B12 只换宿主契约，故它们是**回归面**。实施末期的复核标记：
> - **AC-1 / AC-8** —— 隔离 profile 装载 + `B1` / `B12` 两份单测全绿（AC-8 的既有三档读数不变）；
> - **AC-2 / AC-3 / AC-4 / AC-5 / AC-7** —— 走 AC-21 的 **b / c / f / g** 四步（b 新槽 · c 默认续用同号 · **f 显式 `sessionId` 接回** · **g 枚举可见 + 槽文件消息增长**）；
>   其中 AC-4 / AC-5 / AC-7 的**判据面仍以各自既有证据为准**（本表上面三行），AC-21 只提供一次同环境的**旁证**，**不替代**（评审轮次 1 号 4 的收正：原句「已串起来」属过度声称）；
> - **AC-19 / AC-20** —— 判据不变，**本批只补证据**（B11 档的残余面仍记台账 #34，**不在本批结清**）；
> - **AC-6 / AC-9..AC-18** —— 本批不触（错误面 / 工程前置 / 平台面 / Linux 面均无改动）。

## 9. 用例表

### 9.1 委派与会话（B1）

| # | 类别 | 输入 | 预期输出 |
|---|---|---|---|
| 1 | 正常 | 首次委派（同会话+工作区无记录） | `session/new`；返回答复文本 + 新会话号；记录写入 |
| 2 | 正常 | 第二次默认委派（有记录） | `session/resume`；同一会话号；文本来自该槽 |
| 3 | 正常 | 显式 `sessionId` = 已存在槽 | 命中该槽；返回同一号 |
| 4 | 边界 | `new: true` | 新槽号 ≠ 旧 |
| 5 | 边界 | 委派结束即刻再委派（默认） | 同槽号（无残留认领，不被 fork） |
| 6 | 边界 | 同工作区并发两次默认委派 | 两路各自起进程、各自报告会话号；记录 last-write-wins，不互相阻塞 |
| 7 | 边界 | 父会话无 cwd 且 `cwd` 配置为空 | 可读错误，**不起进程** |
| 8 | 错误 | `sessionId` 与 `new` 同时给 | 可读错误（互斥），**不起进程** |
| 9 | 错误 | 显式 `sessionId` 不存在 | 可读错误（点明 id + 建议 `new: true` / 枚举），记录不被改写 |
| 10 | 错误 | 目标工作区工程档不可解析 + 接回工程会话 | 可读错误，文本含 `/项目不可解析/` |
| 11 | 错误 | thincoder 未配置凭据 | `AUTH_REQUIRED` 转可读错误 |
| 12 | 错误 | 子进程启动失败 | 固定安全诊断（`stage: process`、`category: process-start`） |
| 13 | 错误 | 委派中取消（`exec.signal` abort） | `stopReason: aborted`；teardown 仍尽力 `session/close` |
| 14 | 错误 | 提示阶段非 `end_turn` | 安全 `diagnostic`（stage/category/stop reason），不含入参/文件内容/环境/凭据 |

### 9.2 平台适配（B2 追加）

| # | 类别 | 输入 | 预期输出 |
|---|---|---|---|
| 15 | 正常 | win32 + 默认配置（`command: thincoder` 解析为 npm shim） | argv = `[<解释器绝对路径>, '/d', '/s', '/c', 'call', '<shim 绝对路径>', 'acp']` |
| 16 | 正常 | win32 + 目标是原生可执行文件（`.exe`，含用户配置的绝对路径） | argv = `[<绝对路径>, ...args]`，**无**解释器层 |
| 17 | 正常 | 非 win32（任一 POSIX 平台） | argv = `[command, ...args]` 逐字原样（不解析、不包装） |
| 18 | 边界 | win32 + 目标路径含空格（`…\Program Files\nodejs\thincoder.cmd`） | `call` 形态命中该路径（本机实测同形用例通过） |
| 19 | 边界 | win32 + 参数含空格（`a b`） | 子进程侧收到**一个**参数 `a b`（本机实测 `["a b"]`） |
| 20 | 边界 | win32 + 参数含尾部反斜杠 / 双引号 / 非 ASCII（`C:\dir with space\`、`a"b`、`中文 参数`） | 逐字往返（本机实测） |
| 21 | 错误 | win32 + 配置 `args` 含检出集任一字符（`%` `&` `|` `<` `>` `^`，逐字符各一例；如 `%PATH%`、`a&b`、`a|b`、`a<b`、`a>b`、`a^b`） | 可读工具错误（含命令 + 命中字符 + 修复提示），**零进程**（`subprocess.spawn` 与 `resolveExecutable` 均未被调用） |
| 22 | 错误 | win32 + 命令解析不到（不在 PATH、也不是可执行文件） | 可读工具错误（含配置里的命令 + 修复提示），**零进程** |
| 23 | 错误 | win32 + 解释器全部候选都解析不到（配置 `env.ComSpec` / 宿主 `process.env.ComSpec` / 字面 `'cmd.exe'` 逐条不中） | 可读工具错误，**零进程** |
| 24 | 错误 | `command` 里带参数（如 `thincoder acp`） | 整体当一个可执行名解析 ⇒ 解析失败 ⇒ 可读错误（参数面是 `args`） |
| 25 | 边界 | P10：win32 下 `C:\WS` 与 `c:\ws` | 同一键（命中同一条续用记录） |
| 26 | 边界 | P10：POSIX 注入 + `realpath` 不可解析的路径（如本机不存在的路径）两种大小写形态 | 两个键（回退面逐字；真实文件系统探针上的形态合一同 §9.3 用例 33–36，**条件运行**） |
| 27 | 边界 | P10：归一不改实际 cwd | 记录里的 `cwd` 与 `session/new` 的 `cwd` = 委派实际工作区原值 |
| 28 | 边界（反例） | POSIX（注入平台）+ 同一批参数（`a&b`、`%PATH%`、`a^b`） | `argv = [command, ...args]` **逐字原样**、**不拒绝** —— 同字符在 POSIX 是普通字符 |
| 29 | 边界（检出集外） | win32 + 参数含 `(` / `)`（`c(b)`） | 照常放行、逐字往返（`(` / `)` 不在检出集；含 `(x86)` 的目标路径同样放行） |
| 30 | 正常 | win32 + 配置 `env.ComSpec` 有值且可解析 | 解释器 = 该候选解析出的绝对路径（**优先于宿主值**） |
| 31 | 正常 | win32 + 配置 `env` 未给 `ComSpec`、宿主 `process.env.ComSpec` 有值 | 解释器 = 宿主值解析出的绝对路径（第二候选命中） |
| 32 | 边界 | win32 + 配置与宿主均无 `ComSpec` | 回落字面 `'cmd.exe'`，经同一解析面解析成绝对路径 |

### 9.3 平台收口（B3 追加）

| # | 类别 | 输入 | 预期输出 |
|---|---|---|---|
| 33 | 边界 | 大小写不敏感语义（注入 `canonicalize` 桩：把路径归一到真实形态） | `/x/WS` 与 `/x/ws` 构造出**同一键** |
| 34 | 边界（反例） | 大小写敏感语义（注入恒等 `canonicalize` 桩） | 两个**不同**的键 |
| 35 | 正常（条件运行） | 真实文件系统探针（不注入、不桩）：`mkdtemp` 建的真实临时目录，两种大小写形态各进一次；**运行前自检**该卷的大小写语义 | 自检通过 ⇒ 同一键（`realpath` 给出同一真实路径）；自检不通过 ⇒ **跳过**（加值面；AC-12 必测面由用例 33/34 桩注入承担） |
| 36 | 边界 | 符号链接别名：桩把 `/tmp/ws` 映射到 `/private/tmp/ws`；真实夹具 = `mkdtemp` 内自建目录 + 指向它的符号链接（**不依赖 `/private/tmp`**） | 两个入参 ⇒ 同一键；符号链接建不出（`EPERM` / `ENOSYS`）⇒ 跳过真实夹具、桩用例仍跑（AC-14 前半） |
| 37 | 错误（回退） | `canonicalize` 抛错（模拟不存在 / 不可解析；另有一条真实不存在的 `/nonexistent-<uuid>` 走默认函数） | `linkKey` 兜底 ⇒ **不抛错**；键 = `父会话 + NUL + resolve(cwd)`（平台非 win32）；注入 win32 时回退后**仍折** |
| 38 | 边界 | 归一不改 cwd：委派在真实目录（桩把该目录归一到另一形态） | 记录里的 `cwd` 与 `session/new` 的 `cwd` = **原值**（归一只进键） |
| 39 | 正常 | win32 注入 + 配置 `{COMSPEC: …}` | 解释器 = 该候选解析出的绝对路径，与 `{ComSpec: …}` **完全相同**（AC-15） |
| 40 | 正常 | win32 注入 + 三态：配置有值 / 仅宿主有值 / 两者皆无 | 候选顺序不变：配置 → 宿主 → 字面 `'cmd.exe'` |
| 41 | 边界（反例） | POSIX 注入 + 配置 `{COMSPEC: …}`（无 `ComSpec`） | **不**被采纳（逐字读）⇒ 宿主值 / 字面 `'cmd.exe'` 中标；守「只有 win32 不敏感」 |
| 42 | 边界 | win32 注入 + `{ComSpec: 'A', COMSPEC: 'B'}` | 取**精确大小写**命中的 `'A'`（与 dsh seam 同口径） |

### 9.4 启动面收敛（B4 追加）

| # | 类别 | 输入 | 预期输出 |
|---|---|---|---|
| 43 | 正常 | 宿主 POSIX + 委派面：`provider.start`（行为叶 `command` / `args: ['acp']`）+ 桩 seam + 假 ACP 子进程 | 交给 `spawn` 的 argv = `[command, 'acp']` 逐字；与 façade 对同一行为叶的输出逐字相同；捕获 façade 实参的**行为叶键集合** = `{command, args, env}` |
| 44 | 正常 | 宿主 POSIX + 枚举面：`listWorkspaceSessions`（spec 带同一行为叶） | 与用例 43 逐字相同的 argv（同一函数）；捕获的**行为叶键集合与用例 43 相同**（= 行为叶三字段 `command` / `args` / `env`）⇒ 同一入参形状 |
| 45 | 结构机检 | `src/**`（源码面） | `resolveLaunchArgv(` 出现 **2** 次（1 定义 + 1 调用）；`process.platform` 出现 **1** 次 |
| 46 | 正常 | 不传 `platform` 的 `resolveLaunchArgv`（宿主 POSIX） | 与显式传 `currentPlatform()` 逐字相同；argv = `[command, ...args]` 原样（缺省即宿主平台） |
| 47 | 错误 | win32 注入 + 解析面返回 `''` / 非字符串（`undefined`） | `launchError` 同族（含命令名）；`spawn` 零调用（守卫先于扩展名分支） |
| 48 | 边界 | win32 注入 + 合法性不受影响：`.exe` 目标 / 批处理目标 | 逐字重放既有期望（B2 用例 15 / B3 用例 [7] 的形态）⇒ 守卫不改可达路径 |
| 49 | 边界（反例） | POSIX 注入 + 同一「返回空串的解析面」 | 不探测（`resolveExecutable` 零调用）、不抛错；argv = `[command, ...args]` 逐字 ⇒ 守卫只在 win32 分支 |

### 9.5 真 Linux 实证（B6 追加 · 条件运行）

| # | 类别 | 输入 | 预期输出 |
|---|---|---|---|
| 50 | 正常（条件运行） | 容器 Linux（真内核）+ B1 单测 | tests 32 / pass 32 / fail 0 / skipped 0 |
| 51 | 正常（条件运行） | 容器 Linux + B2 单测 | tests 6 / pass 5 / fail 0 / skipped 1（skip 面为 win32 专属） |
| 52 | 边界（条件运行） | 容器 Linux（`overlayfs` / `ext4`，大小写敏感）+ B3 单测 | tests 10 / pass 9 / fail 0 / skipped 1（大小写探针跳过并打印原因 —— §6.2 矩阵第 1 行的不满足支路） |
| 53 | 正常（条件运行） | 容器 Linux + B4 单测 | tests 7 / pass 7 / fail 0 / skipped 0 |
| 54 | 正常 | 真 Linux + `resolveLaunchArgv({ subprocess: {}, command: 'thincoder', args: ['acp'], env: {} })` | `["thincoder","acp"]` 逐字；`subprocess` 一次未被访问（POSIX 分支不探测） |
| 55 | 正常 | 真 Linux + `resolveChildArgv({}, { command: 'thincoder', args: ['acp'], env: {} })` | `["thincoder","acp"]` 逐字（启动面单一来源在真 Linux 上成立） |
| 56 | 边界 | 真 Linux + `mkdtemp` 内建大写形态、再取小写形态 | **只证文件系统层面**：卷大小写敏感 ⇒ 小写形态 `ENOENT` ⇒ 与 §9.3 用例 [3] 的跳过支路逐格一致；**「两条记录」的键面结论由既有桩注入用例承担**（§9.3 用例 34 等），本探针**不直接观测 `linkKey`** |
| 57 | 边界 | 真 Linux + `mkdtemp` 内建符号链接指向目标 | 链接解析到目标（归一成立）⇒ 锚 §9.3 用例 [1] / [4] 的实跑 |

「条件运行」= 其前置是「有可用的 Linux 宿主」（§5.10 降级口径②）。无宿主时本表**整体不执行**，按 §5.10 降级口径**如实标注**（不是跳过、不是「以后再验」）。

### 9.6 后台委派（B11 追加）

| # | 类别 | 输入 | 预期输出 |
|---|---|---|---|
| 58 | 正常 | 缺省 + 叶 `true` + `jobs` 在位 | 返回 `{kind:'background', jobId}`；job 立即登记；主会话不阻塞 |
| 59 | 正常 | 叶 `true` + 显式 `run_in_background: false` | 前景：阻塞等待，返回逐字四键 |
| 60 | 正常 | 叶 `false` + 显式 `run_in_background: true` + `jobs` 在位 | 后台（**显式恒胜**） |
| 61 | 正常（后台链路） | 后台委派跑到终态 | 环内恰一条会话号 chunk；`done` → `{status:'completed', result:<答复文本>}`；随后 `job_output` 读回该文本 |
| 62 | 边界（端到端） | 后台委派**执行期间**向主会话插入一条消息 | 该消息在**下一个步边界**被消费并回应（AC-20）—— `claim` 无条件清空整条 `next-step`（`dsh-agent-loop/lib/index.js:104`）⇒ 不丢；**无单测面**（§12.4-30） |
| 63 | 边界 | 完成后 owner 空闲 / owner 忙 | 完成通知按 `completionDelivery`（默认 `wakeup`）：空闲 ⇒ `followup` 开新回合；忙 ⇒ `inject`（`dsh-tool-jobs/lib/index.js:283-295`） |
| 64 | 错误 | **显式** `run_in_background: true` + `jobs` 不在位 | 可读工具错误（`backgroundUnavailable`）；**零进程**、不静默阻塞调用方 |
| 65 | 边界（零回归） | 缺省 + `jobs` 不在位；或冻结形态 `ctx` 无 `get`（`config: {}`） | 退回前景，行为与既有用例逐字相同 |
| 66 | 错误 | 后台委派启动期 reject（如工程档不可解析 / 启动失败） | `done` **resolve** 为 `{status:'failed', detail:<固定前缀 + 有界原因>}`（不靠宿主兜） |
| 67 | 边界（终止路径） | 后台 job 被取消 / owner 释放 | abort 驱动既有 §5.8 阶梯（先 `session/close` 再收进程）⇒ 无残留认领（AC-19）；接回同槽仍同号 |
| 68 | 边界 | `stopReason: completed` 但答复为空 | `result` = `''`（`settleRun` 的 completed 分支）；读回空串不是错误 |
| 69 | 边界（终止路径 · 端到端） | **服务卸载**：后台委派在跑时卸载 jobs 服务（`ctx.effect` teardown ⇒ `disposeAll`，`dsh-jobs-local/lib/index.js:129` / `:418-426`） | job 转 `killed`、子进程被回收（「先 `session/close` 再收进程」）；接回同槽仍同号、无 fork 后缀（AC-19③）；**无单测面**（§12.4-30） |

本表共 **12 格**（58–69）。新增「后台形态的链路面」三格（正常 61、终止 67 / 69）与「不阻塞」的端到端面一格（62）；其余各格是**分类面**（降级 / 零回归 / 显式恒胜 / 空答复）。
**答复体量面不设格**：本插件不设读回上限（§7-K43）⇒ 无「超限读回」这一类预期输出可列。

### 9.7 宿主 seam 迁移（B12 追加）

| # | 类别 | 输入 | 预期输出 |
|---|---|---|---|
| 70 | 正常 | 工具执行（假 `startActivation` 写盒） | 返回四键；`spec.provider` / `spec.label` / `spec.delivery === 'caller'` 逐字；`request` **无** `label` / `signal` |
| 71 | 正常 | 盒已写 `'7'`；调 `activation.dispose()` 后再读盒 | 仍读到 `'7'`（盒在工具闭包里） |
| 72 | 错误 | `startActivation` resolve 但盒空 | 可读错误（「已建立但回带丢失」）；**不返回空串**；后台面 ⇒ `failed` 带同文本、不往环里写空 chunk |
| 73 | 错误 | `startActivation` reject | 原错误面（启动失败 / 工程前置 / 协议）——**不得**报成「回带丢失」 |
| 74 | 正常 | `stopReason = completed` | `{status:'completed', result:<text>}`；且**先 await result 再 dispose**（顺序断言） |
| 75 | 边界 | `aborted` 无诊断 / 有诊断 | `{status:'killed'}` / `{status:'failed', detail}` |
| 76 | 错误 | `dispose()` reject | `failed`，`detail` 以 `dispose failed: ` 结尾（不丢原 detail） |
| 77 | 边界（取消 · 前景） | `exec.signal` 在发布后 abort | `dispose()` **恰一次**；listener 在 `finally` 被移除（跑第二条用例不重入） |
| 78 | 边界（取消 · 后台） | 启动期 `cancel()` / 发布后 `cancel()` | 启动期 ⇒ 只 abort（不抛、无误回收）；发布后 ⇒ abort + `dispose()` 恰一次 |
| 79 | 正常（cwd） | `config.cwd` 非空（绝对）/ `''` | 前者 `request.cwd` = 该值；后者 `request` **无** `cwd` 键 |
| 80 | 错误（cwd） | `config.cwd` 为相对路径 / 不存在 | 起进程前可读错误；`startActivation` **零调用** |
| 81 | 边界（枚举 cwd） | `ctx: {}`（无 `workingDirectory`）/ 有服务 / 三路全空 | 回退 `parent.session.header.cwd` / 取服务值 / 可读错误 |
| 82 | 边界（并发 · 载体盒隔离） | 两次委派同时进行（两条假 `startActivation` 各自延时不同），分别写 `'A'` / `'B'` | 两条结果各自拿到自己的会话号（无串槽）；盒不跨调用共享 |
| 83 | 边界（取消 · 发布窗口 · 轮次1 号1） | 受控 Promise：`startActivation` 已进入等待、此时 `cancel()`、随后它才 resolve 交回收据 | 收据返回后**补检生效** ⇒ 该 activation 被 `dispose()`（恰一次）；`done` 有终态，不白跑到结束 |
| 84 | 错误（缺盒 + teardown 失败 · 轮次1 号2） | 盒空 **且** `dispose()` reject（前景 / 后台各一次） | 前台抛 `carrierLost` 之前**已完成 dispose**；后台 `failed` 的 detail 同时含回带丢失与 `dispose failed: …` 两段 |
| 85 | 错误（前景失败面 · D4 裁定） | 前景：`stopReason: 'error'`（带诊断）/ `dispose()` reject / `stopReason: 'aborted'` 三种 | 前两种 ⇒ **抛** `delegationFailed(detail)`（detail 进异常文本，dispose 在我之前已完成）；`aborted` = 用户取消 ⇒ 仍返四键 `status: 'killed'` |

## 10. 边界（本模块不做什么）

- 不改 dsh 核心，不改 `@deepseek-ai/dsh-subagent-acp` 包；不写 thincoder 仓库任何文件。
- 不接入 dsh 的「可续用子代理」机制（`startContinuable` / `send_message` / 冷启动恢复）：那条路要求子代理在**本进程内**物化为真 Agent，跨进程 ACP 子代理结构上进不去。
- 不做长驻子进程：不维持跨多次委派的常驻 `thincoder acp` 进程（本批按「每次起进程 + 接回旧槽」交付）。
- 不消费 `session/load` 的历史重放；不向 dsh 前端上抛思考 / 工具调用 / 子代理事件。
- 不自研模型路由与权限策略：只提供 permission 的 `allow` / `reject` 两档。
- 不修改用户 profile（`~/.dsh/profiles/**`）；替换后的挂载形态只写进本设计档。
- **skill 正文在仓内、不随 npm 包发布**：模型面的用法说明真源 = `skills/delegate-to-thincoder/SKILL.md`，
  安装时复制到 `$DSH_HOME/skills/`（`package.json` 的 `files` 只含 `src` 与 `cordis.patch.yml`）。
  本模块的行为契约与它存在依赖关系 —— 改 §5.3 / §5.5 / §5.6 / §5.9 / §12-3 等契约时须同步该 skill；
  依赖清单见 `docs/USER-SKILL-delegate-to-thincoder.md`。
- **不加自建参数转义层、不改参数语义**：插件不解析、不重写 `args`；win32 上含 cmd 元字符（`%` `&` `|` `<` `>` `^`）的 `args` 在**起进程前拒绝**（§5.9），其余平台与其余参数逐字原样 —— 不扩参数面、不做转义（§7-K21）。
- **不动两个宽限的默认值**：包装形态不新增进程层（§5.9），`disposeEofGraceMs` / `disposeGraceMs` 的语义与 B1 相同。
- **不按平台分仓、不碰 dsh 上游**：dsh 的 `resolveExecutable`（按 PATHEXT）与它的启动路径（只认 `.com` / `.exe`）不一致，**只报不动**（§12-11）。
- **不做旧记录迁移**（B3）：不给续用记录做一次性迁移，也不在 lookup 未命中时扫描表内记录；键的归一只是构造规则（§5.9 三问③、§7-K26）。
- **不改冻结面**（B3）：`docs/batches/B1-*` 与 `docs/batches/B2-*`（含两档 `.test.mjs`）一字不改；也不为迁就它们而缩小 P10 的归一范围（前提与上抛见 §4.4、§12.1-13）。
- **不新增配置叶、不扩参数面**（B3）：键归一与解释器候选读取都不引入新的配置开口（`ComSpec` 仍只作候选、仍走同一解析面）。
- **不把启动解析搬进 `src/tools.mjs`**（B4）：枚举面的 lister 是可注入依赖，B1 的两条 sessions 用例以 `ctx: {}` 构造（D-1）；
  解析留在默认 lister 内部（§4.6）。也不给 driver 加「无 `command` 时回落 `spec.argv`」的静默回落分支（§7-K29 被否③）。
- **不为收敛而改冻结面**（B4）：委派面 spec 的 `argv` 与键面的平台默认参都不动（§4.6 / §4.7-②）；
  要连这两项一并统一，须先解冻 B2 / B3 测试文件（上抛 §12.2-20 / 21）。
- **不在真 Linux 上跑宿主端到端**（B6）：本批的 Linux 实证面 = **本插件自己的代码面**（四档单测 + 两条平台探针，§5.10）；
  **不含**「Linux 上 dsh 装载本插件 → 真 `thincoder acp` 委派成功」的端到端（需 Linux 上的 dsh 安装与 thincoder 凭据，本机不具备）。
- **不覆盖 dsh 宿主的原生依赖面**（B6）：容器内只跑本插件的单测，**不加载** `node-pty` / `koffi` 的 `linux-*` 预编译面 ⇒
  本批实证不构成对那些原生模块的 Linux 验证（缺口登记见 §12.3-24）。
- **不为取证改产品代码、不改冻结面**（B6）：`src/**` 零改动（Linux 走既有分支，无缺失实现）；
  取证把仓根**只读**挂进容器、在容器内**复制**一份跑，B1–B5 各档（含四档 `.test.mjs`）一行不改（§4.8）。
- **不新增测试文件 / 脚本 / CI 配置**（B6）：可复跑物 = §5.10 的取证配方 + 期望读数表（§7-K33）。
- **不做 job 持久化**（B11）：job 注册表是宿主的**纯内存**表（`dsh-jobs-local/lib/types/index.d.ts:38-39`）⇒ 进程重启后 job 号失效；
  本批不为它加持久化（缺口的处置与登记请求见 §12.4-29）。
- **不把子代理过程流灌进环**（B11）：环内只有一条会话号 chunk（P2 只取最终答复，§7-K44）。
- **不改后台的执行形态**（B11）：后台 job 仍是「**一次委派 = 一个子进程**」（与 P2 相同），不做长驻、不复用进程。
- **不给叶加能力门、不新增并发阈值**（B11）：叶只决定默认值（§7-K39 / K46）；并发沿用宿主 `maxConcurrentJobsPerOwner`（§7-K45）。
- **不动 `inject`、不动线驱动**（B11）：`src/index.mjs` 的四项注入与 `src/driver.mjs` 逐字未动（§4.9 第 4 / 5 行、§6.5 面 10 机检）——
  后台分支复用的是**同一条** `startThincoderRun` 路径，不另立第二条委派实现。
- **不改冻结面、不改需求档**（B11）：B1–B10（含四档 `.test.mjs`）一字不改（§4.10）；P11 / AC-19 / AC-20 由主 agent 落在需求档，本档只同步。
- **`new` 的默认值保持 `false`**（B11）：C-2 已裁定取 A（§12.4-26）；本批只落**措辞**（C-1 取 A，§5.11 末段），默认值本身与参数面不动。
- **不自算 cwd**（B12）：provider 不读 `parent.session.header.cwd`、不调 `workingDirectory.ensure`（那是宿主侧）；cwd 只从 `request.cwd` 取。
- **不用 `run.id` 承载私有数据**（B12）：`childId` 仍为 `randomUUID()`；槽号只走 `thincoderCarrier`（不进 childId / 目录 / 日志 / 诊断）。
- **不保留旧 seam 分支**（B12）：**单版本支持**（R2）—— 不写 `resolveChildCwd` / `settleRun` 的兼容探测或运行时回退（那些导出已不存在，写探测只会把「装错版本」变成更难查的降级）。
- **不接管宿主的目录服务**（B12）：插件不调 `workingDirectory.ensure` / `set`；`get(session)` 只在枚举面**软取**读取。

## 11. UI / 交互决策

本模块**无 UI 面**。唯一的用户可见面是模型面工具的参数与返回文本；其形状已在 §5.3 / §5.4 钉死（返回必含一行本次会话号）。**无 `open` 项**。

B2 不改这条面：平台适配**不新增配置叶**、不改参数与返回形状（§3.1 / §5.9），故仍**无 `open` 项**。

B3 同样不改这条面：键归一与解释器候选读取都不新增配置叶、不改工具参数与返回形状（§3.1 / §5.9）⇒ 仍**无 `open` 项**。

B4 仍不改这条面：启动面收敛与 #24 守卫都不新增配置叶、不改工具参数与返回形状（§3.1 / §5.9）⇒ 仍**无 `open` 项**。

B6 同样不改这条面：Linux 收口不新增配置叶、不改工具参数与返回形状（本批 `src/**` 零改动）⇒ 仍**无 `open` 项**。

B11 仍不改这条面：新增的是**一行行为叶**（`runInBackground`，§3.1）与**一个参数**（`run_in_background`，§5.11），
返回面多出**一种形态**（后台形态，形状已钉死）。本插件的配置面仍是 profile / `cordis.patch.yml`（§3.2，无 UI 面，本节首段）——
该叶与既有八个行为叶同属这一面，其默认值写进 §3.1 与装载行注释即可 ⇒ 工具 `description` 的参数与返回形状本身仍**无 `open` 项**。

措辞面那条待裁项（「新任务」边界由模型判、插件不可检）**已裁定 · 取 B**，落点与目标句见 §5.11 末段。

B12 **仍不改这条面**：无新配置叶、无新参数、返回形状不变（四键 / 后台形态）⇒ 仍**无 `open` 项**；
唯一可感知的变化是 cwd 语义（子代理跟父会话**当前**目录）与相对路径被拒 —— 两者都写进 §3.1 与 §5.9-B12，属确定的契约变更，不是待裁项。

## 12. 上抛项与探索发现

| # | 类别 | 内容 | 处置 |
|---|---|---|---|
| 1 | 需求与现实冲突 | P6/AC-6 原写「无工程清单 ⇒ 拒载」不可复现：thincoder 缺档就地建档后照常接回（`manifest.mjs:217-244`）；真实拒载面 = invalid/ambiguous/init-failed | 用户裁定（2026-10-05）修订 P6/AC-6；本档按裁定写（§5.5） |
| 2 | 环境发现（非阻断） | profile 挂载的 `@deepseek-ai/dsh-subagent-acp` **已安装**（`0.2.0-rc.2`），但包根 `exports["."]` → `./lib/index.js` 只导出 `name`/`inject`/`Config`/`apply`，复用不到线驱动（§7-K5） | 上报；本批设计不引用该包（§3.2） |
| 3 | 协议面限制（非阻断） | `session/resume` 应答无会话号；槽被另一活进程占用时 thincoder 会**静默 fork 到新槽**（`handlers-slots.mjs:170-187`），插件观测不到 | 上报。会话号回报口径见 §5.5；AC-2/AC-5/AC-9 为单路场景，不受影响 |
| 4 | 命名约束（设计约束，非缺陷） | `UNIT_NAME_RE=/^[a-z][a-z0-9_]*$/` 不容连字符，domain 名取 `subagent_thincoder` | 已写入 §5.6 / §7-K8 |
| 5 | 需求档依赖面待补一行（**笔在主 agent**） | 需求档 §3 要求「平台适配只用 dsh 的公开能力（用到哪些在 §5 依赖里列明）」，而 §5 只列了 `subprocess` 服务名；本批实际用到 `ctx.subprocess.resolveExecutable`（`subprocess/src/index.ts:133`，`README.md:44` 有例） | 上报；**不阻塞本批**（§5.9 已写明用的是哪一面） |
| 6 | 探针实证（本机 2026-10-07；脚本留在仓内临时区 `.thincoder/tmp/b2-probe/`，不进 git） | ① 无 `call` 时「含空格路径 + 参数」失败；② 有 `call` 时同形态成功且参数逐字（`["a b"]`）；③ 自建 `^` 转义不可靠；④ 包装命令在 piped stdin 上 EOF 后 1111ms exit 0；⑤ `thincoder` → `C:\nvm4w\nodejs\thincoder.CMD` | 逐条读数见 §5.9；③ 是 §7-K21 的被否依据 |
| 7 | args 面的 cmd 元字符处置（**用户裁定 2026-10-07：取备选 B**） | win32 上「无需加引号」的参数会被 cmd 自己解释：`%` 展开 · `&` `|` `<` `>` 分隔 · `^` 被吞；自建 `^` 转义实测不可靠（§12-6③）⇒ 不自建转义层。`(` / `)` 实测无害，不在检出集 | **已按用户裁定取 B**：win32 下配置 `args` 含这六个字符 ⇒ 起进程前拒绝、可读错误、零进程（§5.9 · §7-K21 · §9.2 用例 21/28/29） |
| 8 | 任务书事实已失效（非阻断）：任务书称「本仓无 `node_modules` ⇒ `node --test` 因 `ERR_MODULE_NOT_FOUND '@deepseek-ai/schemastery'` 失败」 | 该断点在写任务书时成立；**父代理于 2026-10-07（本批设计在飞期间）就地建立 `node_modules` 联接**，故设计者读到的现状已是「已就位」。B1 单测实测 **32/32 通过** ⇒ 「Windows 上跑单测」无前置障碍；空仓补链做法见 §6.1 末段 | 已裁定（父代理）：起因是父侧环境变更，非设计者误判；事实已据实更正 |
| 9 | 边界（非阻断）：`.ps1` 不在包装面 | 包装只认 `.cmd` / `.bat`；若部署把 `command` 配成 `.ps1`（npm shim 也带一份），仍按原样交给 dsh ⇒ 落到既有启动失败面（固定安全诊断）。P9 只点名 `.cmd`/`.bat`，本批不扩 | 上报，不动作 |
| 10 | 非阻断：两侧解析器的基准不同 | `resolveExecutable` 把 PATH 里的**相对项**按**服务进程** cwd 展开（`subprocess-local/src/index.ts:173-180`），而 win32 启动路径按**子进程** cwd 搜索（`runner-launch.ts:252-282` 收 `cwd`）。PATH 含相对项属罕见配置 | 上报，不动作（本批不改 dsh） |
| 11 | 上游解析器不一致（非阻断，**用户已裁定只报不动**） | `resolveExecutable` 按 PATH + PATHEXT（含 `.CMD`）展开，而 win32 启动路径只探 `.com` / `.exe`（`runner-launch.ts:231-240`）—— 同一个 dsh 里两个解析器口径不同。本批靠插件把最终 argv 收敛到两侧都能命中的形态（§5.9） | 已按用户裁定只报不动；本仓不碰 dsh |
| 12 | 需求档验收面缺口（**已由父代理处置**） | 需求档 P9（2026-10-07 增补）含判据「Windows 上 `args` 含元字符必须起进程前拒绝」，但 §4 验收表（AC-10..AC-12）**没有覆盖该判据的 AC**；本档 §8 原按该判据列一行并注明待补 | 已裁定（父代理 2026-10-07）：需求档 §4 已补 **AC-13**，本档 §8 该行已改用该号 —— 缺口闭合 |

### 12.1 B3 上抛项（问题 / 备选 / 倾向及理由）

**13 · 冻结面共存的前提（阻断级：前提被打破时须用户裁定）**

- **问题**：P10 引入 realpath 后，冻结用例的期望值成立的前提是三个入参路径**都不存在**（`/tmp/ws`、仓根 `WS`、`Mixed/Case`）—— 它们一旦存在，`realpath` 会改写键，B1:218 与 B2:109/:110/:121 会变色。
- **备选**：A 保留 realpath 默认 + 把「上述路径不存在」写成本批验收前置（本机已核对）；B 默认只折大小写、不做符号链接归一（会违 AC-14 明文）；C 改冻结档或缩 P10 范围（被禁）。
- **倾向及理由**：**A**。理由：B 违需求明文；C 违本批禁止清单；A 在本机（darwin）与 Windows 机上都成立（见 §4.4 核对命令与读数），且冻结面全绿是可机检的共存证据。

**14 · 旧记录的处置（行为变更：需评审 / 用户确认）**

- **问题**：三问③的处置取「不迁移、不扫描」后，以大小写非规范形态写下的旧记录在新规则下不再被命中 ⇒ 该工作区的默认续用一次性退化为新建槽（旧槽仍在，可由枚举工具 + 显式 `sessionId` 接回）。
- **备选**：A 不迁移不扫描（§7-K26，本档取此）；B 惰性迁移（lookup 未命中时按记录里的 `cwd` 重算旧键、扫同父会话记录，命中则按新键重写）；C 一次性迁移脚本重写全表键。
- **倾向及理由**：**A**。理由：键归一是构造规则、不是数据迁移；大小写敏感 FS 上「两个仅大小写不同的工作区」合法存在，B/C 的扫描在回退面（realpath 不可解析）上无法分辨该合并谁 ⇒ 误合并风险高于一次性连续性损失；实机现有记录 realpath 与原值相同 ⇒ 零影响。**该条请评审 / 用户确认。**

**15 · 需求措辞「不是平台枚举」与实现里残留的 win32 折（需评审确认口径）**

- **问题**：P10 判据明文「不是平台枚举」，而实现仍保留 `platform === 'win32' ⇒ toLowerCase()` 作为**补充折**（冻结 B2:109/:110/:111 把该折钉死：任何「按文件系统探针决定折」的方案都会改红 B2:110 —— 注入 `'linux'` 时真实卷仍是不敏感）。
- **备选**：A 保留 win32 折 + 在 §5.9 写明「判据 = 文件系统，折 = 冻结面钉死的补充」（本档取此）；B 去掉折（破冻结 B2:109/:111 ⇒ 不可行）；C 改用文件系统探针（破冻结 B2:110 + 引入启发式 ⇒ 否）。
- **倾向及理由**：**A**。理由：macOS 这条真实缺陷由 realpath 覆盖（本批目标达成），win32 折只在 realpath 给不出答案的回退面生效、在大小写敏感 FS 上不生效；B/C 均与冻结面不可共存。**请评审确认该措辞不构成「仍按平台枚举」。**

**16 · 命名残留（非阻断）**

- **问题**：判据迁走后 `keyPath` 只折大小写、不再承担路径规范化（realpath 落在 `canonicalPath`），名字仍在「键路径」语义上，容易读成判据。
- **备选**：A 保留两名（`keyPath` 纯字符串 + `canonicalPath` 读文件系统）；B 把 `keyPath` 改名为 `foldCase`；C 合并成一个函数。
- **倾向及理由**：**A**。理由：B/C 都会改红冻结面（B2:111 逐字导入并调用 `keyPath`），且 `realpath` 不能进纯字符串函数（同一条冻结断言）；本档已在 §5.9 导出表把两者语义写死。

**17 · 上游口径核对（非阻断）**

- **问题**：本插件 `environmentValue` 镜像 dsh 的同名函数（源码树 `deepseek-harness/packages/subprocess/subprocess-local/src/index.ts:333-338`：精确优先、非 win32 直返、win32 未命中再按大写全表找一次；佐证 = 安装态读数 `@deepseek-ai/dsh-subprocess-local/lib/index.js:1478-1483`），但 dsh 以 `process.platform` 判定、本插件以**注入的 platform** 判定。
- **备选**：A 以注入 platform 判定；B 读 `process.platform`。
- **倾向及理由**：**A**。理由：语义在生产路径上等价（注入值就是 `currentPlatform()`），而注入才使 win32 语义在 mac 上可测（B2 注入面先例）；B 会让 AC-15 无法在本机落地。

### 12.2 B4 上抛项（问题 / 备选 / 倾向及理由）

**18 · 台账 #24 的取舍（收 / 留池）**

- **问题**：`resolveLaunchArgv` 的目标解析结果无非空 / 字符串校验，而解释器候选面有；B3 §6 已裁定该路径经真实 seam 不可达。
- **备选**：A 本批收（win32 分支加守卫，2 行 + 1 例）；B 留池（台账 #24 保持 待讨论）。
- **倾向及理由**：**A**（§7-K30）。理由：与 K29 同面同一不变式（`argv[0]` 必为可用绝对路径）；成本 2 行；B 会让这条口径不一致无触发条件地永久留存。
  **若评审判「不可达路径不值得守卫」，A 可单独回退，不影响 K29**（两处改动相互独立）。

**19 · 需求档缺本批两条条目的判据行（笔在主 agent）**

- **问题**：本批两条条目（台账 #25 启动面收敛 / #24 目标解析面校验）在需求档里**没有对应的 P 句与 AC** ——
  P9 只写「解析失败 / 启动失败必须表现为可读的工具错误」，未覆盖「单一来源」与「解析结果可用性」两条判据。
- **备选**：A 需求档补 P9 两句 + 序号 AC-16 / AC-17（本档 §8 暂用建议号）；B 裁定「结构修条目按 §8 的结构机检口径验收，不进 AC 面」。
- **倾向及理由**：**A**。理由：B3 批的 AC-12 / 14 / 15 即由主 agent 落在需求档（有先例）；本档 §8 已把两条写成可机检判决项，补 AC 号只差一次落笔。**该条请主 agent 裁定。**
- **处置（父代理 2026-10-08 · 小编辑 · 可回退）**：取 **A** —— 需求档已补 P9 两条判据（启动形态单一来源 / 解析结果必须可用）
  与 **AC-16 / AC-17**；本档 §8 两行的「建议号 · 笔在主 agent」注同步为「需求档已落」。

**20 · driver 的 spec 形状不能统一（冻结面钉死）**

- **问题**：委派面 spec 带 `argv`、枚举面 spec 带行为叶 —— 「spec 形状两条面不一致」这一半**无法在 B4 收掉**：
  `B2-…win32.test.mjs:116` / `B3-…platform-closeout.test.mjs:110` 以 `argv` 直调 `startThincoderRun`（桩 `ctx` 无 `resolveExecutable`），
  改形状会在 win32 宿主机上改红两档冻结测试（§4.6）。
- **备选**：A 保留两形状（本档取此）；B 改 `startThincoderRun` 只吃行为叶并同步改冻结的 B2 / B3 测试文件；C 给 driver 加「无 `command` 回落 `argv`」分支（静默回退）。
- **倾向及理由**：**A**。理由：B 违本批「不改 B1 / B2 / B3（含 `.test.mjs`）」禁令；C 违 driver 的「无静默回退」规则 1。
  A 的代价 = 交接形状仍按面不同，但**解析**已单源（K29）；若要连交接形状一并统一，须先解冻 B2 / B3 测试文件（单独一轮）。

**21 · 键面 `currentPlatform()` 不收敛（§4.7-② 的落点）**

- **问题**：三处 `currentPlatform()` 只能收敛到两处；`session-store.mjs:92` 的默认参保留。
- **备选**：A 保留（本档取此）；B 把默认值下移到 `keyPath` 的形参；C 用选项对象替换位置实参以合并两处读取。
- **倾向及理由**：**A**。理由：B 不减少读取次数（同一次读取换个文件）且要碰 `session-store.mjs`（现 160 行）与键的文档串；
  C 会改红 B1:218 与 B2:109 / :110 的位置实参形态（`linkKey(id, cwd, 'linux')`）；
  且键面的判据是**文件系统**而非平台（P10）—— 与启动面的平台读本不是同一件事。

### 12.3 B6 上抛项（问题 / 备选 / 倾向及理由）

**22 · 需求档缺「Linux 宿主实证」的判据行（笔在主 agent）**

- **问题**：本批的核心价值 = 真 Linux 实证，但需求档 §4 没有对应 AC —— AC-10 是 **Windows 真机**（`REQUIREMENTS…:161`），AC-11 是**注入 POSIX 语义**的单测（`:162`）⇒「真 Linux 宿主跑通」无验收面。
- **备选**：A 新增 **AC-18**（Linux 宿主实证；判定方式 = §5.10 的期望读数表；条件性条款写进判定方式，本档 §8 已给建议号与可机检口径）；B 并入 AC-11 的判定方式；C 不进 AC 面（只记环境实证）。
- **倾向及理由**：**A**。理由：AC-10 已有「真宿主」验收的先例，Linux 面缺同构的一条；B 把「注入语义」与「真实宿主」两个判定面混进一条 AC（AC-11 的判定明文是单元测试）；C 会让本批的核心价值不进验收面。**只差需求档一次落笔。**
- **处置（父代理 2026-10-10 · 小编辑 · 可回退）**：取 **A** —— 需求档已补 **AC-18**（含条件性条款：触发条件 + 不满足时判「不满足」的处置）；
  本档 §4.8 第 3 行与 §8 两处的「建议号 · 笔在主 agent」注已同步为「需求档已落」。

**23 · 任务书前提已随实测变化（非阻断 · 请父代理在 §1 追加补测事实）**

- **问题**：批次档 §1（`:28`）记「拉镜像这条路当前不通（10s 窗口内 `node:22-alpine` 未就位）」，并据此要求设计给降级口径。
- **现状（设计者实测 2026-10-10）**：`docker pull node:22-alpine` **成功就位**（`Digest: sha256:0a7108bf…`），容器内 `npm install` 与四档单测**全部跑通**，读数见 §5.10 期望读数表。
- **处置**：设计按**当前事实**写（容器路线为主，降级口径保留为条件性条款）；**不改批次档 §1**（记录面、父代理写域）⇒ 如实上报，请父代理在 §1 追加一条补测事实。
- **倾向及理由**：无需裁定，按事实校正即可；前提的这一变化**不改变**本批的判据面结论（§7-K32）。

**24 · Linux 宿主端到端面仍缺（非阻断）**

- **问题**：AC-18（§8）覆盖的是**插件代码面**；「Linux 上 dsh 装载 + 真 thincoder 委派」的端到端**仍无覆盖**，且 dsh 宿主的原生模块（`node-pty` / `koffi`）在容器内未被加载。
- **备选**：A 如实登记为缺口（本档取此）；B 在本批内补容器内端到端（需容器内装 thincoder 与凭据 ⇒ 本机不具备）。
- **倾向及理由**：**A**。理由：B 的可行性与成本均不成立（无凭据，且会把本批从「判据面 + 取证」扩成宿主部署批）；A 把缺口写明，**是否登记为台账待办请父代理裁定**。

### 12.4 B11 上抛项（问题 / 备选 / 倾向及理由）

**25 · C-1：要不要把「新任务传 `new: true`」写成默认推荐？（已裁定 · 取 A）**

- **裁定结果**：取 **A** —— 写成**默认推荐**：工具 `description` 与随仓发布 skill 的契约依赖清单明说「新任务请传 `new: true`」。
- **裁定来源（逐字 · 用户原话 · 2026-10-16 · 父代理转达）**：「**行，方案甲吧。**」（用户原话与委派正文分列的口径见 `docs/STANDARDS.md` §4.1）。
- **判据**：用户原话「我认为一个任务一个会话也比较合适」（本批次档 §1 四）是一条**倾向陈述** ⇒ 把它落成调用方指引，正是这条倾向的落点。
- **影响面**：该条**不改任何判据**（`new` 的默认值不动 —— C-2 亦取 A，见 26）、**不进 AC 面**；目标文案见 §5.11 末段。**与措辞面 B 的从属（B ⊇ A，二者不互斥）**：C-1 取 A = 工具 `description` 与 skill 明说「新任务传 `new: true`」；措辞面取 B = 在 A 之上**再**往 skill 补一条不对称提示，落点**只在 skill** ⇒ 两处按同一编号 C-1 即可核对；两次裁定各自的授权来源分列保留（A ↔ 本条，B ↔ §5.11 措辞面段）。
- **可单独回退**：改判中性陈述时只改 `description` 与 skill 的一句话，不动实现。

**26 · C-2：要不要把 `new` 的默认值改成「新开」？（已裁定 · 取 A）**

- **裁定结果**：取 **A** —— `new` 的默认值**保持 `false`**（现行行为逐字不变）。
- **裁定来源（逐字 · 用户原话 · 2026-10-16 · 父代理转达）**：「**照你这儿说的话，肯定是默认 false 了呀，如果默认 true 的话，核心的复用会话包括评审、令牌实施流程都断了。行，方案甲吧。**」
- **判据（四处同向）**：① P3 本条（需求档 `:56-65`：designToken 住**槽文件**，「评审 → 令牌 → 实施」的多步流程**必须**落同一槽）；② **AC-9**；③ §7-K47（插件没有任务边界的信号）；
  ④ 用户的判据原话（「默认 true 的话，核心的复用会话包括评审、令牌实施流程都断了」）。
- **影响面**：**不改任何判据**、不改参数面、不进 AC 面。C-1 取 A（加措辞）与 C-2 取 A（默认值不动）**不冲突** —— 前者只加话，后者不改默认。

**27 · 「不设能力门」与 dsh 官方语义的关系（非阻断）**

- **问题**：官方 subagent 工具的叶兼作**能力门**（`dsh-tool-subagent/lib/index.js:355-360`：叶关掉后显式传 `true` 抛错），而本批的 `runInBackground` **只给默认值**。
- **备选**：A 不设门（本档取此，用户裁定 2 口径）；B 照抄能力门。
- **倾向及理由**：**A**。理由：两种叶的**用途不同** —— 官方的叶回答「本实例支不支持后台」，本插件的叶回答「默认走哪条路」；
  B 会把「默认值可配」变成「实例不支持」，正是用户不要的语义。旁证：shell 工具的软取 + 降级（`dsh-tool-bash/lib/index.js:701`）与本档同族。

**28 · 「一任务一会话」约定机械不可检（非阻断 · 请确认不进 AC 面）**

- **问题**：K47 的约定落在 description 与 skill，而插件看不到任务边界 ⇒ 它只能是**调用方纪律**，**没有**可机检面。
- **备选**：A 只写成语义指引、不进 AC 面（本档取此）；B 为它造一条 AC。
- **倾向及理由**：**A**。理由：B 会造出一条**不可机检**的 AC（无人能判「这是不是一个新任务」），违背「AC 逐条可机检」的口径。

**29 · job 注册表纯内存 = 已知限制（非阻断 · 是否登记台账请父代理裁定）**

- **问题**：`dsh-jobs-local` 是**纯内存**注册表（`lib/types/index.d.ts:38-39`）⇒ 进程重启后 job 号失效：模型手里的旧 jobId 读不到，**那一轮的答复文本也拿不回**。
- **与 P3 的关系（不冲突）**：续用记录**是落盘的**，重启后仍能接回同一条 thincoder 槽（枚举工具 / 显式 `sessionId`）⇒ 丢的是**那一轮的答复文本**，不是会话连续性。
- **备选**：A 如实登记为已知限制（本档取此；P11 未要求 job 持久化）；B 本批补 job 持久化（超出 P11，且要动 dsh 侧）。
- **倾向及理由**：**A**；**是否登记为台账待办请父代理裁定**（台账写入不在本子代理的写域）。

**30 · 覆盖缺口与 `unverified` 面（逐条标出）**

- **AC-20 只有端到端面**：判据落在 dsh 宿主的步边界取消息（`dsh-agent-loop/lib/index.js:906` / `:103-105`），**不在本仓单测面** ⇒
  单测只能守到「工具立即返回」那一半（§6.5 面 4）；端到端由实施 / 验证批承担。
- **AC-19 的「服务卸载」路径未在真宿主实测，且无单测面**：取消与 owner 释放两条经 abort → 既有阶梯（有单测面 §6.5 面 6 / 7）；
  **jobs 服务 dispose** 那条要真宿主卸载 jobs 服务才触发（`dsh-jobs-local/lib/index.js:129` / `:418-426`）⇒ 端到端步骤与判据落在 §9.6 用例 69，本轮标 **`unverified`**，端到端留 §5 / §6 批次（与 AC-20 同一处置口径，**不得**用假单测充数）。
- **真宿主装载面 `unverified`**：本插件的**后台路径从未在 dsh 实例上跑过**（需 dsh 安装与 thincoder 凭据）⇒
  「默认后台在真宿主下不阻塞主会话」这句在**本轮是设计推断**（机制判据来自源码实读 + 批次档 §1 二的冻结读数），**不是实测读数**。

## 13. 变更记录

- 2026-10-05 首版：机制、文件清单、逐行动作表、验收对照与关键决策落稿；含用户对 P6/AC-6 的裁定（拒载面 = 工程档不可解析，缺档不是拒载面）。
- 2026-10-06：§10 登记 skill 契约依赖 —— 随仓发布的 skill `delegate-to-thincoder` 及其契约同步义务（清单见 `docs/USER-SKILL-delegate-to-thincoder.md`）。
- 2026-10-07 B2（平台适配 P9 / P10）：新增 `src/platform.mjs` 为**全仓唯一平台分支点**（win32 命令解析 + `.cmd`/`.bat` 的 `cmd /d /s /c call` 包装；键路径大小写归一）；
  增补 §1 平台断点、§2 理由、§3.1 `command` 语义与「不新增配置叶」、§4.1/§4.2 受影响文件（1 新增 + 7 修改 + 1 新增测试文件）、§5.9 平台适配契约、§6.1 动作表 L1–L12/M1、
  §7-K17..K24、§8 AC-10..AC-12 对照、§9.2 用例 15–27、§10 边界三条、§11 无 open 项、§12 上抛项 5–11；本批无新依赖、无新配置叶。
- 2026-10-07 设计修正轮（#7 用户裁定）：win32 下配置 `args` 含 cmd 元字符（`%` `&` `|` `<` `>` `^`，不含 `(` / `)`）改为**起进程前拒绝并报可读错误**；同步 §5.9 / §6.1（+L13）/ §7-K21 / §8 / §9.2（用例 21/28/29）/ §10 / §12-7，并登记 §12-12（需求档缺对应 AC）。
- 2026-10-07 父代理同步：需求档 §4 补 **AC-13**（含解释器元字符的 `args` 被拒绝）；本档 §8 该行改用 AC-13、§12-12 处置列改为已裁定。
- 2026-10-07 设计评审 round1 修正（发现 #1 形式面 · #2）：§4.1 表每个「修改」行补行数预算（`+N（≤+N 行）` / `结构不变（±0 行）`）、新增行给 `≤N 行` 总量上限；
  §5.9 第 3 条钉死解释器候选来源与优先级（配置 `env.ComSpec` → 宿主 `process.env.ComSpec` → 字面 `'cmd.exe'`，各经 `resolveExecutable(candidate, env)`）；
  同步 §6.1-L4 与 M1 的面 1、§7-K22 的候选括注、§9.2 用例 23 改写并增用例 30–32、§5.9 内引用的用例区间改 15–32。
- 2026-10-08 B3（平台适配收口 · 台账 #20 P10 / #21 P9）：P10 键归一判据改为**目标路径所在文件系统的大小写语义**（`realpathSync.native` + 失败回退，只作用于键），
  P9 解释器候选读 `ComSpec` 改为大小写不敏感（镜像 dsh seam，候选顺序不变）；
  增补 §1 B3 收口段、§2 理由、§2.1 数据流括注、§4.3 受影响文件（2 修改 + 1 新增测试文件 + 1 依赖清单）/§4.4 冻结面共存前提、§5.6 键构造、§5.9 导出表与规则 3 / P10 收口块（含三问回答）、
  §6.2 动作表 N1–N7 与测试面十条、§7-K25..K28、§8 AC-12 改写与 AC-14 / AC-15 新增（并显式区分不在变更面的 AC-10 / AC-11 / AC-13 与 AC-1..AC-9）、§9.2 用例 26 精确化、§9.3 用例 33–42、§10 边界三条、§11 无 open 项、§12.1 上抛项 13–17；本批无新依赖、无新配置叶。
- 2026-10-08 B3 设计评审 round1 修正：发现 1（真实探针改可移植夹具 `mkdtemp` + 自建符号链接 + 跳过判据 + 平台支持矩阵，桩注入恒为必测）· 发现 2（回退责任归 `linkKey` 兜底，键构造永不抛错）· 发现 3（新增测试文件基线 `0`、动作 `+≤160 行`）· 形式项（dsh 出处改源码树口径）；落点 §4.3 / §5.6 / §5.9 / §6.2 / §7-K25,K27,K28 / §8 / §9.3 / §12.1-17。
- 2026-10-08 B4（启动面收敛 · 台账 #25 / #24）：启动面「解析最终 argv」收敛为**一个函数 + 一个调用形状** ——
  新增 `platform.mjs#resolveChildArgv`（行为叶 in → argv out，全仓唯一调用 `resolveLaunchArgv` 处）、
  `resolveLaunchArgv` 的 `platform` 形参加默认值 `currentPlatform()`（`currentPlatform()` 调用点 3 → 2）、
  win32 分支给目标解析结果加可用性守卫（#24）；
  增补 §1 B4 段、§2 理由、§2.1 数据流与枚举面同源块、§3.1 不新增配置叶、§4.5 受影响文件与行数预算、§4.6 两条冻结约束（D-1 + `argv` spec）、§4.7 四问回答、
  §5.9 导出表（五件 → 六件）与单一来源段、§6.3 动作表 O1–O6 与测试六面、§7-K29 / K30、§8 判决行与「不在变更面」注改写、§9.4 用例 43–49、§10 边界两条、§11 无 open 项、§12.2 上抛项 18–21；
  本批无新依赖、无新配置叶，`tools.mjs` 与三档冻结面逐字未动。
- 2026-10-09 B4 设计评审 round1 修正（处置表 #2）：§5.9 定义「规范化输入形状」（行为叶三字段、两处同一字段集合）、§6.3 测试面第 2/3 条与 §9.4 用例 43 / 44 期望加强为「两处行为叶键集合相同」、§8 AC-16 行对齐需求档口径。
- 2026-10-10 B6（Linux 适配收口 · 台账 #27）：判据面结论 = **Linux 已在 P9 / P10 语义内**（P9 `:113` 的实现即 `src/platform.mjs:95` 的非 win32 早退；P10 `:128` 的文件系统大小写语义覆盖 `ext4`）⇒ **不新增需求句**，只为「真 Linux 宿主跑通」立一条**条件性验收**；
  取证路线取**容器**（Docker Desktop + `node:22-alpine`，四档与两条探针均已实测跑通）；
  增补 §1 B6 段、§2 理由、§4.8 受影响文件（`src/**` 零改动、不新增文件）、§5.10 取证契约（配方 + 期望读数表 + 降级口径）、§6.2 Linux 实测补充、§6.4 取证步骤表 E1–E6、
  §7-K31..K33、§8 AC-18 行与注（建议号 · 笔在主 agent）、§9.5 用例 50–57、§10 边界四条、§11 无 open 项、§12.3 上抛项 22–24；本批无新依赖、无新配置叶、无新测试文件。
- 2026-10-10 B6 结算后修正（父代理复核 · 台账 #27 已核销 / #28 本修正批）：§4.8 第 2 行的增量由**设计期读数** `+169` 更正为**实测 `+176`**（955 → 1131，≤+180 预算内）。
  同轮复核另发现 B6 批次档 §6 自报的两处陈旧计数（「本批次档 **165** 行 / **9** 行超宽」，实测 **284 行 / 10 行超宽** —— 第 10 条在 §6 五、系取完计数之后才追加）；
  该两处落在**已冻结**的批次档内，按冻结纪律（`close` 后整档冻结、改 = 新批新档）**不回改**，更正落点 = `docs/batches/B7-dsh-subagent-thincoder-closeout-correction.md` + 台账 #27 `evidence`。
  B6 档 §2 的 `1124（+169）` 定位为**设计期 as-of 读数**，保留不改。
- 2026-10-16 B11（非阻塞委派 · 台账 #32 / P11）：默认路径改 dsh 的**后台 job**（`ctx.jobs.start` + 一次性 `ctx.subagents.start`），工具**立即返回 job 号**，
  子代理在 `done` 里结算；返回面改 `oneOf` 判别联合（前景分支逐字四键、后台分支 `{kind:'background',jobId}`）、`render` 按 `value.kind` 分流、
  `jobs` 软取且惰性、新增行为叶 `runInBackground`（默认 `true`，参数 `run_in_background` 恒胜）、**不设任何读回上限**（§7-K43）；
  增补 §1 B11 段、§2 理由、§2.1 后台链路、§3.1 一行叶、§4.9 受影响文件与新预算（+≤350 行 · 本相完工实测 +330）、§4.10 冻结面共存五条、§5.11 后台契约、
  §6.5 动作表 P1–P11 与测试十面、§7-K34..K47、§8 标题口径修正（P1–P11 ↔ AC-1..AC-20）+ AC-19 / AC-20 两行、§9.6 用例 58–68、
  §10 边界七条、§11 无 open 项、§12.4 上抛项 25–30；本批无新依赖，`src/index.mjs` 与 `src/driver.mjs` 逐字未动。
- 2026-10-16 B11 裁定落位轮（fix）：C-1 / C-2 **均裁定取 A**（用户原话 2026-10-16，父代理转达）—— §12.4-25 / -26 由「待裁 / 不裁定」改为**已裁定**（含用户原话来源与判据）；
  §5.11 末段给出**目标文案**（工具 `description` 英文两句 + skill 中文目标句 + 共存与判别判据表 + 措辞面 1 条 `open` 与倾向）；§4.9 第 9 行 skill 预算同步为 +6（≤+8 行）；
  设计档自身预算由 +≤350 顶破 ⇒ **据实上浮至 +≤400**（本轮 +41 行，1465 → 1506；依据⑤）；§7-K47 / §10 / §11 同步；**无行为判据改动**，`src/**` 零改动。
- 2026-10-16 B11 设计评审 round1 修正（fix · **三条裁定均取接受** · 修正面只限三个号）：**号 1** 去掉 job spec 的 `outputLimitBytes`（本插件不再设任何读回上限）——
  落点 §2.1 数据流 · §5.11 job 规格与逐字句 · §6.5 P8 与测试面 5 · §7-K43 与注① · §9.6 删用例 68 并顺移（58–68）· §13；理由 = 该字段是本插件**自造的唯一读回上限**，
  设了它后台读回被截断而剩余文本**无取回路径**（§7 注①），后台因此**劣于**前景、直接违 P11（需求档 `:149-150`）；答复体量交宿主的既有工具结果处理承担（与 §7-K45 同精神）。
  **号 2** §5.11 工具 `description` 目标文案补**适用条件与两处例外**（后台为默认 / 显式 `false` / `jobs` 不可用退前景）⇒ §6.5 P10 由「补两句」改「补三句」。
  **号 3** §7 新增**注②**（K34 的最近先例坐标：实现坐标 + 本仓镜像章节 §5.11 / §6.5 + **先例批次 = 无**（显式声明）+ 对齐 / 偏离），§2 先例段加指针。
  **无行为判据改动**（P11 与 AC-1..AC-20 一行不动、§8 零改动），`src/**` 零改动，不新增判据 / 验收条目。
- 2026-10-16 B11 措辞面裁定落位轮（fix · 用户裁定**取 B**）：§5.11 末段的措辞面 `open` 改为**已裁定 · 取 B**（skill 补一句不对称提示、工具 `description` 短面不加；裁定来源 = 用户原话 2026-10-16 · 父代理转达）；
  §11 口径收正 —— 删去措辞面 `open` 的那句残留（D8），措辞面裁定指向 §5.11；§4.9 第 9 行（skill 依赖清单：+6 → **+7**）按实测随动；设计档自身本轮 **+6 行**（1526 → 1532）未顶破上限 1535 ⇒ 第 7 行不动；**无行为判据改动**，`src/**` 零改动。
- 2026-10-16 B11 设计评审 round2 修正（三条 🟡 均接受）：§5.11 `description` 与「三句分工」段补**第三支**阻塞情形（本实例配置为前台 + 参数缺省 ⇒ 前景，写成实例面）⇒ 门表三支与描述一一对上；§8 AC-19 写明**三条终止触发**各自的验证面、§9.6 补用例 69（服务卸载 · 只端到端 · 无单测面）、§12.4-30 同步；§12.4-25 与 §5.11 措辞面段交叉指向、写明 **B ⊇ A**。本轮 +2 行（1533 → 1535，未顶破上限）；**无行为判据改动**，`src/**` 零改动。
- 2026-10-17 B12（宿主版本面 · 台账 #37 / P12）：跟 dsh `0.2.1-rc.2` 的 seam 迁移 —— 启动面换 `startActivation`（`label` 升 spec 顶层、`delivery: 'caller'`）、
  会话号改**插件私有载体盒**（`request.thincoderCarrier`，绕开 `receipt()` 只回三键的截断）、cwd **上收宿主**（`config.cwd` 降为请求覆盖）、settle 自实现 `settleActivation` + 显式 `dispose()` + 取消接线。
  增补 §1 B12 段、§2 B12 迁移块、§2.1 两张数据流图改写、§3.1 `cwd` 叶语义、§4.9 第 12 行口径、§4.10 两处例外、
  **§4.11 受影响文件与行数预算**（+≤360）、**§4.12 冻结测试文件逐行改动表**（B1 11 条 / B11 10 条）、§5.1 provider 契约（含 capabilities 四键口径更正）、
  §5.2 两个私有字段 + 载体盒契约与备选 A/B、§5.3-B12 调用形态 / settle 映射表 / 取消接线、§5.9-B12 cwd 上收与枚举回退链、§5.11 `run` 体改写、
  §7-K48..K52 与 K5 导出面更正、§8 标题口径 + AC-21 行 + 复核口径、§9.7 用例 70–81、§10 边界五条、§11 无 `open` 项、§13 本行；**本批 `src/**` 零改动**（设计相），需求档由主 agent 落（P12 / AC-21）。
