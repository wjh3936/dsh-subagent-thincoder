# 2026-10-08 · launch-face
> 六段 append-only，一段一作者：§1 讨论（主 agent）· §2 批次任务与设计（eng-designer）· §3 设计评审（评审子代理）· §4 用户批准（主 agent）· §5 实施记录（eng-coder）· §6 验证与收口（父代理）。
> 编制：主 agent · 2026-10-08 · 来源 = 用户指令（2026-10-08）：B4 启动面收敛 —— 条目 1 = 两套启动 spec（provider.start 与 driver.listWorkspaceSessions 各自算一遍 resolveLaunchArgv）并成单一来源；条目 2 = 台账 #24 收口（src/platform.mjs 目标解析面补非字符串校验）。本轮推进到 §3 设计评审通过为止；§4 用户批准未获、不进 §5 实施。
> 台账 = #24–#25（REQUIREMENTS-dsh-subagent-thincoder · 归批）。前情 = docs/batches/B3-dsh-subagent-thincoder-platform-closeout.md §6（已收口 2026-10-08）。
## §1 讨论（主 agent）
**状态行**：已收口 2026-10-09
<§1 模板占位：本批条目 / 关键判据 / 授权口径>

**本批条目（2 条）**：条目 1 = 启动面收敛（启动 spec 解析收敛为**单一来源**）· 条目 2 = 台账 **#24** 收口（`src/platform.mjs` 目标解析面补非字符串校验）。台账指针 = `#24–#25`（`REQUIREMENTS-dsh-subagent-thincoder` · 归批）。

**授权口径**：用户指令立批（2026-10-08），走六段全链路。本轮推进到 §3 设计评审通过为止；**§4 用户批准由用户给**，未获批准不进 §5 实施。

**用户给定的事实（父代理已复核，直接采信）**：

- **条目 1 现况**：同一件事（解析最终 argv）有**两个实现点** —— `src/provider.mjs:127-146` `start()` 调 `resolveLaunchArgv({… platform: currentPlatform()})` 后把 **`argv`** 交给 `startThincoderRun`；
  `src/driver.mjs:450-455` `listWorkspaceSessions()` **自己再算一遍** `resolveLaunchArgv`；`src/tools.mjs:246-251` 把 `{ ctx, ...behaviour, cwd }` 整体铺给 lister
  ⇒ 传给 lister 的 spec **同时**带 `command` / `args`（driver 用）与 `ctx`。
  ⇒ **spec 形状在两条面上不一致**（委派面带 `argv`、枚举面带 `command` / `args`）；`currentPlatform()` 散在**三处**（`provider.mjs:135` · `driver.mjs:454` · `session-store.mjs:90` 默认参）。
- **条目 2** = 台账 #24：`resolveLaunchArgv` 对**目标**解析结果无非空 / 字符串校验，而解释器候选面有（`nonEmpty`）。B3 §6 已裁定该路径经真实 seam 不可达（dsh 的 `resolveExecutable` 声明 `Promise<string>`，空串 / 相对路径 / 未命中均抛错），故当时未修；本批可一并收掉这个口径不一致。

**设计必须回答的问题（用户明示，4 条）**：

1. **单一来源的落点与形状**：放哪（`platform.mjs` 新函数？现状如何**演进而非推倒重来**）、签名是什么、`spec` 在两条面上的形状如何统一；**如何在 B1 那两条 `ctx:{}` + 桩 lister 用例仍全绿的前提下**收敛。
2. **`currentPlatform()` 的传染面**：三处调用能否收敛到一处；若能，落点与理由；若不能，说明为何。
3. **#24 收不收**：取 / 舍及理由（判「不值得收」就说明理由、把 #24 留池，**不要硬塞**）。
4. **行数预算**：`src/platform.mjs` **117** 行 · `src/provider.mjs` **156** · `src/driver.mjs` **504** · `src/tools.mjs` **255**（父代理实测，口径 = 换行符计数，与 `docs/STANDARDS.md` §2 同）；
   逐文件给 `+≤N` 并按既有体例写入设计档 §4.x。**注意 `src/session-store.mjs` 现 160 / ≤161、B3 测试 159 / ≤160 均处 B3 预算顶格** ——
   本批若需碰这两个文件，**必须先在设计里写清新预算**（走设计评审裁定），不得在实施期自行突破。

**D-1 的历史裁定仍然有效（必须正面处理）**：`docs/batches/B2-dsh-subagent-thincoder-win32.md` §1 记载，原设计把枚举面解析落在
`src/tools.mjs#createSessionsTool.execute`，因 **B1 的两条 sessions 用例以 `ctx: {}` + 桩 lister 构造**
（`docs/batches/B1-dsh-subagent-thincoder.test.mjs:423-443`）、在 `execute` 里解析会必红，才改落到 driver 的默认 lister 内。
**B1 / B2 两档已冻结、其 `.test.mjs` 一字不得改**，故该约束**依然有效**：
任何「在 `tools.mjs` 里调用 `ctx.subprocess`」的方案都会改红那两条用例。

**既有约束（延续，非本批新裁）**：平台差异仍收敛在 `src/platform.mjs` 一处；**不新增配置叶、不按平台分仓**；若设计需要打破，**列为上抛项**，不得默默扩面。
行数：`checkConfig.lineCounts = []` ⇒ 本项目未声明行数上限（`docs/STANDARDS.md` §1/§2），**不得引通用 500 行阈值**。文档单行 ≤300 字符（单位 = 字符）。

**不要碰**：`docs/batches/B1-*` · `B2-*` · `B3-*`（三档全冻结，含各自 `.test.mjs`）；Windows 侧；`PROJECT-MANIFEST.json`。`src/session-store.mjs` 除预算裁定外不应改动。

**父代理机械收尾（非本批条目）**：权威台账 id 22（文档行宽债务）的 `evidence` 已补记 B3 档 §6 的裁定行（`docs/batches/B3-dsh-subagent-thincoder-platform-closeout.md:253`，504 字符）⇒ 该债务全量现为 **13 行**（B1 档 5 + B2 档 5 + B3 档 3）；B3 档已冻结，只记不改。

**设计评审 round 1 处置（父代理裁定表 · 2026-10-09）**：评审（重跑轮）判 `changes-required`（🔴1 · 🟡1），逐条裁定如下。

| # | Action | Detail |
|---|---|---|
| 1 | **Not an issue** | 评审要求为 `src/driver.mjs`（504 行）提供实施前拆分计划（依据其通用的「代码文件 >500 行必须拆」规则）。**该规则在本项目不适用** ⇒ 无动作；依据见下表后「裁定 #1 的依据」。 |
| 2 | **Dispatched** | 采纳。要求设计者：① 在 §5.9 明确定义解析函数的**规范化输入形状**（行为叶三字段 `command` / `args` / `env`，来源为各面的行为叶），并写明两处调用传入的字段集合相同；② 把 §6.3 测试面第 2 / 3 条与 §9.4 用例 43 / 44 的断言**从「argv 相同 + 调用计数」加强为「两处传入同一字段集合」**；③ 同步 §8 的 AC-16 行与 §13。需求档侧 AC-16 的判定方式已由父代理补边界（入参形状 = 行为叶三字段；须断言同一字段集合）。 |

**裁定 #1 的依据（完整）**：

- `PROJECT-MANIFEST.json:26` 的 `checkConfig.lineCounts = []` ⇒ 本项目**未声明任何行数上限**。
- `docs/STANDARDS.md` §1 明文「未声明的项一律视为『本项目不作要求』—— 不引入通用默认阈值」；§2 并列明「『单文件 ≤N 行』这类通用阈值在本项目**不适用**」。
- 用户本轮指令重申「`lineCounts` 为空 ⇒ 无行数上限，不得引通用 500 行阈值」。
- 同一判据在 B2 期已裁过同类项（B2 档 §1「上报 1」的拆分面 = Not an issue）。
- 文件规模本身已登记为技术待办（权威台账 **id 17** · 条件），由用户持有。

**评审段说明**：本次投递的首轮报告只剩过程 trace（无 findings / VERDICT），故按用户指令**同版本重跑（阻塞式）**；重跑轮与复评轮由评审子代理**自行写入** §3（详见该段「父代理说明」）。

## §2 批次任务与设计（eng-designer）
**状态行**：设计完成（评审 round1 修正（处置表 #2）已落 · 2026-10-09 · 设计档 955 行）
<§2 模板占位：本批条目（覆盖） / 设计档落点 / 机制设计 / 受影响文件与测试面 / 验收对照 / 关键决策 / 上抛项>

**本批条目（覆盖 2 条）**

- **条目 1** = 台账 **#25** 启动面收敛：同一件事「把配置里的命令与参数解析成**最终 argv**」原有两个实现点
  （委派面 `src/provider.mjs:130-136`；枚举面 `src/driver.mjs:450-455` 自己再算一遍），
  现收敛为**一个函数 + 一个调用形状** —— `src/platform.mjs#resolveChildArgv(subprocess, spec)`（行为叶 in → 最终 argv out），
  它是全仓**唯一调用** `resolveLaunchArgv` 的地方；`platform` 默认值落在 `resolveLaunchArgv` 的形参上。
- **条目 2** = 台账 **#24** 目标解析面校验：`resolveLaunchArgv` 的 win32 分支给目标解析结果加**非空 / 字符串守卫**
  （与解释器候选面的 `nonEmpty` 判定同口径）；不在可达路径上改变行为（该路径经当前 seam 契约不可达 ⇒ 守卫而非修缺陷）。

**明确不在本批**：AC-1..AC-9（B1 的九个功能面）· AC-10（Windows 端到端）· AC-11 / AC-13 的**规则行**（逐字未动）·
平台分仓 / 新配置叶 · `src/tools.mjs` 与 `src/session-store.mjs` · 三档冻结档（含各自 `.test.mjs`）· `PROJECT-MANIFEST.json` · Windows 侧。

**设计档落点**：`docs/design/DESIGN-dsh-subagent-thincoder.md`（775 → 950 行，+175 ≤ +180）。
逐段：§1 B4 段 · §2 理由 · §2.1 数据流（委派面 + 枚举面同源块）· §3.1 不新增配置叶 · **§4.5 受影响文件与行数预算** ·
**§4.6 两条冻结约束（D-1 与 `argv` spec）** · **§4.7 四问回答** · §5.9 导出表（五件 → 六件）与单一来源段 + 规则 1 守卫句 + 失败面句 ·
§6.3 动作表 O1–O6 与测试六面 · §7-K29 / K30（含被否备选注）· §8 三条判决行与「不在变更面」注改写 · §9.4 用例 43–49 ·
§10 边界两条 · §11 无 open 项 · §12.2 上抛项 18–21 · §13 变更记录。

**机制设计（一句话）**：两条面各一行 `resolveChildArgv(<subprocess>, <行为叶>)` —— 委派面第二参 = `resolveBehaviourSpec(config)` 的产物，
枚举面第二参 = 工具铺下来的 `{ ctx, ...behaviour, cwd }`；平台读点收进 `resolveLaunchArgv` 的默认形参（两面零平台知识）；
win32 分支多一条目标可用性守卫。语义面**零新配置叶、零参数面变化**。

**四问结论（逐条；论证与证据见设计档 §4.6 / §4.7 / §7-K29,K30 / §12.2）**

1. **单一来源的落点与形状**：落点 = `src/platform.mjs#resolveChildArgv`；形状 = 「行为叶（`command` / `args` / `env`）in → 最终 argv out」。
   **不能收到「一个调用点」**：D-1（`docs/batches/B2-dsh-subagent-thincoder-win32.md:58-69`）禁枚举面在 `tools.mjs` 里解析
   （B1 的两条 sessions 用例以 `ctx: {}` + 桩 lister 构造，`docs/batches/B1-dsh-subagent-thincoder.test.mjs:422-447`）；
   而把委派面的解析下移进 `startThincoderRun` 会在 **win32 宿主**上改红冻结的 `docs/batches/B2-dsh-subagent-thincoder-win32.test.mjs:116`
   与 `docs/batches/B3-dsh-subagent-thincoder-platform-closeout.test.mjs:110`（两例以 `argv` spec 直调，桩 `ctx` 无 `resolveExecutable`）。
   ⇒ 本批收的是**实现与入参形状**，不是调用层；机检口径 = `src/**` 内 `resolveLaunchArgv(` 出现 **2 次**（1 定义 + 1 调用）。
2. **`currentPlatform()` 的传染面**：**不能收敛到一处，收敛到两处**（3 → 2）—— 启动面两处归零（provider / driver 不再 import 它），
   键面一处保留（`src/session-store.mjs:92` 的 `linkKey` 默认参，是冻结档的位置实参注入点）。
   **`process.platform` 的唯一读点**仍只有 `src/platform.mjs:26` 一处（机检 = 1 命中）。
3. **#24 收不收**：**收**（2 行守卫 + 1 例）。理由：与 K29 同面同一不变式（`argv[0]` 必为可用绝对路径，§5.9 原子性句）；
   如实登记该路径经当前 seam 契约不可达；**若评审判不值得守卫，可单独回退，不影响 K29**。
4. **行数预算**：见下表；`src/session-store.mjs`（现 160）与 B3 测试文件（现 159）本批**一行不碰** ⇒ 无需申请新预算。

**受影响文件与行数预算（口径同设计档 §4.1 / §4.3；`+N（≤+N 行）` = 上限、非目标值）**

| # | 文件 | 现况行数 | B4 动作 |
|---|---|---|---|
| 1 | `src/platform.mjs` | 117 | **修改**：**+12（≤+14 行）** |
| 2 | `src/provider.mjs` | 156 | **修改**：**净减（增长上限 +0 行）** |
| 3 | `src/driver.mjs` | 504 | **修改**：**净减（增长上限 +0 行）** |
| 4 | `docs/batches/B4-dsh-subagent-thincoder-launch-face.test.mjs` | 0 | **新增**：**+≤130 行** |
| 5 | `docs/design/DESIGN-dsh-subagent-thincoder.md` | 775 | **修改**：**+175（≤+180 行）** |
| 6 | `src/session-store.mjs` | 160 | **不改**：结构不变（±0 行）—— 平台默认参保留 |
| 7 | `src/tools.mjs` | 255 | **不改**：逐字未动（D-1） |
| 8 | `src/connection.mjs` · `errors.mjs` · `config.mjs` · `index.mjs` · `stop-reason.mjs` | 237 · 150 · 104 · 61 · 44 | **不改**：结构不变（±0 行） |
| 9 | `docs/batches/B1-*` · `B2-*` · `B3-*`（含三档 `.test.mjs`） | — | **不改**：结构不变（±0 行） |

**验收对照（可机检判决项）**

- **三档冻结读数不变**：`node --test docs/batches/B1-dsh-subagent-thincoder.test.mjs` = **32 pass / 0 fail**；
  `…B2-…win32.test.mjs` = **5 pass + 1 skip / 0 fail**；`…B3-…platform-closeout.test.mjs` = **10 pass / 0 fail**（skip 口径同 B3 档 §6 末段）。
- **本批新面由本批测试文件覆盖**：`node --test docs/batches/B4-dsh-subagent-thincoder-launch-face.test.mjs` 全绿（六面见设计档 §6.3）。
- **结构机检**：`src/**` 内 `resolveLaunchArgv(` 出现 **2** 次、`process.platform` 出现 **1** 次（B4 用例 45）。
- **行为机检**：委派面与枚举面在同一行为叶下交给 `spawn` 的 argv 逐字相同、且等于 façade 输出（用例 43 / 44）；
  win32 语义下解析面返回空串 / 非字符串 ⇒ `launchError` 同族 + `spawn` 零调用（用例 47）；POSIX 面不探测、不抛错（用例 49）。
- **建议 AC 号**（本档 §8 暂用，笔在主 agent）：**AC-16** = 启动面单一来源（结构机检）；**AC-17** = 解析结果可用性（win32 语义下的守卫）。

**关键决策**：**K29**（单一来源 = 一个函数 + 一个调用形状；被否：①解析下移 driver ②两面各自展开入参 ③driver 加「无 `command` 回落 `argv`」静默分支）·
**K30**（收 #24；被否：留池、扩大为 `args` 逐元素校验）。

**上抛项（每条：问题 / 备选 / 倾向及理由；全文见设计档 §12.2）**

- **18 · #24 取舍**：A 本批收（倾向，可单独回退）· B 留池（#24 保持 待讨论）。
- **19 · 需求档缺本批两条条目的判据行（笔在主 agent）**：A 补 P9 两句 + 序号 AC-16 / AC-17（倾向）· B 裁定结构修条目不进 AC 面。
- **20 · driver 的 spec 形状不能统一（冻结面钉死）**：A 保留两形状（倾向）· B 改 driver 只吃行为叶并同步改冻结的 B2 / B3 测试文件（违本批禁令）·
  C 加静默回落分支（违 driver 规则 1）。
- **21 · 键面 `currentPlatform()` 不收敛**：A 保留（倾向）· B 下移到 `keyPath` 形参（不减少读取次数、要碰顶格预算文件）· C 位置实参改选项对象（破冻结档形态）。

**父代理机械收尾（非本批条目）**：本批两条目落定后，台账 **#25 / #24** 的核销由主 agent 走（子代理无台账写权）。

**评审 round1 修正（处置表 #2 · 2026-10-09）**：按父代理裁定逐处落地，五处口径一致（与需求档 AC-16 现文对齐），设计档 **955 行**（本批 +180 ≤ +180；本次修正 +3）。

- **§5.9**（设计档 L415 · L423–L424）：导出表 `resolveChildArgv` 行改为「**只读** `spec` 的**行为叶三字段** `command` / `args` / `env`」；新增「**规范化输入形状（B4 · 钉死）**」两句 —— 读取面 = 行为叶三字段（来源 = 该面自己的行为叶；`ctx` / `cwd` 等铺参数**不进解析输入**）；「同一入参形状」= **两条面传入的「行为叶键集合」相同**，**不是「两个对象相同」**；可机检（两处调用各捕获实参、取其行为叶键集合断言相等）。
- **§6.3 测试面第 2 / 3 条**（L659–L660）：断言由「argv 相同 + 调用计数」加强为「捕获 façade 实参的**行为叶键集合**，两例**相同**」。
- **§9.4 用例 43 / 44 期望列**（L807–L808）：43 补「捕获 façade 实参的**行为叶键集合** = `{command, args, env}`」；44 改为「捕获的**行为叶键集合与用例 43 相同**（= 行为叶三字段）⇒ 同一入参形状」。
- **§8 AC-16 行**（L734）：对齐需求档 AC-16 现文 —— 委派面与枚举面**传入同一字段集合**（入参形状 = 行为叶三字段，来源均为该面行为叶），且同一行为叶下交给 `spawn` 的 argv 逐字相同。
- **§13**（L955）：一行变更记录（B4 设计评审 round1 修正 · 处置表 #2）。

**发现 #1（要求给 `src/driver.mjs` 加实施前拆分计划）**：父代理裁 **Not an issue**（依据 `PROJECT-MANIFEST.json:26` 的 `checkConfig.lineCounts = []` ⇒ 本项目未声明行数上限；`docs/STANDARDS.md` §1/§2）⇒ 未加拆分计划、未动 §4.5 的 driver 行。

**机检读数**：设计档 **955 行**（本批 +180 ≤ +180）· 单行 >300 字符 = **0 行** · 本次修正净增 **+3 行**。

## §3 设计评审（评审子代理）

### 父代理说明（非评审段）

> 首轮评审报告在自动投递中只剩过程 trace（无 findings / VERDICT）⇒ 按用户指令以**同一设计档版本重跑**（阻塞式）。
> 重跑轮与复评轮均由评审子代理**自行写入**（其轮次编号由 batch 工具生成：本条记到「轮次 1」与「轮次 3」——
> 工具计数把那次未投递的首轮也计入了，故编号跳号；父代理不改写他人段落的编号）。
> 父代理侧的逐条裁定见 §1「设计评审 round 1 处置」。

### 轮次 1（评审子代理）

| # | Category | Severity | Issue | Suggestion |
|---|---|---|---|---|
| 1 | Affected-file size / Feasibility | 🔴 | B4 的受影响文件表将 `src/driver.mjs` 标为现况 504 行，但没有拆分计划：`docs/design/DESIGN-dsh-subagent-thincoder.md:225-238` 明确列出 504 行且仅预期净减；同档还以“无声明行数上限”为由称无需拆分 `:159-162`。本评审规则规定代码文件超过 500 行必须拆分，且无豁免渠道，因此该设计在实施前不合规。 | 为 `src/driver.mjs` 提供实施前拆分计划，并在受影响文件表中列出拆分后的文件、职责、当前行数与预期增量；同步更新 O4/O5、测试落点、验收与冻结面说明，确保拆分后每个代码文件不超过硬上限。 |
| 2 | Acceptance criteria / Clarity | 🟡 | P9 要求委派面与枚举面调用同一函数、同一入参形状（`docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:120-123`）。设计将两面描述为共享 `resolveChildArgv`，但 §5.9 只明确两者共享 `command`/`args`/`env` 字段而未定义严格的规范化输入类型（`docs/design/DESIGN-dsh-subagent-thincoder.md:409-424`）；B4 测试面也只比较两次 `spawn` 的 argv 和调用计数（`:654-661`、`:801-811`），不能直接证明入参形状一致。 | 明确定义解析函数的规范化输入形状，并在用例 43/44 或结构检查中断言两处传入相同字段集合与字段来源；若“同一入参形状”仅指三项行为叶，需在设计和 AC-16 中明确该边界。 |

VERDICT: changes-required
计数：🔴 1，🟡 1，🔵 0。

### 轮次 3（评审子代理）

| # | Orig# | File | Severity | Status | Notes |
|---|---:|---|---|---|---|
| 1 | 2 | docs/design/DESIGN-dsh-subagent-thincoder.md; docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md | 🟡 | Fixed | 当前设计档已明确 `resolveChildArgv` 只读行为叶 `command` / `args` / `env`，并把“两处同一入参形状”定义为相同的行为叶键集合（docs/design/DESIGN-dsh-subagent-thincoder.md:415: `| resolveChildArgv(subprocess, spec) | **启动面单一来源（B4）**：**只读** `spec` 的**行为叶三字段** `command` / `args` / `env`（规范化输入形状见下）⇒ 最终 argv；全仓唯一调用 `resolveLaunchArgv` 的地方 |`; :420-424 明确两面调用与集合判定）。测试面已要求两处捕获行为叶键集合并比较（:659-660），用例 43/44 与 AC-16 也已同步该断言（:807-808、:734；需求档 :167、:228-230）。因此上一轮“仅比较 argv/调用计数、不能直接证明入参形状一致”的问题已修复。上一轮 Orig#1 按本轮 review-object declaration 明确排除，不作本轮判定。 |

VERDICT: pass

Counts: Fixed 1; Accepted 0; Unfixed 0; New 0

## §4 用户批准（主 agent）

**用户批准（2026-10-09）：批准 B4 设计，指令进 §5 实施。**

- **批准对象**：`docs/design/DESIGN-dsh-subagent-thincoder.md`（**955 行**；与 §3 复评轮判 `pass` 的版本同一，此后零写入）。
- **批准方式**：用户口述授权（2026-10-09）—— 「批准 B4 设计，进 §5 实施」。
- **批准依据**：设计评审 §3 复评轮（轮次 3）判 `pass`（Fixed 1 · Accepted 0 · Unfixed 0 · New 0）；round 1 的 🔴1 已由父代理裁定 Not an issue（依据见 §1「裁定 #1 的依据」）。
- **令牌**：设计令牌已签发并持有于本会话槽内（**按纪律不落数值、不回显**）。
- **批准范围**：本批 2 条 —— 台账 #25 启动面收敛 · #24 目标解析面校验；落位按设计档 §6.3 动作表 **O1–O6**。
- **用户同批裁定（2026-10-09）**：上抛 #18 取 A（本批收掉 #24）· #19 追认已补的 AC-16 / AC-17 · #20 取 A（保留 driver 两种交接形状）· #21 取 A（键面 `currentPlatform()` 默认参不收敛）。
- **批准后动作**：派 eng-coder 实施（§5）；交付后由父代理亲跑四档测试与结构门禁、回填 §6、核销 #24 / #25、消费设计令牌；完成后按路径限定提交（`src/**` 与 `docs/**` 分开两笔）。

## §5 实施记录（eng-coder）

**状态行**：实施完成（O1–O6 全落 · 四档测试全绿 · 内部审计 clean(1 轮) · 代码评审 pass(3 轮) · fix round 0）

**交付摘要**：按设计 §6.3 动作表 O1–O6 落位 —— `src/platform.mjs` 新增 `resolveChildArgv(subprocess, spec)`（全仓唯一调用 `resolveLaunchArgv` 的地方）；`resolveLaunchArgv` 的 `platform` 形参加默认值 `currentPlatform()`；win32 分支在 `resolveExecutable` 之后、扩展名分支之前加目标可用性守卫（台账 #24）；`provider.start` 与 `driver.listWorkspaceSessions` 各改一行调用并去掉 `currentPlatform` import；新增本批单元测试文件（7 个用例覆盖设计 §6.3 的六个测试面）。

**改动文件与实测行数（口径 = 换行符计数；预算 = 设计 §4.5）**

| 文件 | 改前 | 改后 | 预算核对 |
|---|---|---|---|
| `src/platform.mjs` | 117 | **131** | +14 ≤ +14 ⇒ ≤131 ✅（顶格） |
| `src/provider.mjs` | 156 | **150** | 增长上限 +0 ✅（净减 6） |
| `src/driver.mjs` | 504 | **501** | 增长上限 +0 ✅（净减 3） |
| `docs/batches/B4-dsh-subagent-thincoder-launch-face.test.mjs` | 0 | **129** | ≤130 ✅ |
| `src/session-store.mjs` · `src/tools.mjs` | 160 · 255 | 160 · 255 | 不改 ✅（逐字未动） |

改动文件内单行 >300 字符 = **0**。未碰 `src/session-store.mjs` · `src/tools.mjs` · B1/B2/B3 三档冻结档（含 `*.test.mjs`）· 需求档 / 设计档 / `PROJECT-MANIFEST.json`。

**四档测试读数（仓根 `node --test`，原文计数）**：B1 = **32 pass / 0 fail**；B2 = **5 pass + 1 skip / 0 fail**；B3 = **10 pass / 0 fail**；B4 = **7 pass / 0 fail**（六个测试面全绿）。

**结构机检读数（原文）**：`grep -rn "resolveLaunchArgv(" src/` ⇒ **2 命中**（`src/platform.mjs:93` 定义 · `src/platform.mjs:130` 调用）；`grep -rn "process.platform" src/` ⇒ **1 命中**（`src/platform.mjs:26`）。

**决策透明表**

| 处 | 取法 | 理由 |
|---|---|---|
| O1 落点 | `resolveChildArgv` 追加于 `src/platform.mjs` 末尾（`resolveLaunchArgv` 之后） | 设计 §5.9 导出表；只读行为叶三字段 `command`/`args`/`env`，铺参数（`ctx`/`cwd`）不进解析 |
| O2 默认值 | 形参 `platform = currentPlatform()` | 调用点不再传平台；注入平台（B2/B3 用例）逐字不变 |
| O3 判定 | `typeof target !== 'string' \|\| target === ''` ⇒ `launchError` | 与解释器候选面 `nonEmpty` 同口径（设计 §5.9 规则 1）；位于 `resolveExecutable` 之后、扩展名分支之前 |
| 测试面 2/3 的「捕获 façade 实参」 | 以 Proxy 包裹该面自己的 spec 实参交给**真 façade**，记录其读取的键，过滤到行为叶三字段 | 生产调用点（`provider.start` / `driver.listWorkspaceSessions`）无法从外部直接注入代理；改为「真 façade × 该面 spec 形状」+ 各面端到端 argv 等值；两例键集合均 = `{args, command, env}` |

**内部审计与代码评审轮次与终态**：① 分歧审计（explore，只读）**1 轮 ⇒ clean**（部分实施 / 静默简化 / 注释漂移 / 越界改文件 四类偏差各 0）；② 代码评审（advisor，type=code）**3 轮 ⇒ 终态 pass**（前两轮投递只剩过程 trace、无 findings/VERDICT，第三轮出表；🔴 全部 Fixed，余 2 条 🔵 见下）。

**fix round**：**0 轮**（审计与评审均未出需修项）。

**代码评审遗留 🔵（2 条 · 不阻塞 · 如实登记）**：① 用例 [43] 丢弃 `provider.start` 返回的 run 句柄、未显式拆除 —— 与 B2/B3 既有用例同形（假子进程无真实资源），且补拆除会破 B4 测试文件 129/≤130 预算；② 未见「经两条面在 win32 语义下起进程」的用例 —— 设计 §6.3 六面把 win32 语义放在解析面层级（用例 47/48）+ 冻结档 B2/B3 覆盖，实施未越设计。

**§5 写入方式**：`batch` 工具 `append`，segment=§5（已成功落档）。

## §6 验证与收口（父代理）

**状态行**：已收口（2026-10-09）
**结算**：本批条目 2 条（台账 #25 启动面收敛 · #24 目标解析面校验）全部落地并实测；设计令牌已消费；无遗留债务（两条 🔵 已在 §5 如实登记，不属债务）。

### 一、本次交付（逐文件；行数口径 = 换行符计数）

| 落点 | 动作 | 实测 | 预算 | 判定 |
|---|---|---|---|---|
| `src/platform.mjs` | 修改 | **131** | 117 +≤14 ⇒ ≤131 | ✅（顶格） |
| `src/provider.mjs` | 修改 | **150** | 只减不增（+0 上限） | ✅ 净减 6 |
| `src/driver.mjs` | 修改 | **501** | 只减不增（+0 上限） | ✅ 净减 3 |
| `docs/batches/B4-dsh-subagent-thincoder-launch-face.test.mjs` | 新增 | **129** | ≤130 | ✅ |
| `src/session-store.mjs` · `src/tools.mjs` | 不改 | 160 · 255 | ±0 | ✅ 逐字未动 |
| `docs/batches/B1-*` · `B2-*` · `B3-*`（含三档 `.test.mjs`） | 不改 | — | ±0 | ✅ git 面零改动 |

### 二、验收逐条判决（父代理亲跑，2026-10-09）

| 判决项 | 结果 | 实测证据 |
|---|---|---|
| **AC-16** | ✅ | 结构机检实跑：`grep -rn "resolveLaunchArgv(" src/` = **2 命中**（`platform.mjs:93` 定义 / `:130` 调用）；`grep -rn "process.platform" src/` = **1 命中**（`platform.mjs:26`）。行为：B4 用例 **[43] / [44]**（两面的行为叶键集合 = `{command, args, env}`，且交给 `spawn` 的 argv 逐字相同）。`grep -rn "win32" src/` 仅 `platform.mjs:33 / :58 / :95` |
| **AC-17** | ✅ | B4 用例 **[47]**：win32 注入 + 解析面返回 `''` / 非字符串 ⇒ `launchError` 同族 + `spawn` 零调用；**[48]** 可达 win32 路径逐字不变；**[49]** POSIX 不探测、不抛错 |
| 四档测试 | ✅ | B1 `tests 32 · pass 32 · fail 0 · skipped 0`；B2 `tests 6 · pass 5 · fail 0 · skipped 1`；B3 `tests 10 · pass 10 · fail 0 · skipped 0`；B4 `tests 7 · pass 7 · fail 0 · skipped 0`（六个测试面；第 6 面拆为用例 48 / 49） |
| 两条冻结约束（§4.6） | ✅ | 三档冻结面实跑**零 red**；`B2-…win32.test.mjs:116` 与 `B3-…platform-closeout.test.mjs:110`（以 `argv` 直调 `startThincoderRun`、桩 `ctx` 无 `resolveExecutable`）仍绿 ⇒ 解析未下移、`spec` 交接形状未改 |
| 结构门禁 | ✅ | `grep -rnE "nvm4w|USERPROFILE|C:\\|/Users/" src/` ⇒ 零命中 |
| 文档行宽 | ✅ | 四个改动文件 >300 字符行 = **0** |
| 行数预算 | ✅ | 逐文件实测 ≤ 上限（`platform.mjs` 顶格 131 / ≤131） |

### 三、交付评审与裁定

- **内部偏离审计**（eng-coder · explore）：**1 轮 ⇒ clean**（部分实施 / 静默简化 / 注释漂移 / 越界改文件 四类偏差各 0）。
- **内部代码评审**（eng-coder 内 advisor · type=code）：**3 轮 ⇒ 终态 `pass`**（前两轮**投递只剩过程 trace、无 findings / VERDICT** —— 与设计评审本轮遇到的同一投递现象；第三轮出表）。🔴 全部 Fixed。
- **遗留 🔵 2 条**（子代理已在 §5 如实登记）：① 用例 [43] 丢弃 `provider.start` 的 run 句柄、未显式拆除；② 未见「win32 语义下经两条面起进程」的用例。**父代理裁定：不阻塞** —— ① 与 B2 / B3 既有用例同形（假子进程无真实资源），且补拆除会破 B4 测试文件 129 / ≤130 预算；② 设计 §6.3 的六面把 win32 语义放在解析面层级（用例 47 / 48），进程层语义由三档冻结面覆盖，实施未越设计。
- **无未处置的 🔴 / 🟡**。

### 四、收口核验清单（结算同步）

| 项 | 状态 |
|---|---|
| 角色表（一段一作者） | ✅ §1 / §4 / §6 主 agent · §2 eng-designer · §3 评审子代理 · §5 eng-coder |
| 状态行 | ✅ §1 / §2 / §5 已更新；§6 本行（§1 随收口转「已收口」） |
| 计数（条目 / 文件 / 用例） | ✅ 条目 2 = 台账 #25 / #24；文件 3 改 + 1 新增 + 2 簿记不改 + 三档冻结不改；用例 43–49 |
| 指针 | ✅ 批次档 ↔ 需求档（P9 两条判据 · AC-16 / AC-17）↔ 设计档（§4.5 / §4.6 / §4.7 / §5.9 / §6.3 / §7-K29,K30 / §8 / §9.4）三链同源 |
| 变更记录 | ✅ 需求档 §7 · 设计档 §13 各载本批条目与修正轮 |
| 待办勾稽 | ✅ #25 / #24 核销；#22 的标题与 evidence 已对齐（16 行）；#17 / #23 保持开着 |
| 前批遗留交叉核 | ✅ B1（10-06）/ B2（10-08）/ B3（10-08）三档均已收口，无「条目已办、锚档未收口」的遗留 |
| 台账可见面 | ✅ 权威库 = mac 库（口径见 `docs/STANDARDS.md` §5） |
| 文档地图 | ✅ `docs/README.md` 已登记 B4 档（已收口）与本批测试文件 |
| 设计令牌 | ✅ 已消费（本批链路终结） |

### 五、随本批仍开着的（已上榜）

| # | 事项 | 台账 |
|---|---|---|
| 1 | 文档行宽债务（批次档共 **16 行**：B1 5 + B2 5 + B3 3 + B4 3） | #22（条件） |
| 2 | 设计档 dsh 引用双坐标并存 | #23（条件） |
| 3 | 文件规模（`driver.mjs` 501 · B1 测试 698） | #17（条件） |
| 4 | 两条 🔵（用例 [43] 未拆除 run 句柄；未覆盖「win32 语义下经两条面起进程」） | 如实登记于 §5，不登记为债务（理由见第三节） |
| 5 | `src/platform.mjs` 顶格 131 / ≤131（再补一行即需调预算） | 如实记录，不阻断 |

### 六、测试线

- 本批单元测试文件 = `docs/batches/B4-dsh-subagent-thincoder-launch-face.test.mjs`（129 行 · 7 例，覆盖六个测试面），随档存放、`node --test` 直跑，后续批次可复跑。
- 集成场景**无新增 / 修订**（本仓无产品 `test/` 树；`package.json` 未声明 `scripts`）。

### 七、暂缓批复核

**暂缓批复核：无**（本仓无带「暂缓 · 复核条件」标记的批次）。
