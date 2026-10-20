# 2026-10-17 · dsh-021
> 六段 append-only，一段一作者：§1 讨论（主 agent）· §2 批次任务与设计（eng-designer）· §3 设计评审（评审子代理）· §4 用户批准（主 agent）· §5 实施记录（eng-coder）· §6 验证与收口（父代理）。
> 编制：主 agent · 2026-10-17 · 来源 = 本轮委派正文（对话对方，2026-10-17）：「任务：B12 批次「dsh 0.2.1-rc.2 seam 适配」——设计相 + 设计评审」；其中 R1–R4 由委派方标明为「用户明示」，本会话未直接接触用户原话，按 docs/STANDARDS.md §4.1 记为委派方转述（逐项见 §1 一）。
> 台账 = #37（REQUIREMENTS-dsh-subagent-thincoder · 归批）。前情 = docs/batches/B10-dsh-subagent-thincoder-freeze-discipline.md §6（已收口 2026-10-11）；并行未收口 = docs/batches/B11-dsh-subagent-thincoder-nonblocking.md（P11 残余 #34，本批不触碰）。
## §1 讨论（主 agent）
**状态行**：已收口 2026-10-18

**本批条目（1 条）**：台账 **#37** = **P12 宿主版本面** —— 把插件从 dsh `0.2.0-rc.2` 的 subagent seam 迁到 **`0.2.1-rc.2`**：`startActivation` 启动面、会话号私有回带载体盒、cwd 权威上收、settle 自实现；**单版本支持**（只支持 0.2.1-rc.2）。thincoder 侧**零改动**（下方事实 12 已复核为零断点）。

**性质与路由**：**产品代码面**（`src/**`）⇒ 走全链路（需求档 → 设计档 → 设计评审 → 用户批准 → 实施）。本轮 = **设计相 + 自评**（独立评审待用户点发），**不实施**（`src/**` 零改动；本档 §4 / §5 / §6 本轮**不写**）。

### 一、授权口径（**按 `docs/STANDARDS.md` §4.1 逐项标明来源**）

| 来源 | 内容 |
|---|---|
| **委派正文（对话对方，2026-10-17）** | 「任务：B12 批次「dsh 0.2.1-rc.2 seam 适配」——设计相 + 设计评审」；含 §一–§十：背景、四个断点、cwd 迁移、preset 待验项、冻结面约束、交付物清单、独立复核要求、边界。 |
| **委派正文转述的「用户明示」裁定 R1–R4** | **R1** P11 走向 = 方案 C（保留 `ctx.jobs.start` 外包 + 内层 `delivery:'caller'`；**不得**改 `delivery:'parent'`，否则破 B1 四键）· **R2** 单版本支持（只支持 `0.2.1-rc.2`，不做 0.2.0 双版本兼容）· **R3** 验收 = 隔离 profile 真跑（用 npx 的 0.2.1 安装；**不动** `~/.dsh/profiles/web/` 与全局安装）· **R4** 批次归属 = B12 新档，B11 保持**未收口**原地不动（AC-19/AC-20 证据补进 B12）。**注**：本会话未直接接触用户原话，按 §4.1 记为**委派方转述**。 |
| **委派方追加批准（2026-10-17 19:00）** | 「**三处方向：全部批准**」——D4 载体盒（补两条硬要求：**建立失败时的读盒语义**须可读且能区分「会话未建立」与「已建立但回带丢失」；设计档须写明契约性质与**备选 A/B 不取理由**）· `config.cwd` 保留叶（补一条：`''` 的语义与旧 `header.cwd` **不等价**，不得写成「等价改写」）· settle 自实现（补：工具侧**必须**显式 `dispose()`，并处理与宿主自动 dispose 的竞争）。另：**AC-21 判定面写死到可执行**；**不把 AC-19/AC-20 的判据搬进 AC-21**。 |
| **本会话自行判断（非委派给定，委派方已复核采信）** | ① 对委派正文的**四处更正**（见三）；② D4 取**载体盒**而非把槽号编码进 `run.id`；③ `config.cwd` **保留叶**、让 dsh 当唯一解析者；④ 冻结测试文件改动面仅 **B1 / B11 两档**。 |
| **委派方保留的裁定权** | 「若中途发现 R1–R4 任一裁定与事实冲突，停下并告知，不要自行改判。」 |
| **本轮不做** | `src/**` 零改动 · 本档 §4/§5/§6 · `docs/batches/B1–B11` 正文（**冻结面**，`docs/STANDARDS.md` §4.3）· `~/.dsh/profiles/**` · 全局安装 · thincoder 源码树 · **不改 AC-1..AC-20 的判据**。 |

### 二、机制事实（**委派方已核实 ⊎ 本会话独立复核**，均为本批前提）

| # | 事实 | 判据（`file:line`） | 归属 |
|---|---|---|---|
| 1 | 0.2.1 导出面**没有** `resolveChildCwd` / `validateConfiguredCwd` / `settleRun` | 运行时实测 `typeof === 'undefined'`（npx 0.2.1 树）；0.2.0 分别在 `packages/subagent/subagent/src/out-of-process.ts:126` / `:147`、`run-settlement.ts` | 本会话实测 |
| 2 | 删除提交 = cwd 两 helper 由 `79bd3d8da7` 删；`run-settlement.ts` 整档由 `3d852a1cea` 删 | `git log -S'resolveChildCwd'` / `--diff-filter=D` | 本会话实测 |
| 3 | 新启动面 = `ctx.subagents.startActivation(spec)`；spec = `{provider,label,request,signal,delivery}`，`label` 由 request 提升为 spec 顶层 | `packages/subagent/subagent/src/index.ts:269`、`types.ts:31-43` | 委派方已核实 · 本会话复核 |
| 4 | `receipt()` 只回 `{childId,result,dispose}` ⇒ **provider 返回对象不透传** | `manager.ts:1221-1227` | 委派方已核实 · 本会话复核 |
| 5 | `childId = run.id`；`run.id` 要求「全运行时唯一」；撞车抛 `DUPLICATE_CHILD` | `manager.ts:869`、`types.ts:288`、`manager.ts:634-637` | 委派方已核实 · 本会话复核 |
| 6 | 正常结算宿主**自动** dispose（`run.result.then(finish,finish)`）；`close()` **幂等**，重复 `dispose()` 共享同一事务 | `manager.ts:972-978`、`:781-786` | 本会话复核（委派方要求确认幂等性） |
| 7 | teardown 失败**只**经 `dispose()` 的 rejection 暴露（`finishDisposal` 末尾 throw；`activation.result` 照常 resolve） | `manager.ts` finishDisposal 尾段（`:1180-1184`） | 本会话复核 |
| 8 | cwd 由宿主解析：`resolveDirectory` 先 `workingDirectory.ensure(parent)` 再解析 `request.cwd`；`startExternal` 以**绝对 cwd** 注入 provider | `manager.ts:525`、`:497-501` | 委派方已核实 · 本会话复核 |
| 9 | `working-directory` 包是 **0.2.1 新增**（0.2.0 `git ls-tree` 为空）；API = `get(session)` 同步 / `ensure(agent,signal)` / `set(...)` | `packages/session/working-directory/src/index.ts:122/134/163` | 本会话实测 |
| 10 | `Session.header.cwd` 降级为**原始项目身份**；当前目录另存（用户切过目录后两者分叉） | `docs/upgrade-guide/v0.2.1-alpha.1/working-directory/guide.md` Migration 2/3 | 本会话复核 |
| 11 | 顶层注册的工具对 preset 会话**代码面可见**：无作用域 ⇒ 全局层；agent 面 = 全局层 + 作用域链；standard preset 无 `restrict` | `dsh-tools/lib/index.js:2969-2982`、`:3056` | 本会话复核（**未真跑**，见五） |
| 12 | thincoder **零断点**：`v0.12.73..v0.12.75` 的 `thincoder-cli/src/acp/` = 5 文件 +30−15，恰为三项变更（`onSecretInput` 注入缝 / `#41` 的 `workspace` 放行 / `read-data.mjs` 台账根），其余为注释；`client-caps.mjs` / `transport.mjs` / `ext.mjs` / `resource-link.mjs` 逐字节相同；`session/new` 的 `cwd === process.cwd()` 门逐字不变 | `git diff v0.12.73 v0.12.75 -- thincoder-cli/src/acp/`；`handlers-session.mjs:177-181` 段 | 委派方已核实 · 本会话复核 |
| 13 | 插件在 0.2.1 树下 import：`provider.mjs` / `tools.mjs` / `index.mjs` 抛 `SyntaxError: ... does not provide an export named 'resolveChildCwd'`；其余 7 模块正常 | 探针 `/tmp/b12-probe`（`src/` 副本 + 0.2.1 树 `node_modules`） | 本会话实测 |
| 14 | 隔离 profile **可组出**（合成树含本插件行），**未启动** | `DSH_HOME=/tmp/b12-home dsh --profile probe --dump-config` | 本会话实测（启动面见五） |

### 三、四处前提更正（对委派正文的更正，委派方已复核接受）

| # | 委派正文原话 | 实况 | 判据 |
|---|---|---|---|
| 1 | 「0.2.1 把 `tool-subagent` 也加进了 disable 清单，属装配形态实质变化」 | **不实**。`tool-subagent / disabled: true` 在 0.2.0-rc.2 就已存在；两版 disabled 清单的差集**只有一项**：0.2.1 少了 `tool-ralph` | 0.2.0 `packages/bundle/web-app/cordis.patch.yml:531-532`；0.2.1 `:561-562`；两版 id 清单 diff |
| 2 | ——（应记为的实际变化） | 0.2.1 装配面变化 = ① 新增 `agent-preset-registry`（`default: standard`）② base 新增 `working-directory` + `tool-working-directory` 两行 ③ preset 层变化（`time-context` / `tool-schedule` 入 standard；`tool-subagent-codex` / `-claude-code` / `tool-ralph` 行删除；persona 的 `{{cwd}}` 后缀删除）④ `tool-subagent` 的 `backgroundMode` 配置叶删除 | 0.2.1 `web-app/cordis.patch.yml:585-590`、`base/cordis.patch.yml:166-170`、`presets/standard.patch.yml` diff |
| 3 | 「顶层挂载的工具在 preset 会话里是否仍可见 = 待验」 | 维持「待验」，但**代码面判据指向可见**（事实 11）；本会话**不**把它写成已验 | 同上 |
| 4 | 「`working-directory` 在 0.2.1 里统一走 `ctx.workingDirectory.ensure()`」 | 成立，且该包**在 0.2.0 根本不存在** —— 这是 0.2.1 的结构性新增，不是既有面改动 | `git ls-tree dsh-v0.2.0-rc.2 -- packages/session/working-directory` 为空 |

### 四、设计方向（父已批准；**细则由设计档落定**）

**① D4 会话号回带 = 插件私有载体盒**（不取 `run.id` 编码）
工具在私有字段 `thincoderSession` 内放一个**可变载体盒**（`{ carrier: { sessionId: undefined } }`）；driver 在会话建立成功的那一刻写入真实槽号；工具在 `startActivation` 返回后读盒，`dispose()` 之后仍可读。`run.id` 保持 `randomUUID()`。
硬要求（委派方追加）：**a.** 建立失败 / 盒空时**不得**把空串当会话号返回 —— 走 `src/errors.mjs` 既有构造点的可读错误，文本能区分「会话未建立」与「已建立但回带丢失」，设计档给判定分支；**b.** 设计档写明这是**插件私有**契约（与 `thincoderSession` 同族，不改公共 seam、不泄露进 `childId` / 目录面 / 日志面），并列出备选 A（槽号编码进 `run.id`，无状态但须解析且进 `childId` 面）与 B（插件内 `Map<childId,sessionId>`，dispose 后保条目须定内存策略）及**不取理由**。

**② cwd 权威上收，`config.cwd` 保留叶**
provider 不再自己算 cwd，直接用宿主注入的 `request.cwd`（绝对路径）。`config.cwd` 非空 ⇒ 工具把它作为 `request.cwd` 传入，起进程前用 `assertUsableCwd` 校验（保留「进程前可读报错」）；`''` ⇒ **不传** `request.cwd`，由 dsh 取父会话**当前**目录。枚举工具走 `ctx.get('workingDirectory')?.get(parent.session)` 软取（`inject` 四项一字不改）。
硬要求（委派方追加）：设计档须写明 `''` 的语义与旧 `header.cwd` **不等价**（前者=当前目录、后者=原始项目身份，用户切过目录后分叉 —— 这正是迁移的实质收益），并把「保留叶」写成**显式裁定** + 列出备选（直接退役该叶）与不取理由。

**③ settle 自实现 + 取消接线**
映射表完整（`completed`→completed 带 finalText；`aborted` 无诊断→`killed`、有诊断→`failed`；`error`/`max-tokens`/`refusal`/其它→`failed` 带 detail；结果拒绝 → failed 带 `String(error)`；dispose 失败拼进 detail）。工具侧**必须**显式 `dispose()`（唯一暴露 teardown 失败的口子）；与宿主自动 dispose 的竞争按事实 6（`close()` 幂等）处理。取消接线：**前景**把 `exec.signal` 接到 `activation.dispose()`、**后台**把 job 的 controller 接到 `dispose()` —— `startActivation` 之后调用方信号**不再**连到 run，这是本迁移最容易漏的一处。

**④ 冻结测试文件改动面 = B1 + B11 两档**
两档用 `ctx.subagents.start` 与 `thincoderSessionId` 做假件，须改写。设计档**逐行**列明：改哪一行、为什么必须改、不改会怎样（`docs/STANDARDS.md` §4.3 的冻结纪律对**批次档正文**；测试文件改动须逐条列明，先例 = B2 改 `B1-…test.mjs:218`）。`B2` / `B3` / `B4` 三档**零改动**。

### 五、待验面（`unverified`，**不写成已验**）

1. **隔离 profile 真启动**：合成树已 `--dump-config` 通过，**未启动**（需模型凭据；会起服务）。
2. **preset 会话里的工具可见性**：只有代码面判据（事实 11），**未在真会话观测**。
3. 以上两项 + R3 的验收方式 ⇒ **并入 AC-21**，判定面须写死到可执行（命令 / 隔离 profile 路径 / 预期断言），实施末期由父代理执行。

### 六、验证与下一步

- **本轮（已完成）**：设计档改完 + 本档 §2（批次任务与设计）+ §3 轮次 0（**父代理自评**，非独立评审）。
- **下一步（待用户点发）**：**裁定 D1–D5**（见下方「七」）—— 裁定后父代理按裁定收尾 A9 并跑完剩余验收；**发起权在用户**。

### 七、实施轮待裁（父代理停下待裁 · 2026-10-17）

实施轮（eng-coder · 同步）已落地 A1–A8；A9 只完成一半（B12 单测已建）。下面五项需用户裁定（D1 / D2 是**硬断点**）—— **用户 2026-10-18 全采纳①方案，落地与读数见 §6 一**（本表保留为裁定前的选项记录，不再作为待办）。

| # | 事项 | 事实（父代理已复核） | 选项与建议 |
|---|---|---|---|
| D1 | **写门阻断 A9**（B1/B11 两份测试文件的逐行改动） | eng-coder 直写 `docs/batches/B1-…test.mjs` / `B11-…test.mjs` 被拒，报「cross-batch batch-record write … bound to B12」（子代理转述，未复核——复核它需真写一次）。后果：B1 仍 **0/1**（链接期失败：仍导入已删的 `resolveDelegationCwd`）、B11 **2 pass / 7 fail** | ① **父代理直接按 §4.12 改**（表已逐行钉死，属机械应用；无新增语义）— **建议**；② 另开一批落测试改动（成本高、B12 红着）；③ 改机制允许子代理写（不当） |
| D2 | **B4 用例 43 与 cwd 硬拒冲突** | B4:73 调 `provider.start` 时**不带 cwd**；设计 §5.1 规定空 cwd 必须在发布前拒绝（已在 `src/provider.mjs:128` 落地）⇒ B4 **6 pass / 1 fail** | ① **只给该用例补一个 `cwd` 字段**（1 行；该用例的主题是 argv，不是 cwd）— **建议**；② 放宽 provider（允许空 cwd 回退 `process.cwd()`）— 退回「cwd 双权威」，不建议；③ 接受 B4 红——不可 |
| D3 | **B1:486-499 能力枚举断言** | 该处 `assert.deepEqual` 硬编码 0.2.0 的**五键**（含 `toolFilter` / `persona`），0.2.1 实测**四键**；设计 §5.1 已写「四键口径更正」，但 §4.12 表漏了此行 | ① 把期望对象改为四键（**与已批准的 §5.1 一致**，仅补表的漏项）— **建议**；② 不改 ⇒ 断言必红 |
| D4 | **前景四键无「失败原因」通道**（eng-coder 内部评审的 🔴） | 前景返回 `{text,sessionId,stopReason,status}`；dispose 拒绝 / 非 completed 的原因只在 `outcome.detail`，模型读不到（render 只显答复 + 会话号） | ① 失败时**抛错**（detail 进异常文本，与 `carrierLost` 同形）— **建议**，需设计补一句，不动四键成功路径；② detail 拼进 `text`（污染答复文本）；③ 只写日志（模型仍看不到）|
| D5 | **driver 写盒无直测**（eng-coder 内部评审的 🟡） | 单测假件自行写盒 ⇒ 删掉 `src/driver.mjs` 那行不会红；补 driver 级用例约 35 行，超 B12 单测预算（260/260 已满） | ① 提高 B12 单测预算并补测；② **先记台账技术待办**（trigger = 归批）— **建议**；③ 不处理 |

另：**AC-21 真跑未执行** —— 隔离 `DSH_HOME` 与 profile `b12` 均不存在，eng-coder 按任务书未自造；**a–g 全部 `unverified`**，待隔离环境就绪后由父代理执行。
- **实施末期**：变更面单测（目标文件直跑）+ **AC-21 真跑**；AC-19/AC-20 判据**不改**，B12 只补证据。
- **行数基线（2026-10-17 开工实测，`wc -l`）**：`config 105` · `provider 150` · `tools 342` · `driver 501` · `index 61` · 设计档 **1535** · 需求档 **264** · README **46**；测试 `B1 698` · `B2 140` · `B3 159` · `B4 129` · `B11 196`。
- **设计相落笔后实测（同一天，内容落定后量取 —— 本仓 `docs/STANDARDS.md` §4.2）**：设计档 **1889**（+354，预算 ≤1895）· 需求档 **343**（+79）· README **48** · 本批次档 **326**；`src/**` 仍 **0 行改动**（`git diff --stat -- src/` 空）。
- **行宽机检（两种尺子并列 · 复现命令见下）**：
  - **本项目校验器的尺子**（`doc-check/width.mjs:97-127`：`[...line].length` 计**码点** ∧ 非表格行 ∧ 非引述行 ∧ 非围栏块内）：设计档 **0** · 需求档 **0** —— HEAD 基线同为 **0 / 0** ⇒ **无违规**。复现：`node -e` 逐行 `[...l].length>300 && !/^\s*\|/.test(l) && !/^\s*>/.test(l)`。
  - **字节尺子**（`Buffer.byteLength`，CJK 一字三字节 —— 用户本轮用的这把）：设计档 **76**（HEAD **78**，**净 −2**）· 需求档 **3**（HEAD **3**，**净 0**）。复现：`git diff --unified=0 HEAD -- <file>`，数 `+` 行里字节 >300 的条数。
  - **B12 新增的 9 行已全部拆解**（长句下沉为表下条目 / 代码块，**零信息删减**）：设计档 A10（§4.12）· B10 性质说明 · 前景/后台取消两行（§5.3-B12）· K48–K52 五行（§7，明细移入**注④**）· §8 的 AC-21 行；需求档 AC-21 行。
- **上一轮自报的「0 行超宽」失真（据实登记）**：当时只用了校验器的尺子，未报字节尺子的读数 ⇒ 对用户而言等于「漏报 +8 / +1」。**已修**，两种尺子现在都给出读数。

## §2 批次任务与设计（eng-designer）

**状态行**：设计完成（2026-10-17）

> **作者归属（据实标注）**：本段由**主 agent**直接落笔 —— 本轮委派正文明确要求「本轮不许派内层子代理，你自己直接把设计写出来」；
> 内层 `eng-designer` 活在 `thincoder acp` 子进程的进程内池里，**跨 turn 不存活**（上一轮派出后产出随进程回收丢失，§2/§3 与设计档当时均为空）。
> `batch` 工具按「一段一作者」把 §2 判给 eng-designer 并拒绝主 agent 写入 ⇒ 本段经**文件直改**落盘（可单笔回退），内容与设计档同轮一致。

### 一、本批条目（覆盖 1 条）

| 台账 | 需求点 | 覆盖 | 交付面 |
|---|---|---|---|
| **#37** | **P12 宿主版本面**（`docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:157-171`） | 四个断点全部覆盖：启动面 / 会话号回带 / cwd 权威上收 / settle 自实现 | `src/` 五个文件 + 本批单测 + B1/B11 两份冻结测试文件的逐行修改 |

**不覆盖（显式）**：P11 的残余面（AC-20 / AC-19③ 需真 dsh 实例实跑）仍记台账 **#34**，**本批不结清**；thincoder 侧**零改动**（§1 事实 12）。

### 二、设计落点（实现者按此定位，不必重读设计档全文）

| 主题 | 设计档坐标 | 一句话 |
|---|---|---|
| 启动面 | §5.3-B12（调用形态代码块） | `startActivation({ provider, label, request, signal, delivery: 'caller' })`；`label` 在 spec 顶层 |
| 会话号回带 | §5.2（载体盒契约 + 判定分支表 + 备选 A/B） | `request.thincoderCarrier = { sessionId }`，driver 建立成功即写；工具读盒 |
| cwd | §5.1（provider 契约）+ §5.9-B12 | 宿主唯一解析者；`config.cwd` 非空 = 请求覆盖（绝对），`''` = 不传 |
| 结算 | §5.3-B12 映射表 | `settleActivation`：先 `await result` 再 `dispose()`；映射逐条 |
| 取消 | §5.3-B12 接线表 | 前景 `exec.signal` → `dispose()`；后台 `cancel()` → abort + `dispose()` |
| 预算与冻结面 | §4.11 / §4.12 | 逐文件行数上限；测试文件逐行改动表 |
| 决策 | §7-K48..K52 | 载体盒 / cwd 保留叶 / settle 自实现 / 取消接线 / 测试改动面 |

### 三、机制设计（四个断点的落法）

1. **启动面（D3）**：`ctx.subagents.start(name, request)` → `ctx.subagents.startActivation(spec)`；`request` 类型是 `Omit<SubagentStartRequest,'label'|'signal'>`，
   宿主在调 provider 时把 `cwd` / `label` / `signal` 重新拼回（`manager.ts:498-500`）⇒ **`src/driver.mjs` 的 `request.signal` 用法不需要改**。
2. **会话号回带（D4）**：0.2.1 `receipt()` 只回 `{childId,result,dispose}`（`manager.ts:1221-1227`）⇒ 旧 `{...handle, thincoderSessionId}` **删除**。
   改为**插件私有载体盒**：工具每次委派新建 `{ sessionId: undefined }`，随 `request.thincoderCarrier` 传入；driver 在 `sessionId = established` 后写入；
   工具在 `startActivation` 返回后（含 `dispose()` 之后）读。`run.id` 保持 `randomUUID()`。
   **失败分支**：`startActivation` reject = 「会话未建立」（原错误面）；resolve 但盒空 = 「已建立但回带丢失」（`errors.mjs#carrierLost`，**不得**返回空串）。
3. **cwd（D1）**：provider 删掉 `resolveChildCwd` / `validateConfiguredCwd` 的导入与自算，只读 `request.cwd`（宿主已给绝对路径）；
   `config.cwd` 非空 ⇒ `assertUsableCwd` 后作 `request.cwd`，`''` ⇒ 不传；枚举面走 `ctx.get('workingDirectory')?.get(session)` 软取 + `header.cwd` 兜底。
4. **结算（D2）**：`settleRun` 已删 ⇒ 自实现 `settleActivation`；工具侧**必须**显式 `dispose()`（teardown 失败唯一口子），与宿主自动 dispose 共享 `close()` 事务（幂等）。

### 四、实施动作表（一行一落点）

| # | 动作 | 落点（符号优先，行号为 B12 开工现状） | 预期结果 |
|---|---|---|---|
| A1 | 删 `resolveChildCwd` / `validateConfiguredCwd` 导入与消费；导出 `resolveConfiguredCwd` | `src/provider.mjs:29-30`、`:55-63` | 导入不再抛 `SyntaxError`；`start` 只用 `request.cwd`，空则发布前拒绝 |
| A2 | 会话建立成功后写载体盒（无盒跳过） | `src/driver.mjs` 的 `sessionId = established` 之后 | `request.thincoderCarrier.sessionId` 被写入 |
| A3 | 两个可读错误 | `src/errors.mjs` 末尾 | `carrierLost(...)` / `workingDirectoryUnavailable(...)` |
| A4 | 启动调用改 `startActivation`；`label` 进 spec；请求带 `thincoderCarrier` | `src/tools.mjs:120`、`:262` | spec 形状逐字（F1） |
| A5 | `settleActivation` 替换 `settleRun`；前景/后台两处调用 | `src/tools.mjs:123`、`:267` | 映射逐条（F5）、顺序先 result 后 dispose |
| A6 | 取消接线（前景监听 / 后台 `cancel`） | 同上，`finally` 移除监听 | dispose 恰一次（F7） |
| A7 | `config.cwd` 应用 + 枚举面三路回退 | `src/tools.mjs` 委派与 lister 两处 | 空 = 不传；相对/不存在 = 零进程可读错误（F8） |
| A8 | `cwd` 叶注释口径随动 | `src/config.mjs` | 与 §3.1 表一致 |
| A9 | 本批单测 + B1/B11 逐行改 | `docs/batches/B12-…test.mjs`、`B1-…test.mjs`、`B11-…test.mjs` | §4.12 逐行表全部落地；B2/B3/B4 零改动 |

### 五、受影响文件与行数预算（基线 = 2026-10-17 `wc -l` 实测）

| # | 文件 | 动作 | 基线 | 上限 |
|---|---|---|---|---|
| 1 | `src/provider.mjs` | 删两处 helper；加 `resolveConfiguredCwd`；`start` 只用 `request.cwd` | 150 | **+≤6** |
| 2 | `src/tools.mjs` | `startActivation` 形态 + 载体盒 + `settleActivation` + 取消接线 + `config.cwd` + 枚举回退链 | 342 | **+≤70** |
| 3 | `src/driver.mjs` | 建立成功后写载体盒（无盒跳过） | 501 | **+≤8** |
| 4 | `src/errors.mjs` | `carrierLost` + `workingDirectoryUnavailable` | 165 | **+≤14** |
| 5 | `src/config.mjs` | `cwd` 叶注释口径 | 105 | **+≤3** |
| 6 | `src/index.mjs` / `connection.mjs` / `session-store.mjs` / `platform.mjs` / `stop-reason.mjs` | 不改 | 61 / 262 / 160 / 131 / 44 | **0** |
| 7 | `docs/batches/B12-dsh-subagent-thincoder-dsh-021.test.mjs` | 新增（本批单测） | 0 | **+≤260** |
| 8 | `docs/batches/B1-dsh-subagent-thincoder.test.mjs` | 逐行改（设计档 §4.12-A1..A11） | 698 | **+≤20** |
| 9 | `docs/batches/B11-dsh-subagent-thincoder-nonblocking.test.mjs` | 逐行改（设计档 §4.12-B1..B10） | 196 | **+≤25** |
| 10 | `docs/batches/B2/B3/B4-*.test.mjs` | 不改 | 140 / 159 / 129 | **0** |

### 六、与冻结面共存（本批唯一需要改测试的地方）

- **四键契约不动**：`B1:366-371` 的 `assert.deepEqual` 逐字保留；`B1:397-415` 的 `render` 入参不动；`B1:695` 的 `inject` 四项不动；`B1:315-324` 的 `jobs` 惰性不动。
- **会话选择字段不污染**：载体盒走**独立字段** `thincoderCarrier` ⇒ `B1:376/384/390/394` 与 `B11:84` 的 `request.thincoderSession` 断言**逐字不改**。
- **必须改的**：两份文件的**假件形状**（`subagents.start` → `startActivation`）、`fakeRun` → 收据、`calls[0].name` / `request.label` → `spec.provider` / `spec.label`、面 7 的三条 cwd 用例、B11 面 10 的 driver 零改动断言。
  逐行表 = 设计档 §4.12（改什么 / 为什么 / 不改会怎样）；**B2/B3/B4 零改动**（已 grep 确认不含本批被改符号）。

### 七、验收对照

| 验收 | 判据 | 本批证据面 |
|---|---|---|
| **AC-21**（新增 · 需求档） | 隔离 `DSH_HOME` + 顶层 insert 本插件行 + npx 0.2.1 的 dsh：装载无 loader 错 / preset 会话内工具可见 / 一次委派返回四键 / 默认续用同槽 / 后台形态 / cwd 随 `working_directory` 变化（a–e） | **端到端**，实施末期由父代理执行（本轮 `unverified`） |
| AC-1 / AC-8 | 装载 + 单测全绿 | `B1`（改后仍 32 例）+ 本批 `B12` 单测 + `B11` 改后全绿 |
| AC-2 / AC-3 / AC-4 / AC-5 / AC-7 | 同槽续用 / 新槽 / 显式号 / 无残留认领 / 枚举可见 | AC-21 的 b / c 两步 |
| AC-19 / AC-20 | 判据不变 | **本批只补证据**，残余面仍归台账 #34 |
| AC-6 / AC-9..AC-18 | 判据不变 | 本批不触 |

### 八、本批单测面（`docs/batches/B12-dsh-subagent-thincoder-dsh-021.test.mjs`）

| 面 | 断言（设计档 §9.7 用例号） |
|---|---|
| F1 | 70：`spec` 形状逐字（`provider` / `label` / `delivery: 'caller'` / `request` 无 `label`、`signal`） |
| F2 | 71：`dispose()` 之后仍能从盒读回会话号 |
| F3 | 72：resolve 但盒空 ⇒ 可读错误、四键不出现、后台 `failed` 带同文本 |
| F4 | 73：reject ⇒ 原错误面，**不**报成回带丢失 |
| F5 | 74 / 75：completed / aborted（有诊断 / 无诊断）/ error 的 `JobOutcome` 映射；顺序 = 先 result 后 dispose |
| F6 | 76：`dispose()` reject ⇒ `failed` 且 detail 以 `dispose failed: ` 结尾 |
| F7 | 77 / 78：前景 `exec.signal` abort ⇒ dispose 恰一次；后台启动期 / 发布后 `cancel()` 两种形态 |
| F8 | 79 / 80：`config.cwd` 非空 ⇒ `request.cwd`；空 ⇒ 无 `cwd` 键；相对 / 不存在 ⇒ 起进程前可读错误且零 `startActivation` |
| F9 | 81：枚举面三路回退（无服务 ⇒ `header.cwd`；有服务 ⇒ 服务值；全空 ⇒ 可读错误） |
| F10 | 82：两次并发委派各自的盒独立（分别写 `'A'` / `'B'`，结果不串槽） |

### 九、关键决策

设计档 §7 **K48**（载体盒，被否 A/B）· **K49**（cwd 单一解析者 + 保留叶 + `''` 与 `header.cwd` 不等价）· **K50**（settle 自实现 + 必显式 dispose）· **K51**（取消经 dispose 接线）· **K52**（冻结测试文件改动面 = B1 + B11，逐行表）。
另更正 **K5** 的共享导出清单（0.2.1 已删 `resolveChildCwd` / `validateConfiguredCwd` / `settleRun`）。

### 十、上抛项与未验面

| # | 项 | 处置 |
|---|---|---|
| 1 | **真 profile 启动未跑**（合成树只过了 `--dump-config`） | 并入 **AC-21 a**；本轮标 `unverified` |
| 2 | **preset 会话内工具可见性未观测**（只有代码面判据） | 并入 **AC-21 a**；若实测不可见 ⇒ 属装载形态问题，需另批（本批不改装配） |
| 3 | `config.cwd` **相对路径由「接受」收紧为「拒绝」** | 已在设计档 §3.1 / §5.9-B12 / K49 显式写明；影响面 = 部署形态里写了相对路径的场景（本机 profile 为 `''`，无影响） |
| 4 | 真 `dispose()` 与宿主自动 dispose 的竞争 | **已由 `close()` 幂等兜住**（`manager.ts:781-786`）；单测面 = F6 + F7 |

## §3 设计评审（评审子代理）

**状态行**：评审完成（2026-10-17 · **轮次 0 = 父代理自评**）

> **作者归属与「自评」性质（据实标注）**：本节由**主 agent**落笔，是**设计者自查**，**不是**独立评审。
> 理由同 §2（本轮委派正文禁止派内层子代理；`batch` 工具按段白名单把 §3 判给评审子代理，故经**文件直改**落盘）。
> **独立评审仍然欠着**：用户发起 advisor 设计评审后，其结果将以「轮次 1」追加到本节末尾，**不改写**本节（本节保留为自评记录）。

### 轮次 0（父代理自评 · 逐条发现）

| # | 级 | 位置 | 发现 | 处置 |
|---|---|---|---|---|
| 1 | 🔴 | 设计档 §5.3-B12「request 不带 `label`/`signal`」 | 原表述会让人以为 **provider 拿不到 `signal`** ⇒ 取消链断（`src/driver.mjs` 一直读 `request.signal`）。 | **Fixed**：核实宿主在调 provider 时把 `cwd`/`label`/`signal` 拼回（`manager.ts:498-500`）⇒ §5.3-B12 补「宿主拼回」句 + §2 三.1 同步；驱动既有信号用法**不需要改**。 |
| 2 | 🔴 | 设计档 §5.2「写入时机」 | 未证 `startActivation` 是否**等到 provider 建立完成**才 resolve —— 若不等，工具会误报「已建立但回带丢失」。 | **Fixed**：核实 `index.ts:214`（`startExternal: (name, request) => provider.start(request)`）+ `manager.ts:498`（`start(signal)` 被 await）⇒ §5.2 补时序保证句；用例 72 只覆盖真丢失。 |
| 3 | 🔴 | 设计档 §5.3-B12 取消接线 | 「取消 ⇒ `dispose()` ⇒ 再 `await result`」是否会**永挂**没有证据（`result` 若只在自然结束时 settle，取消路径就死等）。 | **Fixed**：核实 `settleRunResult` 的 `parts.cancelled()` 分支直接返回 `{ output, stopReason:'aborted' }`（`out-of-process.ts:150-165`）⇒ §5.3-B12 补「反方向保证」句；单测面 = F7。 |
| 4 | 🟡 | 设计档 §9.7 / §2 单测面 | 载体盒的**并发隔离**没有用例：两次委派若串用同一盒，会话号会互相覆盖（静默、难查）。 | **Fixed**：§9.7 增用例 **82**（两路并发、分别写 `'A'`/`'B'`）+ §2 单测面 **F10**。 |
| 5 | 🟡 | 设计档 §5.9-B12 枚举回退链 | `workingDirectory.get(...)` 的**入参形态**（Session 对象 or 会话号）与 `assertUsableCwd` 的**签名**未钉死 ⇒ 实现侧可能猜错。 | **Fixed**：补 `get(session: Session): string`（`tool-working-directory` 同族 API，`packages/session/working-directory/src/index.ts:122-124`）与 `assertUsableCwd(prefix, label, cwd): string`（`out-of-process.ts:104-112`）两处签名，并写明两条错误文本由工具侧包装。 |
| 6 | 🟡 | 需求档 AC-21 判定面 e | `working_directory({ cd })` 的**工具名**未核实 —— 名字写错 AC-21 e 就不可执行。 | **Not an issue**（带证据）：模型面工具名确为 `working_directory`，`packages/session/tool-working-directory/src/index.ts:21`（含 `cd` 参）；需求档一行不改。 |
| 7 | 🟡 | 设计档 §4.12-B10 | 把 B11 面 10 的 `git diff` 断言「收窄」只写了「不改会红」，**没写凭什么是合法处置**（容易被读成绕过冻结纪律）。 | **Fixed**：§4.12 补「性质说明」—— 该断言是 **B11 批的范围主张**，不是永久不变式；B12 另立批次并显式登记 driver 改动面 ⇒ 收窄正确，`.md` 正文仍一字不改。 |
| 8 | 🟡 | 设计档 §5.9-B12「`''` ⇒ 父会话当前目录」 | 漏了**目录消失时**宿主的行为：`ensure()` 会发现当前目录没了并**自动恢复到原始项目目录**（`working-directory/src/index.ts:135-146`）⇒ 委派将落在恢复后的目录，而不是报错。 | **Fixed**：§5.9-B12 补该分支（「目录消失 ⇒ 宿主恢复到原始项目，不是报错」），并写明这与旧 `header.cwd` 的差异面。 |
| 9 | 🔵 | 设计档 §7 K5 注 | 「`settleRunResult` 仍可用」需可核。 | **Not an issue**（带证据）：`out-of-process.ts:150` 仍导出该函数；本批只自实现 `settleActivation`，不碰它。 |
| 10 | 🔵 | 批次档 §1 行数基线 / 设计档 §4.11 第 14 行 | `需求档 264`（开工值）与落笔后实测不一致；§4.11 写的 `308` 与实测 `307` 差一行（计数时点问题）。 | **Fixed**：§1 基线行改记「开工值 → 落笔后实测」双读数；§4.11 第 14 行改 **307**（内容落定后量取）。 |

**VERDICT（轮次 0）**：无未决项 —— 🔴 **3** / 🟡 **6** / 🔵 **2**，除两条带证据判为「不是问题」外，其余**当轮改完**（改动全部落在设计档与服务性文字，`src/**` 零改动）。
**欠账**：独立评审（advisor）**尚未发起**，由用户点发；届时以「轮次 1」追加。

### 轮次 1（评审子代理）

| # | Category | Severity | Issue | Suggestion |
|---|----------|----------|-------|------------|
| 1 | Lifecycle / Cancellation | 🔴 | 后台取消存在未闭合的发布窗口：文档声明启动后调用方 signal 不再连到 run（docs/design/DESIGN-dsh-subagent-thincoder.md:625），但 cancel 在 activation 尚未赋值时只 abort（docs/design/DESIGN-dsh-subagent-thincoder.md:988）；await 返回赋值后立即读盒、等待结算，没有补查 controller 已取消状态（docs/design/DESIGN-dsh-subagent-thincoder.md:992、docs/design/DESIGN-dsh-subagent-thincoder.md:999）。因此“宿主已脱离启动信号、收据尚未交回”期间发生取消时，设计没有给出最终 dispose 的保证；宿主是否保证该窗口绝不存在为 unverified。另 docs/design/DESIGN-dsh-subagent-thincoder.md:621 与 docs/design/DESIGN-dsh-subagent-thincoder.md:623 对 dispose 先于等待 result 是否会挂起给出相反说明。 | 明确正常结算与取消各自的时序；收据取得后补齐已经取消的处置，或提供宿主对该窗口的排除保证。用受控 Promise 覆盖启动末期取消、随后返回收据的交错，验证清理完成且 done 有终态。 |
| 2 | Requirements / Cleanup | 🔴 | 回带丢失路径没有守住显式 dispose 的错误暴露要求。需求要求工具必须显式 dispose，以暴露 teardown 失败（docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:166）；结算表也要求将 dispose 拒绝并入 failed detail（docs/design/DESIGN-dsh-subagent-thincoder.md:619）。但后台的缺盒分支明确吞掉 dispose 拒绝后只返回 carrierLost（docs/design/DESIGN-dsh-subagent-thincoder.md:1001、docs/design/DESIGN-dsh-subagent-thincoder.md:1002）；前景则规定直接抛 carrierLost，却没有说明该提前退出如何进入清理（docs/design/DESIGN-dsh-subagent-thincoder.md:639）。 | 将取得 activation 后的所有退出路径纳入统一清理责任，并保留回带错误与清理错误两项诊断。增加前后台“缺盒且 dispose 拒绝”的验证，明确不会绕过清理或丢失清理失败。 |
| 3 | Requirements / Failure Classification | 🟡 | “未建立”与“已建立但回带丢失”的完整性尚未证明。分类表把 startActivation 抛出一律当作未建立，并禁止读盒（docs/design/DESIGN-dsh-subagent-thincoder.md:537），但会话建立、写盒发生在返回收据之前（docs/design/DESIGN-dsh-subagent-thincoder.md:528、docs/design/DESIGN-dsh-subagent-thincoder.md:530）。文档没有证明建立成功后至收据发布之间绝不会再拒绝；该宿主保证为 unverified。单一 sessionId 字段也无法独立证明空盒意味着已经建立。 | 给出建立后至收据发布的失败边界，明确建立状态的可靠观测依据；补充建立成功后、收据返回前发生错误或取消的用例，避免仅以 Promise resolve/reject 推断是否建立。 |
| 4 | Acceptance Coverage | 🟡 | §8 宣称 AC-21 b/c 已串起 AC-2/3/4/5/7（docs/design/DESIGN-dsh-subagent-thincoder.md:1428），但 b/c 只要求一次新建及一次默认续用、比较返回号（docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:220、docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:221）。其中没有显式 sessionId 调用、枚举调用，也没有 AC-2 要求的槽文件消息增长证据（docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:189）。返回同号本身也不能排除文档已承认的静默 fork（docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:93）。 | 补列这些回归面的实际操作与证据，或将未覆盖项明确保留为独立回归。续用步骤明确前景参数，避免默认后台返回 jobId 后无法直接比较 sessionId。 |
| 5 | Acceptance Feasibility | 🟡 | AC-21 的隔离 profile 仍缺可复现的准备细节：配方列出 base/web bundles 与本仓 link，却没有给出两个 bundle 的版本及依赖如何就位（docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:215）；要求 preset 会话工具可见，却未指定 preset 与建会话方式（docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:219）。从部署 patch 复制模型路由后，隔离 DSH_HOME 下其凭据与引用是否仍可用也是 unverified（docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:217）。dump-config 自检仅规定检查合成树中的插件行（docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:218）。 | 补齐依赖准备、版本核验、preset 会话创建及隔离环境路由/凭据自检步骤；将装载、模型可调用、工具可见分别验收，并明确 cwd 项的实际目录观测证据。 |
| 6 | Closest Precedent | 🟡 | 已有最近先例块明确服务于 K34 的后台方案（docs/design/DESIGN-dsh-subagent-thincoder.md:1375），B12 的 K48–K52 虽给机制坐标与备选理由（docs/design/DESIGN-dsh-subagent-thincoder.md:1354、docs/design/DESIGN-dsh-subagent-thincoder.md:1358），没有补齐本次迁移对应的“实现坐标 ∥ 设计章节 ∥ 先例批次 + 对齐/偏离”行。cwd 保留叶的理由说明了 P2 与配置兼容（docs/design/DESIGN-dsh-subagent-thincoder.md:846），却未明确点名所调查的官方升级指南及其退役形式为何不适用；指南在需求档仅作事实来源（docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:271）。 | 为 B12 补齐最近先例坐标；逐项说明沿用及偏离，明确引用已调查的官方 cwd 迁移形式及不适用原因。没有对应先例的部分显式声明无先例。 |

计数：🔴 2；🟡 4；🔵 0。
VERDICT: changes-required

### 轮次 1 的父代理裁定（主 agent · 当轮落地）

| # | 级 | 位置（评审坐标） | 评审意见 | 我的裁定 | 落地 |
|---|---|---|---|---|---|
| 1 | 🔴 | `DESIGN:625` / `:988` / `:992` / `:999` / `:621` / `:623` | 后台取消的发布窗口未闭合；且两处对「先 dispose 是否挂起」说法相反 | **接受**（两个子问题都成立） | 设计档 §5.3-B12 后台取消行补**收据返回后补检** `if (controller.signal.aborted) void activation.dispose()`；顺序段整段重写为「理由 = 归因，不是防挂」并注明「评审号 1 的相反说明在此收正」；§5.11 `done` 代码加同一补检；新增用例 **83**（受控 Promise 构造该交错） |
| 2 | 🔴 | `REQ:166` / `DESIGN:619` / `:1001` / `:1002` / `:639` | 缺盒分支吞掉 dispose 错误，与「显式 dispose 暴露 teardown 失败」冲突；前景早退绕过清理 | **接受** | §5.3-B12 改为**盒空 = 一种 outcome**：`settleActivation({activation, carrier})` 统一 = result → dispose → 验盒 → 组装；detail 同时保留 `<回带丢失> \| dispose failed: …`；前景面在该 outcome 之后才抛错（清理已完成）；§5.11 代码改为单一清理口；新增用例 **84** |
| 3 | 🟡 | `DESIGN:537` / `:528` / `:530` | 「未建立」与「已建立但回带丢失」的完整性未证 | **部分接受** | **接受**：第一行文本改「启动未完成（宿主已回滚）」并写明可观测面无法区分建立后被回滚；需求档 P12 同步该口径。**部分不接受**：「resolve ⇒ 已建立」这条推断本身成立 —— `receipt()` 是 `this.receipt(activation)`（`manager.ts:483-512`），没有物化就不可能有收据 ⇒ 空盒只能落在「已建立」一侧，**不需要**多字段证明（记为带证据的收正） |
| 4 | 🟡 | `DESIGN:1428` / `REQ:220` / `:221` | §8 声称 b/c 已串起 AC-2/3/4/5/7 属过度声称；c 步骤未写显式前景参数 | **接受** | §8 改「b / c / f / g 四步 + 其余判据面仍以各自证据为准，不替代」；需求档 AC-21 新增 **f（显式 `sessionId` 接回 + 引用上轮内容）**、**g（枚举 + 槽文件消息增长）**，并把 c / d 的参数写死（显式 `run_in_background: false`） |
| 5 | 🟡 | `REQ:215` / `:217` / `:218` / `:219` | 隔离 profile 缺版本核验、依赖就位、preset 建会话与凭据自检；a 项三件事混判 | **接受** | 需求档 AC-21 重写为 **0（工具链 + 三包版本核验 + 依赖符号链接与 `require.resolve`）/ 0.1（隔离根 + 路由/凭据自检，含「读不到就如实报、不得改 `~/.dsh/profiles/web/`」）/ 0.2（preset 与会话创建）/ a1–a3 分开判 / b / c / d / e（**`pwd` 双组对照**，单次成功不算证明）/ f / g** |
| 6 | 🟡 | `DESIGN:1354` / `:1358` / `:1375` / `:846` / `REQ:271` | B12 缺「最近先例坐标；对齐/偏离」；cwd 保留叶未点名所偏离的升级形式 | **接受** | 设计档 §7 新增**注③**：实现坐标（`manager.ts:483-512` / `index.ts:214` / `resolveDirectory` / `subprocessRunHandle`）+ 本仓镜像章节 + 先例批次（B1 / B11，其余**显式声明无先例**）+ 两处偏离（① `config.cwd` 保留而非按升级说明退役，来源=委派正文转述的升级说明；② 会话号走私有载体盒，官方无先例） |

**裁定小结**：🔴 2 全接受并当轮落地；🟡 4 全接受（#3 一半带证据收正）；**0 条不接受、0 条遗留**。
`src/**` 仍**零改动**；改动只在设计档 / 需求档（当前设计相）。
**下一步**：请用户点发**轮次 2**（收敛轮 —— 只验本表的落地项），或直接进入批准（§4）。

### 轮次 2（评审子代理）

本轮仅核验六项裁定的落地；已完整读取两份范围内文档，未读取 src/** 或其他文件。

| 裁定项 | 核验结果 | 证据与理由 |
|---|---|---|
| ① 后台取消发布窗口 | 已落地 | `docs/design/DESIGN-dsh-subagent-thincoder.md:641` 要求收据返回后补检；`:1034` 的 run 体实际列出 `controller.signal.aborted` 补检并调用 dispose。`:630`–`:633` 将先 result 后 dispose 的理由明确为终态与错误归因，并明确两种顺序都不会挂。 |
| ② 回带丢失与清理错误 | 核心修复已落地，但接入有冲突 | `docs/design/DESIGN-dsh-subagent-thincoder.md:658`–`:667` 在同一结算口等待 result、捕获 dispose 失败、随后验盒并合并 detail；`:671` 明确前景完成清理后才抛错；`:1611` 覆盖前后台缺盒与 teardown 同时失败。后台调用后的会话号发布时点仍存在下表发现 1。 |
| ③ 启动失败归因 | 已落地 | `docs/design/DESIGN-dsh-subagent-thincoder.md:542` 首行已为启动未完成，`:548` 明确统一使用“启动未完成（宿主已回滚）”且无法区分是否曾建立；`docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:163`–`:164` 同样禁止声称会话根本没建立。 |
| ④ AC-21 覆盖与旁证定位 | 部分落地 | `docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:245` 的 c 已显式前景，`:252` 的 d 已显式后台；`:247`–`:250` 已补 f/g，但 f 未显式前景。`docs/design/DESIGN-dsh-subagent-thincoder.md:1483` 已明确旁证“不替代”原验收。 |
| ⑤ AC-21 可执行前置与 cwd 对照 | 部分落地 | `docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:214`–`:241` 已列工具链、隔离 profile、路由凭据、会话 preset 与 a1–a3 分判；`:254`–`:255` 已列两组 pwd 对照，但未固定前景返回，见发现 2。上述环境步骤尚未实际执行，其环境可用性为 unverified。 |
| ⑥ 最近先例与决策理由 | 已落地 | `docs/design/DESIGN-dsh-subagent-thincoder.md:1412`–`:1421` 的注③列出实现、镜像章节、先例批次、无先例声明及偏离理由；`:1423`–`:1434` 的注④逐项承接 K48–K52 的理由。 |

| # | Category | Severity | Issue | Suggestion |
|---|----------|----------|-------|------------|
| 1 | 第②项落地 / 机制一致性 | 🔴 | 后台接入把会话号发布推迟到结算清理之后：`docs/design/DESIGN-dsh-subagent-thincoder.md:1035` 先 await settleActivation，`:1037` 才 job.append；而该函数在 `:658` 等待 result、`:661` 等待 dispose。因此执行期间不会发布会话号，与 `:1048` 所述执行期间可读及 `:155`–`:156` 的先发布后结算机制冲突。清理错误保留虽已修复，接入仍未闭合。 | 保留统一结算与诊断合并，在取得收据且载体有效后发布会话号，空载体仍进入统一清理；统一 run 体、数据流与回报时序说明，并用受控未结算 result 验证会话号已可读。 |
| 2 | 第④⑤项落地 / 验收可执行性 | 🟡 | f 的显式接回配方（`docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:247`）及 e 的两组 pwd 配方（`:254`–`:255`）均未固定前景参数。默认后台由 `:145` 明确规定，后台返回 job 号由 `:80`–`:81` 定义；照配方执行可能只拿到 jobId，不能直接比较同号或 pwd 文本。 | 为 f 及 e 的两组委派显式指定前景参数，或完整定义各自等待 job 完成、读取会话号与答复再比较的步骤；g 的枚举工具无需增加委派参数。 |

计数：🔴 1 · 🟡 1 · 🔵 0。
VERDICT: changes-required

### 轮次 2 的父代理裁定（主 agent · 当轮落地）

| # | 级 | 位置（评审坐标） | 评审意见 | 我的裁定 | 落地 |
|---|---|---|---|---|---|
| 1 | 🔴 | `DESIGN:1035` / `:1037` / `:658` / `:661` / `:1048` / `:155` | 后台接入把会话号发布推迟到结算清理之后：先 `await settleActivation`（等 result + 等 dispose）才 `job.append` ⇒ **执行期间读不到会话号**，与「执行期间即可读回」及数据流「先发布后结算」冲突（这是我上一轮修 🔴2 时引入的回归，评审抓得准） | **接受**（我把统一清理口错接到了发布之前） | `DESIGN` §5.11 `done` 改回**先发布后结算**：收据到手 ⇒ 补检 aborted ⇒ **立即** `job.append`（盒有效才写）⇒ 再走 `settleActivation`（权威验盒 + 唯一清理口，盒空仍不跳过 dispose）；§5.3-B12 后台条同步写明「发布在收据返回时、清理在之后」，两者职责分开 |
| 2 | 🟡 | `REQ:247` / `:254-255` / `:145` / `:80-81` | f 的显式接回、e 的两组 `pwd` 都没固定前景参数 ⇒ 默认走后台只回 `jobId`，比不了号 / 拿不到答复 | **接受** | 需求档 AC-21：f 的调用补 `run_in_background: false`；e 的两组调用都写明 `run_in_background: false`，并加一句「否则默认走后台、只回 `jobId`，拿不到答复文本」；g（枚举工具）无需增参 |

**裁定小结**：🔴 1 + 🟡 1 **全部接受并当轮落地**；**0 条不接受、0 条遗留**。`src/**` 仍零改动。
**收敛状态**：轮次 2 = changes-required，**未收敛**（按用户指令：不自行宣布收敛、不伪造 token）；修复已落盘但**未经第三轮复验**。
**下一步（待用户点发）**：轮次 3（只验本轮 2 条的落地）—— 或由用户裁定直接批准（那样须在 §4 如实记录「批准时评审结论为 changes-required、修复未经复验」）。

### 轮次 3（评审子代理）

本轮仅复验指定的两个剩余问题；两份范围内文档已全文读取，未重审已通过的六条。

1. **后台发布时序：通过，有一项图示补充建议。** `done` 在收据返回与取消补检之后读取盒，只在非空字符串时发布会话号，随后无条件调用同一个 `settleActivation`（docs/design/DESIGN-dsh-subagent-thincoder.md:1035、docs/design/DESIGN-dsh-subagent-thincoder.md:1038、docs/design/DESIGN-dsh-subagent-thincoder.md:1040）。这与后台契约的早发布、盒空不写环且不跳过 dispose 一致（docs/design/DESIGN-dsh-subagent-thincoder.md:672、docs/design/DESIGN-dsh-subagent-thincoder.md:673）；统一结算体也先取 result、再 dispose、后验盒（docs/design/DESIGN-dsh-subagent-thincoder.md:658、docs/design/DESIGN-dsh-subagent-thincoder.md:661、docs/design/DESIGN-dsh-subagent-thincoder.md:664）。数据流图的发布也排在等待 result 之前（docs/design/DESIGN-dsh-subagent-thincoder.md:155、docs/design/DESIGN-dsh-subagent-thincoder.md:156），但省略有效性条件，见建议 1。先 result 后 dispose 的理由明确为真实终态与错误归因，并明确不是防挂（docs/design/DESIGN-dsh-subagent-thincoder.md:630、docs/design/DESIGN-dsh-subagent-thincoder.md:632、docs/design/DESIGN-dsh-subagent-thincoder.md:633）。
2. **AC-21 前台调用：通过。** f 显式接回已带 `run_in_background: false`（docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:247）；e 的 X 目录调用带同一参数，对照组要求同一调用、prompt 不变，并明确两组都必须传 false，说明否则默认走后台、只回 jobId（docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:254、docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:255、docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:256）。默认后台与 false 返回前台结果的通用依据也已明确（docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:145、docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:149）。

| # | Category | Severity | Issue | Suggestion |
|---|----------|----------|-------|------------|
| 1 | Clarity | 🟡 | 数据流图直接画 `job.append`（docs/design/DESIGN-dsh-subagent-thincoder.md:155），未标出正文与 done 体已明确的“仅盒有效才发布”。时序一致，未出现相反的分支定义，但单读图时异常路径不够明确。 | 在现有发布行补充有效性条件，并提示盒空仍进入下一步统一结算；可等行改写，净增 0 行，无需新增流程节。 |
| 2 | Scope / 行数预算（事实 + 建议） | 🔵 | 设计档正文末行坐标为 docs/design/DESIGN-dsh-subagent-thincoder.md:1889，读取工具另显示末尾空分段；按本轮给定的 1889 行口径，上限 1895、余 6 行。申报依据为 docs/design/DESIGN-dsh-subagent-thincoder.md:438、docs/design/DESIGN-dsh-subagent-thincoder.md:443。 | 建议 1 可净增 0 行完成，不会顶破预算；若采用另行补注，净增不超过 6 行也仍在预算内。更大改动可在下列三个候选中显式选择，不自动视为已获准。 |

预算候选的事实依据与建议：

| 候选 | 事实依据 | 建议 |
|---|---|---|
| 调预算上限 | 当前为 1535 + 360 = 1895（docs/design/DESIGN-dsh-subagent-thincoder.md:443）；文档也记录过据实调高预算的处理（docs/design/DESIGN-dsh-subagent-thincoder.md:400、docs/design/DESIGN-dsh-subagent-thincoder.md:401）。 | 若必要内容净增超过 6 行，列明实际增量及余量后再调整申报；本轮图示补注本身无此需要。 |
| 压缩别处 | 本次问题可在既有图示发布行内补足（docs/design/DESIGN-dsh-subagent-thincoder.md:155）；预算理由要求不删内容凑估算（docs/design/DESIGN-dsh-subagent-thincoder.md:444）。 | 优先等行补注；如需腾行，只合并空白或重复表达，保留有效性条件、统一清理和归因理由。 |
| 接受超预算 | 现行申报明确为 ≤1895（docs/design/DESIGN-dsh-subagent-thincoder.md:443），并未声明可自动超出。 | 可以作为另行显式接受的选择；未作该接受前，超过 1895 却宣称“符合现预算”不成立。本轮没有必要依赖此候选。 |

行宽仅作范围说明：按随请求提供的 §6.1.1，码点判据与字节观察是不同口径，两种读数并列不构成矛盾。本轮未读取范围外文件、未执行行宽重测；76 / 3 的当前实测值为 unverified，两份评审文档中也未找到对应的当前行宽自报数字，不将这些数字作为本轮批准依据。

计数：🔴 0；🟡 1；🔵 1。两个指定复验点通过，无阻断项。
VERDICT: pass

### 轮次 3 的父代理裁定（主 agent · 当轮落地）

| # | 级 | 位置 | 评审意见 | 我的裁定 | 落地 |
|---|---|---|---|---|---|
| 1 | 🟡 | `DESIGN:155` | 数据流图只画 `job.append`，未标「仅盒有效才写」；单读图时异常路径不明确（时序本身无误） | **接受** | `DESIGN:155` 等行改写：`→ job.append('[thincoder session] <id>')  // 盒有效才写（空盒不写环）；执行期间即可读回` —— **净增 0 行**（原行替换），语义与 `done` 体一致 |
| 2 | 🔵 | `DESIGN:1889` / `:438` / `:443` | 预算事实 + 三条候选（调上限 / 压缩 / 接受超预算），不作决定 | **记录，不采纳任何候选** | 现状 = **1889 / 上限 1895（余 6）**；本轮修正净增 0 ⇒ **无需动用任何候选**。余量 6 行在实施期如有需要，按「先列明实际增量与余量、再调申报」处理（`DESIGN:443` 的既有口径） |

**裁定小结**：🟡 1 当轮改完（净增 0 行）；🔵 1 为事实+建议，已记录。
**收敛状态**：**approved**（`VERDICT: pass`）—— 评审子代理签发 designToken，已交用户；**token 值不进任何文件**（本档只记「已签发」）。
**评审未做的两件事（据实标注）**：① 未重测行宽（它把 76 / 3 标为 `unverified`，不据以批准 —— 正确做法）；② 未读 `docs/STANDARDS.md`（不在它的文件类型射程内，工具层已拒；§6.1.1 由父代理自检）。

## §4 用户批准（主 agent）

> **补写说明（偏差登记 · 2026-10-18）**：本段在原收口时**空缺**（主 agent 先 `close`、后写 §4，操作顺序失误）。经用户 2026-10-18 明确授权「你补写吧」，**仅补写本段内容**，其余各段一字未动。
> 这是 `docs/STANDARDS.md` §4.3「已 `close` 冻结的批次档不回改」的**一次经授权的偏差**，性质 = **操作顺序失误的补救**，**不是判据豁免**，不得作为后续破例的先例加以援引。
> 补写日期晚于 `close` 日期，故本段系**事后追记**（内容为当时已发生的批准事实，无新增裁定）。

**状态行**：用户已批准（2026-10-18）。

### 一、批准的对象与依据

| 项 | 内容 |
|---|---|
| 批准对象 | 设计档 `docs/design/DESIGN-dsh-subagent-thincoder.md`（设计相）+ 本批 §2 设计 |
| 批准前提 | §3 轮次 3 独立设计评审 `VERDICT: pass`（`B12 档:302-336`） |
| designId | `3908199c-0f05-41cf-bc26-53042be3d65a` |
| designToken | 已签发（有效至 2026-10-24）；**值不入档**（本档只记「已签发」，见 §6 十） |
| 发起方 | 用户点发实施（2026-10-18） |

### 二、批准时用户明示的三项裁定

| # | 裁定内容 | 时点 |
|---|---|---|
| 1 | **D1–D5 全采纳**（按父代理建议的 ① 方案；其中 D4 = 失败抛错） | 2026-10-18 |
| 2 | **预算调申报不压缩**（`tools ≤414` / `errors ≤185` / `B12 单测 ≤281`） | 2026-10-18 |
| 3 | **AC-21 接受 `unverified` 收口**（凭据不可达；转升级后真实会话验证） | 2026-10-18 |

### 三、批准时的评审状态（据实记录）

批准发生在**轮次 3 已 `pass`** 之后，与「先批准、后评审」的形态不同：本批是**评审先收敛、用户后批准**。故不存在 §3 轮次 2 遗留的「批准时 verdict = changes-required」瑕疵。

### 四、落地指路（内容不在本段复述）

三项裁定的落地与证据见 **§6 一**（D1–D5 逐条）、**§6 四**（预算调整）、**§6 三**（AC-21 定格）。本段只记录「谁在什么时候批准了什么」。

## §5 实施记录（eng-coder）

**状态行**：实施完成（2026-10-17；`src` 五文件落地 + B12 单测 9 组全绿；B1/B11 冻结测试的逐行改动被跨批写门拒绝；两处表外发现上抛待裁）

## 一、动作表（§2 A1–A9 逐条）

| # | 动作 | 落地 | 位置 |
|---|---|---|---|
| A1 | `resolveDelegationCwd` → `resolveConfiguredCwd` | ✅ | `src/provider.mjs:56`（非空才 `assertUsableCwd(PREFIX,'config cwd',…)`）；`src/provider.mjs:127` 空 `request.cwd` 发布前拒绝 |
| A2 | 启动调用改 `startActivation(spec)` 五键 | ✅ | `src/tools.mjs:296-302`（`provider`/`label`/`request`/`signal`/`delivery:'caller'`）；`request` 无 `label`/`signal` |
| A3 | 自建载体盒 + driver 写盒 | ✅ | `src/tools.mjs:153`、`:320`；`src/driver.mjs:348`（`established` 赋值之后写，无盒跳过） |
| A4 | 回带判定 = 读盒 | ✅ | `src/tools.mjs:110-113`（`''`/非字符串一律按丢失） |
| A5 | 盒空可读错误 | ✅ | `src/errors.mjs:168`、`:171`；`src/tools.mjs:330` |
| A6 | `settleActivation`（result→dispose→验盒→组装） | ✅ | `src/tools.mjs:100-115` |
| A7 | 取消接线（前景 listener + 补检 + finally；后台 cancel=abort+dispose、收据后补检） | ✅ | `src/tools.mjs:324-338`、`:156-172` |
| A8 | cwd 三路回退 + 枚举改用 `workingDirectory` 投影 | ✅ | `src/tools.mjs:398-403`；`src/errors.mjs:176` |
| A9 | B12 单测新建 + B1/B11 逐行修改 | ⚠️ 部分 | B12 单测已建（`docs/batches/B12-dsh-subagent-thincoder-dsh-021.test.mjs`，260 行，用例 70–84 全覆盖）；**B1/B11 未落地——写门拒绝**（见三） |

## 二、验收读数（实测）

0.2.1 探针树 = `.thincoder/tmp/b12-run/`（`src` + 单测副本，`node_modules` 软链到 0.2.1）；仓库树 = 0.2.0。

| 项 | 读数 |
|---|---|
| B12 单测（0.2.1） | **9 组 / 9 pass / 0 fail**（覆盖设计用例 70–84 与 F1–F10；用例 74/75 与 76 合并、77/78 合并） |
| B2（0.2.1） | 6 tests，5 pass，1 skipped（= 设计读数） |
| B3（0.2.1） | 10 pass（= 设计读数） |
| B4（0.2.1） | **6 pass / 1 fail** —— 表外发现，见四-③ |
| B1（0.2.1 与仓库树） | 0 pass / 1 fail（链接期：`resolveDelegationCwd` 已删，冻结测试仍导入） |
| B11（0.2.1 与仓库树） | 3 pass / 6 fail（假件仍用 `subagents.start`；面 10 仍断言 `driver.mjs` 零 diff） |
| import 冒烟（0.2.1） | `index.mjs` → `name='dsh-subagent-thincoder'`、`inject=['tools','subagents','subprocess','storageDomain']`；`tools`/`provider` 均可导入，`resolveConfiguredCwd: function`、`resolveDelegationCwd: undefined` |
| 逐文件行数（基线→现值，上限） | config 105→107（+3）✅ · provider 150→151（+6）✅ · tools 342→412（+70）✅ 触顶 · driver 501→505（+8）✅ · errors 165→179（+14）✅ 触顶 · B12 单测 260（260）✅ 触顶 |
| `git diff --stat -- src/` | 5 文件，+158 / −67（净 +91 = 各行增量之和） |
| 冻结代码文件 | `index.mjs`/`connection.mjs`/`session-store.mjs`/`platform.mjs`/`stop-reason.mjs` 零 diff ✅ |
| B2/B3/B4 测试文件 | 零 diff ✅ |
| 设计档 / 需求档 | 零改动（本次未写；工作区里那两个文件的 diff 是本批**设计阶段**留下的，行数仍为 1889 / 343，与 §1 记载一致） |
| AC-21 非交互前置自检 | **未就绪**：隔离 `DSH_HOME`（`.thincoder/tmp/b12-dsh-home`）不存在，profile `b12` 无从谈起——按任务书未自造 |

## 三、审计与代码评审（轮次与终态）

1. **内部一致性审计（explore，只读，1 轮）**：`DEVIATIONS ×2` —— 其一为已声明的写门阻断（B1/B11），其二为「`disposed === 1` 测不到有效双拆」。后者已修：用例 77/78/83 改为断言 `[disposeCalls, disposed]` 的具体值（取消路径 2 次调、1 次有效；仅结算路径 1 次），并把用例 83 的 dispose 覆盖为「不结算 result」，从而证明**会话号在执行中已发布**。
2. **代码评审（advisor，2 轮）**：round 1 = `changes-required`（🔴×1、🟡×4）。
   - #2 `dispose` 以 `undefined` 拒绝会被漏判 → **已修**（`src/tools.mjs:105-108`：拒绝标志与拒绝值分离，任何拒绝值都转 failed）。
   - #3 F10 并发用例无法识别共享盒 → **已修**（捕获两次 `carrier` 引用并 `notEqual`，两次写盒用栅栏对齐后才允许结算）。
   - #4 缺「result 仍 pending 时会话号已可读」的断言 → **已修**（用例 83）。
   - round 2 复核：#2/#3/#4 判 `Fixed`；#1、#5 保持未解，处置见四-①/②。
3. **终态：`stalled`** —— 代码面与自建测试全绿，但存在 1 项外部阻断（写门）+ 4 项待裁发现（四）。fix round 共 2 轮（审计 1 + 评审 1），无「改完又红」。

## 四、上抛（不自行裁定）

① **[上抛·待裁] 前景四键无失败原因通道**（评审 round 1 🔴）：`dispose` 拒绝与 `result` 拒绝时，`settleActivation` 把原因写进 `outcome.detail`，但前景只回四键（`text`/`sessionId`/`stopReason`/`status`），`render` 在有答复时只显示答复+会话号 ⇒ 原因对调用方不可读。四键是冻结契约（B1:388-395），把原因塞进 `text` 或改 `render` 都属表外改动，我未动。设计档 §5.3-B12 只规定 `status: 'failed'`，**未给 detail 出口**——属设计缺口。
② **[上抛·待裁] 生产 `driver` 写盒无测试覆盖**（评审 #5）：B12 单测的假件自行写盒（`B12…test.mjs:60`、`:210`），真实 `src/driver.mjs:348` 未被任何测试执行；把该行删掉/写错，现有用例不会红——而 B12 修的正是这个断点。补 driver 级用例需约 35 行，**超出单测 260 行上限**（设计 §4.11），故未补。
③ **[上抛·待裁] B4 用例 43 与 0.2.1 契约冲突**：该用例调 `provider.start({prompt,signal,parent})`（无 `cwd`），0.2.1 下 provider 按 §5.1 在发布前拒绝 ⇒ **B4 6/7**。§4.12 声明「B2/B3/B4 零改动」，grep 确实不含被删符号，但这条**调用形态**的冲突表里没有。修法二选一：补 fixture 的 `cwd`（改冻结测试）∥ 放开 provider 的 cwd 校验（违 §5.1）。我未动。
④ **[上抛·待裁] B1 的能力枚举断言**：`B1:486-499` 硬编码 0.2.0 五键（含 `toolFilter`/`persona`），0.2.1 实测四键 `{agentOptions,agentPreset,outputSchema,depthLimit}`。§5.1 已写四键口径，但 §4.12 表无此行，任务书禁止表外改测试 ⇒ 我未动。若批准，改法是把期望对象换成四键之一行。
⑤ **写门阻断（事实，非请求）**：`edit` 对 `docs/batches/B1-dsh-subagent-thincoder.test.mjs` 与 `docs/batches/B11-dsh-subagent-thincoder-nonblocking.test.mjs` 均返回「cross-batch batch-record write … bound to B12…」。§4.12 的 A1–A11 / B1–B10 因此**全部未落地**，需父侧另起一批或由父代理直接改。

## 五、实现披露（与设计文本的差异，行为不冲突）

1. `settleActivation` 返回 `{ sessionId, result, outcome }`，设计 §5.3-B12 的钉子片段只写 `{ sessionId, outcome }`——`result` 是前景四键取真实 `stopReason`/`text` 所需。
2. `aborted` 且有诊断的 detail 统一为 `aborted: <诊断>`（设计只写 `{status:'failed', detail}`）；`error` 等其它非完成原因同形 `<stopReason>: <诊断|'no diagnostic'>`。
3. 盒空与 dispose 失败的 detail **合成**为 `<回带丢失> | dispose failed: <原因>`（前置），两段都不丢；前景在清理完成后才抛。
4. `config.cwd` 的 `''` 语义：请求里不带 `cwd` 键（由宿主取当前目录），**与旧 `header.cwd` 回退不等价**——已写进 `src/config.mjs` 的叶子注释。
5. `configuredCwd` 的报错在 seam 原文后追加一句可执行提示（`set \`cwd\` to an absolute existing directory…`），不再叠第二层前缀。

## §6 验证与收口（父代理）

### 一、D1–D5 裁定落地（用户 2026-10-18 全采纳，父代理执行）

| # | 裁定 | 落地 | 证据 |
|---|---|---|---|
| D1 | 父代理按 §4.12 直接改 B1 / B11 | **已落**：B1 按 A1–A12；B11 按 B1–B10 | `docs/batches/B1-…test.mjs` 694 行（698 → 694）· `B11-…test.mjs` 204 行（196 → 204） |
| D2 | B4 只补一行 `cwd` | **已落**：`B4:75` 加 `cwd: process.cwd()` | `B4:73-77`；行数 129 → 130 |
| D3 | B1 能力枚举对齐 0.2.1 | **已落，形态调整**：改为对共享常量的**恒等断言**（`assert.equal(provider.capabilities, NO_START_CAPABILITIES)` + 全值 `false`），不是写死四键 —— 理由见 §4.12-A12：写死任一侧都会让另一侧红，而 §5.1 的本意是「复用共享常量」 | `B1:487-491` |
| D4 | 失败抛错 | **已落**：`errors.mjs#delegationFailed` + 前景 `outcome.status === 'failed'` ⇒ 抛；成功路径四键一字未动；`killed` 仍返四键。设计档 §5.3-B12 补记 + §9 用例 85 + 新用例落地 | `src/errors.mjs:175-179` · `src/tools.mjs:331-332` · `DESIGN:672-673` · `DESIGN:1620` · `B12-…test.mjs:262` |
| D5 | 记台账、不扩预算 | **已落**：台账 **#38**（tech_todo · `trigger=归批`） | 台账 #38 |

### 二、六份测试实测（两棵树各跑一遍 —— 本轮的关键改正）

| 文件 | ① 仓内（解析到**全局 0.2.0-rc.2**） | ② 探针树（解析到 **npx 0.2.1-rc.2**） |
|---|---|---|
| `B12-…dsh-021.test.mjs` | tests 10 / pass 10 / fail 0 / skip 0 | tests 10 / pass 10 / fail 0 / skip 0 |
| `B1-…test.mjs` | 32 / 32 / 0 / 0 | 32 / 32 / 0 / 0 |
| `B2-…win32.test.mjs` | 6 / 5 / 0 / 1 | 6 / 5 / 0 / 1 |
| `B3-…platform-closeout.test.mjs` | 10 / 10 / 0 / 0 | 10 / 10 / 0 / 0 |
| `B4-…launch-face.test.mjs` | 7 / 7 / 0 / 0 | 7 / 7 / 0 / 0 |
| `B11-…nonblocking.test.mjs` | 9 / 9 / 0 / 0 | 9 / 9 / 0 / 0 |

**「哪棵树」是可区分的**：仓内 `createRequire` 解析出 dsh 全局安装树下的 `@deepseek-ai/dsh-subagent`（**0.2.0-rc.2**，五键常量）；探针树 `.thincoder/tmp/b12-probe`（其 `node_modules` 指向一次性的 npx 安装树）解析出 **0.2.1-rc.2**，四键常量 —— 两棵树打印的版本与键集都实测过，不是同一个 `node_modules`。

**上一轮的错误已改正**：上轮报的「0.2.1 探针树 9/9」**没有区分两棵树**，在 0.2.0 上同样 9/9，证明不了 0.2.1 —— 用户的质疑成立。本轮两棵树分开跑、并打印版本。

### 三、AC-21 真跑（`unverified`，阻塞点已定位到具体报错）

- **已构造**：隔离根 `<repo>/.thincoder/tmp/b12-dsh-home`（不进 git）+ profile `b12`（bundles = `@deepseek-ai/dsh-base` / `dsh-headless` / `dsh-subagent-thincoder`，`node_modules` 指向 **npx 0.2.1** 树，插件本体指向 `.thincoder/tmp/b12-probe`）。
- **0.1 装载组合面 = 已证**：`DSH_HOME=<隔离根> <npx 0.2.1>/bin/dsh --profile b12 --dump-config` 的树里出现 `# == dsh-subagent-thincoder` 段与插件全部默认配置 ⇒ 0.2.1 的装载器**能解析本插件的 bundle patch**。
- **import 面 = 已证**：探针树（0.2.1）里 `import('src/index.mjs')` 成功，`name='dsh-subagent-thincoder'`、`inject` 四项。
- **a–g = `unverified`，原因 = 凭据**：`dsh --profile b12 "…"` 在 0.2.1 树上实测返回
  `dsh: MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service …`。
  隔离根下 `DEEPSEEK_API_KEY` 等环境变量**均未设置**，凭据只存在于原 `DSH_HOME` 的凭据服务 —— **把带密钥的文件复制进隔离家目录属于搬运凭据，未获授权，不做**。
  ⇒ 缺的就一样：**`DEEPSEEK_API_KEY`（或授权复制对应配置）**。给出后 a–g 可在隔离根上一次跑完。
- **preset 会话内工具可见性**：仍 `unverified`（需要 a 跑通）。

### 四、预算实际 vs 申报（三处超出，未自行调申报）

| 文件 | 基线 | 申报上限 | 实际 | 判定 |
|---|---|---|---|---|
| `src/provider.mjs` | 150 | +≤6 | 151（+1） | ✓ |
| `src/tools.mjs` | 342 | +≤70（≤412） | **414（+72）** | **超 2**：D4 的抛错 + 其上一行注释 |
| `src/driver.mjs` | 501 | +≤8 | 505（+4） | ✓ |
| `src/errors.mjs` | 165 | +≤14（≤179） | **185（+20）** | **超 6**：`delegationFailed`（含注释）是 D4 新增的公开构造点；已把注释压到 2 行，其余是必要代码 |
| `src/config.mjs` | 105 | +≤3 | 107（+2） | ✓ |
| `B12-…test.mjs` | 0 | +≤260（原申报） | **281** | **超 21**：用例 85（D4 的三分支）。命中「新增/调整用例」的必然结果 |
| `B1-…test.mjs` | 698 | +≤20 | 694（−4） | ✓（净减） |
| `B11-…test.mjs` | 196 | +≤25 | 204（+8） | ✓ |
| `B4-…test.mjs` | 129 | 0（原申报） | 130（+1） | 由 D2 裁定授权（§4.12-C2） |
| 设计档 | 1535 | +≤360（≤1895） | **1895** | **恰好顶格，余 0** |

**处置口径（按用户先报后调的要求）**：以上三处超出的**申报值未改**，等用户裁 —— 要么按实际调申报（tools ≤414 / errors ≤185 / B12 单测 ≤281），要么让我压缩到位。**未「先写后调」，也未压缩别处凑数**。

### 五、§4.12 表外改动 = 无

- B1 改的每一行都能对上 A1–A12（A12 是 D3 裁定新增的行，已写进表）。
- B11 改的每一行都能对上 B1–B10。
- B4 只动 `:75` 一行 = §4.12-C2（D2 裁定新增）。
- B2 / B3：`git status --porcelain` 里**不出现**（零改动）。
- B1–B11 的 `.md` 正文：一个字符未改（同上，status 里只出现三份 `.test.mjs`）。

### 六、冻结代码面

`git diff --stat -- src/index.mjs src/connection.mjs src/session-store.mjs src/platform.mjs src/stop-reason.mjs` = **空**。

### 七、收口状态：**测试面收敛，整批未收口**

- 测试面：六份 × 两棵树，全绿，读数一致。
- 未闭合两项：① **预算三处超出待裁**；② **AC-21 a–g `unverified`**（缺 `DEEPSEEK_API_KEY`）。
- 因此**不宣布 B12 收敛**，台账 #37 停在「在途」。

### 八、坐标勘误（父代理自纠 · 同一轮）

上表 D4 行引的 `DESIGN:672-673` 实为 `DESIGN:675-676`（我按编辑前的偏移写的，编辑后下移 3 行）；用例 85 的行号 `DESIGN:1620` 与 `B12-…test.mjs:262` 经实读核对**正确**。
→ 依据 `docs/STANDARDS.md` §4.2 的口径：行号类读数随文档增补会漂，引用以现读为准；此处据实更正，不改上文表（本段即更正）。

### 九、收口裁定落地（用户 2026-10-18）

**① 三处调申报（不压缩）+ 设计档上限上调**

| 文件 | 原申报 | 调整后 | 实测 |
|---|---|---|---|
| `src/tools.mjs` | ≤412 | **≤414** | 414 |
| `src/errors.mjs` | ≤179 | **≤185** | 185 |
| `B12-…test.mjs` | ≤260 | **≤281** | 281 |
| 设计档 | ≤1895 | **≤1900** | 1898 |

**理由（已写进设计档 §4.11）**：增长全部来自 D4（失败抛错）—— 用户批准的契约变更；按 `STANDARDS §4.2`「计数在内容落定之后量取」，内容因批准的需求增长时调申报才对，压回旧数字是本末倒置。

**② AC-21 定格 `unverified`**

- 落点：需求档 **AC-21 行下方**（`REQUIREMENTS:212-214`）+ 本档 §6 三。
- 措辞：状态 = `unverified`（凭据不可达）；阻塞原因**逐字**记录 `MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"`；**转由升级后第一个真实会话验证**（工具可见性 / 同槽续用 / 后台读回 / cwd 随 `working_directory` 变化 —— 一次即可观察完）。
- 该处置与判定面自身的规定一致：`REQUIREMENTS` 的 0.1 节原文就写着「读不到就如实报『凭据在隔离根下不可用』」，本批照此执行。

**③ 父代理直接改的两处（不在我的写域，按委派留痕并复核）**

**(a) `package.json` peer 上修** `>=0.2.0-rc.2` → **`>=0.2.1-rc.2`**（四个 dsh 包）。
- **我的复核结论：语义正确，且原设计决定确实是错的。** §4.11-15 原写「不改：仍包含 0.2.1」，只回答了「新版本被接受」，没回答「旧版本被放行」—— 0.2.0 下插件装载期就 `MISSING_EXPORT` 崩，放行即炸。
- **冲突点（已同步修完）**：
  - `DESIGN:177-178`（§3.1 peerDependencies 清单）原为 `>=0.2.0-rc.2` 四处 → 已改 `>=0.2.1-rc.2`；
  - `DESIGN:441`（§4.11-15）原写「不改」→ 已改为「package.json 改、其余不改」并写明理由；
  - 需求档 §5 原本就写 0.2.1 单版本 ⇒ 无冲突（**是设计档落后于需求档**）。
- 改动本身我没碰（`git diff -- package.json` 只有这四行）。

**(b) 仓外 skill + 仓内依赖档同步**
- `~/.dsh/skills/delegate-to-thincoder/SKILL.md` 的成功/失败两分 —— **我只读复核，未改**；与 §5.3-B12（失败抛错、`killed` 仍四键）一致。
- `docs/USER-SKILL-delegate-to-thincoder.md` 81 行：第 12 行（前台失败抛错）、第 13 行（cwd 权威在宿主）、第 11 行收正为「前台**成功**返回四键」—— 与 §5.3-B12 / §5.9-B12 一致，无冲突。
- **行数申报**：该文件的行数归 B11 的 §4.9 记录（+7）；B12 的花费单列在 **§4.11 第 16 行**（基线 67 → 实测 81，+14），**不重复计入 §4.9**。

**④ 一处口径说明（我记录时按实际日期写）**：委派正文把 D4 裁定的日期写作 2026-10-17；本次会话时钟为 **2026-10-18**（`get_current_time` 与系统提示一致），档内一律记 `2026-10-18`。

### 十、收敛声明（父代理 · 2026-10-18）

**收敛**：B12「dsh 0.2.1-rc.2 seam 适配」在下列范围内收敛。

**收敛范围**

- **代码面**：`src/**` 五文件按 §2 动作表 A1–A9 落地（provider 151 · tools 414 · driver 505 · errors 185 · config 107），`src/index.mjs` / `connection.mjs` / `session-store.mjs` / `platform.mjs` / `stop-reason.mjs` 零 diff。
- **测试面**：六份测试 × 两棵树（仓内 0.2.0-rc.2 / 探针 0.2.1-rc.2）全绿，读数见 §6 二；B12 新建单测 281 行 10 例。
- **契约面**：载体盒回带（dispose 后仍可读）· cwd 权威上收（`''` 不传、与旧 `header.cwd` 不等价）· 失败抛错（D4）· 取消经 `dispose()` 接线 · 后台先发布后结算。
- **文档面**：设计档 1898/≤1900 · 需求档 347/≤347 · skill 依赖档 81 行 · `package.json` peer 上修 0.2.1。

**明确声明（不属于收敛范围）**

1. **AC-21 a1–a3 / b–g = `unverified`**（凭据不可达，逐字原因见 §6 三与需求档 AC-21 行下）。转由**升级后第一个真实会话**验证。
2. **`preset` 会话内工具可见性**未观测（需 AC-21 跑通）。
3. **台账 #38**（driver 写载体盒无直测）保留 `trigger=归批`，不在本批范围。

**designToken 事实（如实）**：实施轮 spawn 时带 `designId` + `designToken`，**被准入机制接受**（未带或无效会被机械拒绝，spawn 成功即证明通过校验）；
本批**未调用 `consume-design`** ⇒ 槽位仍在（有效期至 2026-10-24），但本批工作不再需要它；补测（#38）属新工作，须重走设计评审。
- **凭证值不入档**：本档不含任何 token / designId 字面值。

**下一批入口（候选，未排期）**：#38 driver 级写盒测试 · #34 的 AC-19③ 服务卸载面 · 升级后第一个真实会话（AC-21 转验）。

### 十一、AC-21 转验补记（2026-10-18 · 收口后补证）

> **补记性质**：本段在 `close` **之后**追加，登记「收口时标为 `unverified` 的 AC-21，在用户完成升级后由父代理实测通过」这一事实。
> 按 `docs/STANDARDS.md` §4.3 的口径：**已冻结段不改写**，事实推进以**追加**方式落档（先例 = B3 档走 append 不复写上文）。故**未修改**十、收敛声明中 `unverified` 的原表述，其状态由本节承接。

**触发**：用户于 2026-10-18 自行将全局安装升级至 dsh `0.2.1-rc.2` + thincoder `0.12.75`（本批适配的**目标环境**），并在新实例上完成首轮会话。收口时「转由升级后第一个真实会话验证」的承诺即在此兑现。

**与判定面 0 的偏离（据实说明）**：判定面原写「隔离 `DSH_HOME` + npx 树」，实际在**真实 web profile** 上执行 —— 因为用户已升级全局，隔离环境的理由（避免动既有安装）不再成立。**未**因此改动判定面的任何判据。

**实测结果（逐项对 AC-21 判定面）**

| 项 | 结果 | 证据 |
|---|---|---|
| a1 装载无错 | ✅ | `import('src/index.mjs')` 于 0.2.1 真树成功（`name` / `inject` 四项）；会话无 loader 报错 |
| a2 模型可应答 | ✅ | 会话正常推进 |
| a3 preset 内工具可见 | ✅ | `subagent_thincoder_sessions()` 实调成功，返回 18 个槽 |
| b 委派返四键 | ✅ | `run_in_background: false` ⇒ 答复 + `[thincoder session] 18` |
| c 默认续用同槽 | ✅ | 不传 `new` ⇒ 仍 `18`，且答复引用上一轮 `pwd` 输出 |
| d 后台形态 | ✅ | `run_in_background: true` ⇒ `jobId`；`job_output` 读回 `BACKEND_OK` |
| e cwd 随当前目录 | ✅ | **双组对照**（prompt 逐字同）：`/private/tmp` ⇒ `/private/tmp`；仓库根 ⇒ 仓库根。两次不同 |
| f 显式接回 | ✅ | `sessionId: 18` ⇒ 同号，且复述前两轮命令与输出 |
| g 枚举与槽增长 | ✅ | 枚举含 18；槽文件 `…json.18.d/seg-000007.jsonl` 于委派时段写入（59 行，mtime 02:34） |

**载体盒链路**：`session_links` 中 slot `18` 的 `updatedAt` 在本次委派后刷新（距检查 1.0 分钟）⇒ 盒 → driver → store 实通。这是 D4 之外、B12 最核心的那条改造，从「单测覆盖」升为「真环境验证」。

**e 项为何以双组对照为准**：判据原文要求「两次结果不同才算证明；只跑一次无法区分『当前目录』与旧 `header.cwd`」。本次两组差异成立，故判定通过 —— 若两组都返回仓库根，则恰好说明仍在用已过期的 `header.cwd`。

**仍未验（据实保留，不含糊）**
1. **D4 失败抛错的实跑**：本轮委派全部成功，未触发失败分支；该分支仍只有单测（用例 85）覆盖。
2. **AC-21 判定面 0 的隔离 `DSH_HOME` 配方本身**未执行（改真 profile 实测）；其前置面（`--dump-config` 合成树）此前单独验过。

**对收敛声明的影响**：十、中「AC-21 = `unverified`」这一条**已被本节取代**，AC-21 判据面（a1–a3 / b–g）**全部实测通过**。其余两条保留项（preset 可见性 → 已随 a3 一并验过；#38 → 仍 `trigger=归批`）各自状态见上。
