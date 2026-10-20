# 2026-10-08 · platform-closeout
> 六段 append-only，一段一作者：§1 讨论（主 agent）· §2 批次任务与设计（eng-designer）· §3 设计评审（评审子代理）· §4 用户批准（主 agent）· §5 实施记录（eng-coder）· §6 验证与收口（父代理）。
> 编制：主 agent · 2026-10-08 · 来源 = 用户指令（2026-10-08）：B3 平台适配收口 —— 条目 1 = P10 收口（续用键归一改按「文件系统大小写语义」判定并补 realpath 规范化）；条目 2 = P9 收口（解释器候选读 ComSpec 改大小写不敏感，权威台账 id 19）。本轮推进到 §3 设计评审通过为止，§4 用户批准未获、不进 §5 实施。
> 台账 = #20–#21（REQUIREMENTS-dsh-subagent-thincoder · 归批）。前情 = docs/batches/B2-dsh-subagent-thincoder-win32.md §6（已收口 2026-10-08）。
## §1 讨论（主 agent）
**状态行**：已收口 2026-10-08
<§1 模板占位：本批条目 / 关键判据 / 授权口径>

**本批条目（2 条，与需求档 §2 同源）**：台账 #20 = P10 收口（续用键归一改按「文件系统大小写语义」判定 + realpath 规范化）· 台账 #21 = P9 收口（解释器候选读取 `ComSpec` 改为大小写不敏感；前身 = 权威台账 id 19）。

**授权口径**：用户指令立批（2026-10-08），走六段全链路。本轮推进到 §3 设计评审通过为止；**§4 用户批准由用户给**，未获批准不进 §5 实施。

**用户给定的事实（父代理已实读核实，直接采信）**：

- **P10 现况**：`src/platform.mjs#keyPath` 只对 `platform === 'win32'` 折大小写；而设计档（`docs/design/DESIGN-dsh-subagent-thincoder.md:25`）与需求档 P10 的判据原文是「**大小写不敏感的文件系统**」⇒ macOS 默认 APFS 卷大小写不敏感，同一工作区不同大小写形态在 mac 上落成多个键 —— **P10 要治的缺陷在 mac 端原样存在**。
- **P10 实测读数（darwin）**：同一工作区的原值形态 / `.toLowerCase()` 形态 / 仅大小写不同的第三种形态 = **3 个不同键**；改用 `realpathSync.native` 规范化后 = **1 个键**，且 `/tmp` 与 `/private/tmp` 合一；POSIX 大小写敏感的两种形态仍是 2 个键（AC-12 / 用例 26 语义不变）。
- **P9 现况**：`src/platform.mjs:45` 用 `env?.ComSpec` 逐字读 JS 属性 ⇒ 部署配 `{COMSPEC: ...}` 被静默忽略、退回宿主值。dsh 自身 `environmentValue`（`subprocess-local/lib/index.js:1478-1483`）在 win32 上做**大小写不敏感**查找 ⇒ 本插件比它调用的 seam **更严**。

**设计必须回答的三问（用户明示「不是我预设的答案」）**：

1. 归一判据从「平台枚举」改为「文件系统大小写语义」后，**`platform` 注入口径如何变化** —— 现 `linkKey(..., platform)` 注入 `'linux'` 不再等于「不折」；而 **B1 与 B2 的测试文件都依赖该注入面，两档已冻结、不得改动**（见下方「不要碰」）。
2. realpath 的**失败面**：路径不存在 / 不可解析时必须回退，**不得抛错**。
3. realpath 会**合并**原先不同的键 ⇒ 属行为变更，**旧记录如何处置**（已有记录中 realpath 与原值相同者不受影响，但规则要写明）。

**需求档已同步（父代理写域，随本批落定）**：P10 判据改写为「目标路径所在文件系统的大小写语义」（删去「（Windows）」这一窄化残句）+ 补「符号链接别名与真实路径同键」「realpath 失败回退不抛错」两条；P9 补「解释器候选 `ComSpec` 的读取与 dsh seam 同口径（win32 大小写不敏感）」。AC-12 判定方式随之改写，**新增 AC-14（别名同键 + 失败回退）/ AC-15（`COMSPEC` 与 `ComSpec` 等效）**；需求档 §7 已载本批变更记录。

**既有约束（延续，非本批新裁）**：平台差异仍收敛在 `src/platform.mjs` 一处；**不按平台分仓、不新增配置叶**；若设计需要打破，**列为上抛项**，不得默默扩面。
行数：`checkConfig.lineCounts = []` ⇒ 本项目未声明行数上限（`docs/STANDARDS.md` §1/§2），**不得引通用 500 行阈值**。文档单行 ≤300 字符。

**不要碰**：`docs/batches/B1-*`、`docs/batches/B2-*`（两档已冻结，含其 `.test.mjs`）；Windows 侧任何东西。

**台账跨机对账（2026-10-08，用户裁定）**：本项目**权威台账 = mac 主开发机的库**（按项目根落在用户数据目录、不进 git；口径见 `docs/STANDARDS.md` §5）。上一轮已把 Windows 机台账的 6 条补建进权威库：

| Windows 机编号 | 内容 | 权威库 id |
|---|---|---|
| #1 | P9 跨平台启动 | 14 |
| #2 | P10 续用键的路径归一 | 15 |
| #3 | 台账跨机不共享 | 16 |
| #4 | 文件规模 | 17 |
| #5 | `src/connection.mjs` 两处既有缺陷 | 18 |
| #6 | `src/platform.mjs` 解释器候选①读 `env.ComSpec` | 19 |

**B2 档内 `#N` 为 Windows 机编号，权威库语境下按本表解析。** B2 已于 2026-10-08 收口冻结（追加被机制拒绝，`改 = 新批新档`），故映射注落在本档；Windows 那份库保持原样、不做合并（跨机重复为已知）。

**随本批登记的技术待办（非本批条目）**：文档行宽债务 = 权威台账 **id 22**（`tech_todo` · 条件）—— `checkConfig.lineWidth = 300` 下 B1 档 `:98` / `:111-114` 与 B2 档 `:188` / `:189` / `:199-201` 共 10 行越界（最长 1066 字符），两档冻结故不回改，待与文件规模拆分批（id 17）一并治理。

**父代理机械收尾（2026-10-08，非本批条目）**：`docs/README.md` 文档地图原把 B2 记为「在途」，与事实（B2 §1 状态行 = 已收口 2026-10-08）不符，已改为已收口；并按文档地图登记义务补 B3 行。

## §2 批次任务与设计（eng-designer）
**状态行**：设计完成（评审 round1 三条发现 + 一条形式项已逐条落地（设计档 §4.3 / §5.6 / §5.9 / §6.2 / §7-K25,K27,K28 / §8 / §9.3 / §12.1-17；775 行、>300 字符行 0）；等评审 round2）
<§2 模板占位：本批条目（覆盖） / 设计档落点 / 机制设计 / 受影响文件与测试面 / 验收对照 / 关键决策 / 上抛项>

**本批条目（覆盖 2 条 · 与需求档 §2 及台账 #20–#21 同源）**

| 条目 | 需求点 | 判据（本批要落成的行为） | 设计档落点 |
|---|---|---|---|
| #20 P10 收口 | P10 续用键的路径归一 | 归一判据 = **目标路径所在文件系统的大小写语义**（`realpathSync.native`），符号链接别名与真实路径同键，realpath 失败**回退不抛错**，归一**只作用于键** | §5.6 键构造 · §5.9「P10 键归一（B3 收口）」含三问回答 · §6.2-N1/N5 · §7-K25/K26/K28 · §9.3 用例 33–38 |
| #21 P9 收口 | P9 跨平台启动（解释器候选读取） | win32 上配置环境里的 `ComSpec` **大小写不敏感**（`COMSPEC` ≡ `ComSpec`），与 dsh seam 同口径；**候选顺序不变** | §5.9 规则 3 · §6.2-N2/N3/N4 · §7-K27 · §9.3 用例 39–42 |

**条目明确不在本批**：AC-1..AC-13 所涉面均不在本批变更面 —— 具体地，argv 的 win32 包装与元字符检出、非 win32 逐字原样（**AC-11 / AC-13**）、Windows 端到端（**AC-10**）、以及 B1 的九个功能面（**AC-1..AC-9**）本批**一行不改**。
`provider.mjs` / `driver.mjs` / `connection.mjs` / `tools.mjs` / `config.mjs` / `index.mjs` 逐字未动（`platform: currentPlatform()` 传参已由 B2 就位，本批只需 `platform.mjs` 内部接收）。

**机制设计（本批）**：全仓仍只有 `src/platform.mjs` 一个平台/主机语义模块；本批在那里加两个导出与一处传参，在 `src/session-store.mjs` 的 `linkKey` 上加一个归一注入缝。

- 键的构造：`parentSessionId + '\u0000' + keyPath(canonicalize(resolve(cwd)), platform)`。`canonicalize`（默认 `canonicalPath` = `realpathSync.native` + 任何错误回退入参）**从文件系统取得判据**；`keyPath` 保持纯字符串折（win32 ⇒ `toLowerCase()`，其余逐字）**逐字不改**。
- 解释器候选读取：`environmentValue(env, name, platform)` 先取精确大小写、未命中且平台为 win32 时再按 `toUpperCase()` 全表找一次 —— 口径镜像 dsh 自己的 `environmentValue`（`subprocess-local/lib/index.js:1478-1483`），插件不得比它更严。

**三问回答（交评审的三条结论）**：

1. **`platform` 注入口径**：注入值不再等于判据，只等于「win32 补充折」。`linkKey(..., 'linux')` 的含义由「键 = `resolve(cwd)` 逐字」变为「键 = `canonicalPath(resolve(cwd))`（不可解析时退回 `resolve(cwd)`）且不折」。
   realpath 的结果**不可注入**（它就是文件系统的答案）⇒ 可测性由 `linkKey` 的**第四参 `canonicalize`**（函数型注入）承担，两种大小写语义都可测（§7-K28）。
2. **realpath 失败面**：`try { realpathSync.native(p) } catch { return p }` —— 捕获全部错误、**不抛错**、不做部分解析（不回退到「逐级 realpath 到最深存在祖先」）；委派失败面仍由 P2 / P6 诊断承担。
3. **旧记录处置 = 不迁移、不扫描**（§7-K26）：失效面 = 该工作区的默认续用一次性退化为新建槽；救回路径已在（枚举工具 + 显式 `sessionId`）。理由与备选见 §12.1-14。

**冻结面共存（本批硬前提，已实机核对）**：B1:218 与 B2:109/:110/:111/:121 四条断言在 realpath 落地后仍全绿，
依据 = 其入参路径（`/tmp/ws`、仓根 `WS`、`Mixed/Case`）在实机上**都不存在** ⇒ realpath 回退 ⇒ 与旧口径逐字一致；
`keyPath` 逐字未改则 B2:111 天然不变。核对读数（2026-10-08 darwin）：`/tmp/ws` 不存在、
`/tmp` 是 `→ private/tmp` 的符号链接、仓根无 `WS` / `ws`、`realpath(仓根) === 仓根`。
逐条论证见 §4.4；该前提被打破时**上抛用户裁定**（§12.1-13），不改冻结档、不缩需求。

**受影响文件与行数预算（B3）**

| # | 文件 | 现况行数 | B3 动作 |
|---|---|---|---|
| 1 | `src/platform.mjs` | 94 | 修改：`+24（≤+24 行）`（`canonicalPath` + `environmentValue` + `resolveInterpreter` 收 `platform` + 透传） |
| 2 | `src/session-store.mjs` | 155 | 修改：`+5（≤+5 行）`（`linkKey` 第四参 + 键构造改写 + 注释） |
| 3 | `docs/batches/B3-dsh-subagent-thincoder-platform-closeout.test.mjs` | — | 新增（`≤160 行`）：本批单元测试文件（十个变更面见 §6.2） |
| 4 | `docs/USER-SKILL-delegate-to-thincoder.md` | 59 | 修改：`+2（≤+2 行）`（§3 第 4 行键形态改写 + §5 变更记录一行） |
| 5 | `docs/batches/B1-*` · `docs/batches/B2-*`（含两档 `.test.mjs`） | — | **不改**：结构不变（±0 行） |

本项目未声明行数上限（`checkConfig.lineCounts = []`）⇒ 无拆分计划，亦**不引通用 500 行阈值**。本批**无新依赖、无新配置叶**。

**验收对照（指向需求档，逐条可验）**

| 需求点 | 验收 | 怎么验（可观测读数） |
|---|---|---|
| P10 | AC-12 | 单测：大小写不敏感语义 ⇒ 同一键；大小写敏感语义 ⇒ 两个键；真机 APFS 真实目录两形态 ⇒ 同一键（§9.3 用例 33–35） |
| P10 | AC-14 | 单测：符号链接别名（`/tmp/ws` ↔ `/private/tmp/ws` 类）⇒ 同一键；realpath 失败 ⇒ 回退且**不抛错**（§9.3 用例 36–37） |
| P9 | AC-15 | 单测：win32 语义下 `{COMSPEC}` 与 `{ComSpec}` ⇒ 同一解释器；候选顺序（配置 → 宿主 → 字面）不变（§9.3 用例 39–40） |
| P9 | AC-11（**不在本批变更面**） | 非 win32 逐字原样、无解释器包装：仍由 B2 用例 15–17 覆盖（本批未动那几行） |

**关键决策（本批新增，详见 §7）**：K25 判据 = 文件系统大小写语义，规范化落在 `canonicalPath`、`keyPath` 逐字不改 · K26 旧记录不迁移不扫描 · K27 解释器候选读取镜像 dsh `environmentValue`（判定用注入 platform） · K28 可测性靠 `canonicalize` 函数型注入缝（位置参数以不破坏冻结实参形态）。

**上抛项（本批 5 条，逐条「问题 / 备选 / 倾向及理由」见 §12.1）**：13 冻结面共存的前提（阻断级，前提破则用户裁定） · 14 旧记录处置（行为变更，请确认不迁移） · 15 需求措辞「不是平台枚举」与残留 win32 折的口径（请确认） · 16 命名残留（非阻断） · 17 上游口径核对（非阻断）。

**本批不碰（已遵守）**：`src/` 下不出实现（§5 属 eng-coder）· `docs/batches/B1-*` / `B2-*`（含其 `.test.mjs`）一字未动 · 需求档未改（本轮无需主 agent 动笔）· `PROJECT-MANIFEST.json` 未改 · Windows 侧未碰。

**评审 round1 修正（2026-10-08 · fix 轮 · 逐发现号回执）**

- **发现 1（🔴 Feasibility / Acceptance）→ 采纳**：真实文件系统探针改为**可移植夹具** —— 临时目录用 `mkdtemp`，符号链接夹具在 `mkdtemp` 内自建（不依赖 `/private/tmp`）；写明**跳过判据**与**平台支持矩阵**（按主机语义而非 OS 枚举）；**桩注入用例恒为必测**，真实探针降为加值面（依据 = 需求档 AC-12 / AC-14 的判定方式「两种语义均须可测」由桩注入即可满足）；「三档全绿」口径改为**含条件跳过**（`node --test` 的 skip 不算失败）。
  落点：设计档 §6.2 测试面第 1 / 3 / 4 / 5 / 10 项与测试运行段（新增矩阵表）、§8 AC-12 与 AC-14 行、§9.3 用例 35 / 36 / 37、§7-K28。
- **发现 2（🔴 Clarity / Acceptance）→ 采纳（取父代理倾向 ②）**：回退责任改为**分层** —— `canonicalPath` 自身捕获回退（N1 原文不变），`linkKey` 再兜一层，捕获注入的 `canonicalize` 抛出的**任何**异常并回退到已 `resolve` 的路径 ⇒「键的构造从不抛错」对**任何** `canonicalize` 成立，不只对默认函数。理由：`linkKey` 是唯一入口、注入函数是它的直接依赖；异常漏出会让键构造变成可抛面，与既定「键的构造从不失败」自相矛盾；分层后 N1 的契约仍独立成立，两层互不依赖。
  落点：设计档 §5.6 键行、§5.9 P10 块（新增「回退责任分层」条 + 三问② 改写）、§6.2-N1 / N5、§9.3 用例 37、§7-K25、§8 AC-14 行。
- **发现 3（🟡 Affected-file annotations）→ 采纳**：§4.3 行 3（新增测试文件）基线由 `—` 改 `0`，动作栏 `新增（≤160 行）` 改 `+≤160 行`（0 → ≤160 行）；表下口径注同步写明「新增文件基线记 0、动作栏记 `+≤N 行`」。
- **形式项（父代理自检 · 非评审发现）→ 采纳**：dsh 出处由安装态路径改**源码树口径** `deepseek-harness/packages/subprocess/subprocess-local/src/index.ts:333-338`（`environmentValue`；本设计者已实读该源码树文件核实：精确命中优先、非 win32 直返精确值、win32 未命中再按 `toUpperCase()` 全表找一次）；§12.1-17 另附一条**安装态读数佐证**括注（明确标注为佐证）。落点：§7-K27、§12.1-17。
  **本段更正（§2 append-only，上文不回改）**：本档上文「机制设计」第 2 条沿用安装态写法 `subprocess-local/lib/index.js:1478-1483`，以本段为准。
  **另**：父代理列出的落点「§5.9 规则 3」经实读**未含** dsh 出处（该处只写「与 dsh seam 同口径」，无任何路径坐标）⇒ 无改动；实际两处为 §7-K27 与 §12.1-17，均已改。
- **未扩面（已遵守）**：未加新配置叶、未改参数形状、未新增需求点、未重开 §12.1 上抛项 13–17 的实质；`src/` 未动；需求档未动（本轮无需主 agent 动笔）；`docs/batches/B1-*` / `B2-*`（含 `.test.mjs`）未动；`PROJECT-MANIFEST.json` 未动；Windows 侧未碰。
- **机检读数（2026-10-08）**：设计档 **775 行**、**>300 字符行 0 行**；AC 编号仍为 AC-12 / AC-14 / AC-15；用例 33–42 编号未变、未新增用例。
- **§7-K25..K28 与 §10 口径核对**：K25（判据 + 回退两层）/ K27（源码树出处）/ K28（真实探针为加值面、条件运行）已同步；§10 边界逐条复核与修正后契约**无冲突**（未改）。

## §3 设计评审（评审子代理）

### 轮次 1（评审子代理）

| # | Category | Severity | Issue | Suggestion |
|---|----------|----------|-------|------------|
| 1 | Feasibility / Acceptance | 🔴 | B3 的强制测试面包含“本机默认 APFS”真实临时目录大小写测试，以及 `/tmp/<临时目录>` 与 `/private/tmp/<同名>` 的真实别名测试（`docs/design/DESIGN-dsh-subagent-thincoder.md:536-540`）；同时测试命令要求 B3 测试与两档冻结测试全绿（`docs/design/DESIGN-dsh-subagent-thincoder.md:547-549`）。设计没有定义非 macOS 主机上的条件跳过、可移植临时目录/符号链接夹具或支持矩阵；但需求 AC-12/AC-14 是跨平台的文件系统语义验收（`docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md:158-161`）。因此在 Windows 或没有 `/private/tmp` 的 POSIX 主机上，验收面可能无法稳定执行。 | 将真实文件系统探针改为可移植的临时目录与受控符号链接夹具；对无法提供该语义的主机明确条件跳过，仅保留注入桩测试为必测，并在验收命令旁写明平台支持矩阵与跳过判定。 |
| 2 | Clarity / Acceptance | 🔴 | `canonicalPath` 的 N1 契约规定 realpath 错误由该函数捕获并回退（`docs/design/DESIGN-dsh-subagent-thincoder.md:526`），但 N5 只规定 `linkKey` 调用注入的 `canonicalize`（`docs/design/DESIGN-dsh-subagent-thincoder.md:530`）；与此同时测试面要求一个会抛错的 `canonicalize` 桩仍“不抛错”并回退（`docs/design/DESIGN-dsh-subagent-thincoder.md:540`、`docs/design/DESIGN-dsh-subagent-thincoder.md:664`）。若回退责任只在默认 `canonicalPath`，该用例会失败；若 `linkKey` 也吞掉任意注入函数异常，则产生了 N1/N5 未声明的新运行时契约。 | 明确回退责任只能属于 `canonicalPath`，并改测试为验证默认函数的真实失败面；或明确 `linkKey` 对 `canonicalize` 异常统一回退到已解析路径，并在 N5、接口契约与所有回退用例中写出该行为。 |
| 3 | Affected-file annotations | 🟡 | B3 受影响文件表为新增测试文件标注了 `现况行数 = —`、`B3 动作 = 新增（≤160 行）`（`docs/design/DESIGN-dsh-subagent-thincoder.md:177-182`），没有给出数值基线和 `≤±N` 形式的预期增量；这不完全满足本轮要求的每个源文件/测试文件都标出现况行数与预期 delta。 | 将新增测试文件明确标为基线 `0` 行，并写成新增总量/增量 `+≤160 行`（或等价的明确新文件口径）。 |

VERDICT: changes-required
计数：🔴 2，🟡 1，🔵 0

### 轮次 2（评审子代理）

| # | Orig# | File | Severity | Status | Notes |
|---|---:|---|---|---|---|
| 1 | 1 | docs/design/DESIGN-dsh-subagent-thincoder.md | 🔴 | Fixed | 当前测试面已改为 `mkdtemp` 自建夹具且不依赖 `/private/tmp`（:538）；真实大小写探针按运行时卷语义条件执行并可跳过（:540）；真实符号链接夹具在无法创建时跳过、桩注入仍必测（:541）；平台支持矩阵与三档全绿口径已明确（:553-562）。需求 AC-12/AC-14 的必测语义由桩注入覆盖，跨平台阻断已解除。 |
| 2 | 2 | docs/design/DESIGN-dsh-subagent-thincoder.md | 🔴 | Fixed | 当前契约明确 `linkKey` 捕获包括注入桩在内的 `canonicalize` 任意异常并回退到已 `resolve` 路径，键构造不抛错（:303、:420、:428-429）；N5 与回退测试面同步写明该责任（:532、:542），与 N1 默认 `canonicalPath` 自身兜底的两层责任一致。 |
| 3 | 3 | docs/design/DESIGN-dsh-subagent-thincoder.md | 🟡 | Fixed | B3 受影响文件表已将新增测试文件现况标为 `0`，动作标为 `+≤160 行`，并明确 `0 → ≤160 行` 的总量口径（:177-185）。 |

VERDICT: pass
Counts: 🔴 0 unresolved (2 fixed); 🟡 0 unresolved (1 fixed); 🔵 0

## §4 用户批准（主 agent）

**用户批准（2026-10-08）：批准 B3 设计，指令进 §5 实施。**

- **批准对象**：`docs/design/DESIGN-dsh-subagent-thincoder.md`（775 行；与 §3 轮次 2 判 `pass` 的版本同一，此后零写入）。
- **批准方式**：用户口述授权（2026-10-08）—— 「批准 B3 设计，进 §5 实施」。
- **批准依据**：设计评审 §3 轮次 2 判 `pass`（3/3 Fixed · 0 unresolved）；设计已逐条回答 §1 的三问。
- **令牌**：设计令牌已签发并持有于本会话槽内（**按纪律不落数值、不回显**）。
- **批准范围**：本批 2 条 —— 台账 #20 P10 收口 · #21 P9 收口；落位按设计档 §6.2 动作表 N1–N7。
- **用户同批裁定（2026-10-08）**：上抛 #14 取 A（旧记录不迁移、不扫描）· #15 批准改写需求档 P10 措辞（win32 折降为「realpath 给不出答案时的补充」）· #13 / #16 / #17 取设计倾向 A · 设计档 dsh 引用「双坐标并存」登记为技术待办（台账 id 23）。
- **批准后动作**：派 eng-coder 实施（§5）；交付后由父代理亲跑三档测试与结构门禁、回填 §6 并核销 #20 / #21。

## §5 实施记录（eng-coder）

**状态行**：实施完成（N1–N7 全落位；三档 0 fail；四项行数 ≤ 预算；内部审计两轮 converged；advisor 代码评审无结论（三次终止））

**交付摘要（逐条 N1–N7）**

| 动作 | 落点 | 状态 | 读数 |
|---|---|---|---|
| N1 | `src/platform.mjs#canonicalPath` | Done | `realpathSync.native(path)` + `catch { return path }`；不抛错、不做部分解析 |
| N2 | `src/platform.mjs#environmentValue`（模块私有，未导出） | Done | 精确大小写优先 → 未命中且平台为 win32 时按 `toUpperCase()` 全表扫一次；非 win32 直返精确值 |
| N3 | `src/platform.mjs#resolveInterpreter(subprocess, env, platform)` | Done | 配置 / 宿主两个候选改经 `environmentValue` 读取；候选顺序（配置 → 宿主 → 字面 `'cmd.exe'`）不变 |
| N4 | `src/platform.mjs#resolveLaunchArgv` | Done | `platform` 透传给 `resolveInterpreter`；argv 规则（win32 包装 + 元字符检出先于解析）逐字未动 |
| N5 | `src/session-store.mjs#linkKey` | Done | 第四参 `canonicalize`（默认 `canonicalPath`）；键 = `parentSessionId + NUL + keyPath(canonicalize(resolve(cwd)), platform)`；入参校验先于归一；注入函数抛出的任何异常由 `linkKey` 捕获并回退到已 `resolve` 的路径 |
| N6 | `docs/batches/B3-dsh-subagent-thincoder-platform-closeout.test.mjs`（新） | Done | 十个测试面一一对应；桩注入面必测、真实探针按 §6.2 支持矩阵条件运行 |
| N7 | `docs/USER-SKILL-delegate-to-thincoder.md` | Done | §3 表第 4 行键形态改写 + §5 变更记录一行（2026-10-08 B3） |

**逐文件实测行数 vs 预算**（口径 = `content.split('\n').length`）

| 文件 | 实测 | 预算 | 余量 |
|---|---|---|---|
| `src/platform.mjs` | 118 | ≤119 | 1 |
| `src/session-store.mjs` | 161 | ≤161 | 0（顶格） |
| `docs/batches/B3-dsh-subagent-thincoder-platform-closeout.test.mjs` | 160 | ≤160 | 0（顶格） |
| `docs/USER-SKILL-delegate-to-thincoder.md` | 61 | ≤62 | 1 |

改动文件 >300 字符行 = 0（最长行 = B3 测试 `:145` 206 字符、`src/platform.mjs` 140 字符；USER-SKILL 最长 294）。

**三档测试读数原文**（仓根 `node --test <file>`）

- B1：tests 32 · pass 32 · fail 0 · skipped 0 · todo 0（= 期望 32/0）
- B2：tests 6 · pass 5 · fail 0 · skipped 1 · todo 0（= 用户实测读数「5 pass + 1 skip」原样对照）
- B3：tests 10 · pass 10 · fail 0 · skipped 0 · todo 0（本机 macOS APFS：两条真实探针判据均满足 ⇒ 运行；`/tmp` 为符号链接、卷大小写不敏感均成立）

**结构门禁机检读数**

- `grep -rn "win32" src/` ⇒ 只命中 `src/platform.mjs:33` / `:58` / `:93`
- `grep -rn "process.platform" src/` ⇒ 只命中 `src/platform.mjs:26`
- `grep -rnE "nvm4w|USERPROFILE|C:\\|/Users/" src/` ⇒ 零命中

**冻结面共存前提（复核）**：`/tmp/ws` 不存在 · 仓根无 `WS` / `ws` · `realpath(仓根) === 仓根` ⇒ B1:218 与 B2:109/:110/:121 四条断言走 realpath 回退面、逐字不变；B2:111（`keyPath` 纯字符串折）因 `keyPath` 逐字未改而天然不变。两档冻结测试的实测读数即该前提成立的机械证据。

**审计与代码评审轮次与终态**

| 轮次 | 类型 | 结论 |
|---|---|---|
| 1 | 内部偏离审计（explore，只读） | DEVIATIONS 2 条，均属测试「判别力」类、**0 条功能/行为偏差**：(a) 面 8 的 POSIX 反例空真且未声明可观测边界；(b) 面 6 的主机相关断言无诊断。其余核对全部成立：(a) N1–N7 无 PARTIAL · (c) 无 doc-drift · (d) 无 out-of-list（冻结面 mtime 早于本批实施窗口）· (e) `environmentValue` 未导出、`win32` 与 `process.platform` 均只落 `platform.mjs` |
| fix | 自身修正（1 轮） | 面 8 加一行注释声明可观测边界（用例 41 的字面期望不可观测：`environmentValue` / `resolveInterpreter` 是模块私有）；面 6 加 `else t.diagnostic(...)` 使主机相关形态自报。均无行为变化（`src/` 一字未动） |
| 2 | 内部偏离审计（explore，只读，复核 fix） | **converged（无遗留项）**：(i)(ii) 两条修复成立且注释断言与源码逐字相符；(iii) 十个测试面与 §6.2 十条一一对应、顺序一致；(iv) 无行为变化、无新增设计档漂移 |
| — | 内部 advisor 代码评审 | **不可用**：3 次尝试均未产出评审结论（2 次返回 `review failed (unknown) — terminated`，1 次仅返回中途 trace、无 findings/VERDICT）。按工具提示「retry or proceed to verify manually」停止重试，未静默跳过 |

**fix round 记录**：1 轮（上述 fix）。终态 = 内部审计 `converged`；advisor 代码评审环节 = 无结论（非本侧未执行：已尽三次尝试）。

**未做项 / 上抛项**

1. **advisor 内部代码评审未产出结论**（三次尝试返回终止/截断）。若父侧需要该环节的证据，请在父侧再触发一次；本侧已尽三次、不静默跳过。
2. **§9.3 用例 41 的字面期望在本层不可观测**：`environmentValue` / `resolveInterpreter` 按 §5.9 / N2 是模块私有，且 POSIX 分支在任何读取之前即返回 ⇒ 「按宿主值 / 字面 `'cmd.exe'` 中标」无法从模块外断言。本批以「POSIX 逐字 argv + 零探测」作为其**可观测形态**，并在 B3 测试 `:144` 注释披露。若设计方要该条严格可断言，需给读取面开导出缝——本批未扩面。
3. **行数两项顶格**：`src/session-store.mjs` 161/≤161 与 B3 测试 160/≤160 均为上限、无余量；本批未突破，后续再补一行即超。
4. **无超预算项、无前提被破项、无 out-of-list 变更**：四个改动文件全在批准清单内。

## §6 验证与收口（父代理）

**状态行**：已收口（2026-10-08）
**结算**：本批条目 2 条（台账 #20 P10 收口 · #21 P9 收口）全部落地并实测；设计令牌已消费；前身条目 #19 一并追认核销；本批新登记遗留 1 条（台账 #24）。

### 一、本次交付（逐文件；行数口径 = 换行符计数，与 `docs/STANDARDS.md` §2 同）

| 落点 | 动作 | 实测 | 预算 | 判定 |
|---|---|---|---|---|
| `src/platform.mjs` | 修改 | 117 | +≤24（现况 94） | ✅ +23 |
| `src/session-store.mjs` | 修改 | 160 | +≤5（现况 155） | ✅ +5（顶格） |
| `docs/batches/B3-dsh-subagent-thincoder-platform-closeout.test.mjs` | 新增 | 159 | ≤160 | ✅ |
| `docs/USER-SKILL-delegate-to-thincoder.md` | 修改 | 60 | +≤2（现况 59） | ✅ +1 |
| `docs/batches/B1-*.test.mjs` · `docs/batches/B2-*.test.mjs` | 不改 | 698 / 140 | ±0 | ✅ git 面零改动 |

### 二、验收逐条判决（父代理亲跑，2026-10-08）

| 判决项 | 结果 | 实测证据 |
|---|---|---|
| AC-12 | ✅ | B3 单测面 [1]/[2]/[3]：大小写不敏感语义（桩）⇒ 同一键；大小写敏感语义（恒等桩）⇒ 两键；真机 APFS 真实临时目录两形态 ⇒ 同一键 |
| AC-14 | ✅ | B3 单测面 [4]/[5]：符号链接别名 ⇒ 同一键（桩必测 + `mkdtemp` 自建夹具）；`canonicalize` 抛错 / 路径不存在 ⇒ **不抛错**、回退字符串归一 |
| AC-15 | ✅ | B3 单测面 [8]：win32 下 `{COMSPEC}` ≡ `{ComSpec}` ⇒ 同一解释器；候选顺序（配置 → 宿主 → 字面 `'cmd.exe'`）不变 |
| AC-11 / AC-13（不在本批变更面） | ✅ 未回退 | B2 档 `5 pass / 1 skip / 0 fail`；B3 单测面 [7] 显式重放 argv 包装断言 |
| 三档测试 | ✅ | B1 `tests 32 · pass 32 · fail 0 · skipped 0`；B2 `tests 6 · pass 5 · fail 0 · skipped 1`；B3 `tests 10 · pass 10 · fail 0 · skipped 0`（父代理亲跑） |
| 结构门禁 | ✅ | `grep -rn "win32" src/` 仅 `platform.mjs:33/:58/:93`；`grep -rn "process.platform" src/` 仅 `platform.mjs:26`；硬编码安装路径（`nvm4w` / `USERPROFILE` / `C:\\` / `/Users/`）零命中 |
| 文档行宽 | ✅ | 四个改动文件 >300 字符行 = 0 |
| 冻结面共存前提 | ✅ | `/tmp/ws` 不存在 · 仓根无 `WS` / `ws` · `realpath(仓根) === 仓根`；两档冻结测试实测全绿即该前提成立的机械证据 |

### 三、交付评审与裁定

- **内部偏离审计**（eng-coder）：2 轮，终态 `converged`；0 条功能/行为偏差（2 条测试判别力类已在 fix 轮自修）。
- **内部 advisor 代码评审：未产出结论**（三次尝试返回终止 / 截断；子代理已如实上报，未静默跳过）。
- **父代理补位（阻塞式独立代码评审）**：对 B3 交付面 + 设计 / 需求档发起一次代码评审，判 `changes-required`（🔴1）。裁定：

| # | Action | Detail |
|---|---|---|
| 1 | Not an issue | 评审称「win32 目标命令解析若返回 `undefined`，会把 `undefined` 当 argv[0] 继续走」——**前提不成立**：dsh 的 `resolveExecutable` 声明 `Promise<string>`（源码树 `deepseek-harness/packages/subprocess/subprocess-local/src/index.ts:140-144`），空串入参抛错（`:145`）、相对路径抛错（`:149-153`）、未命中抛 `SubprocessExecutableNotFoundError`（`:168-170`）⇒ **不存在返回空值的路径**；插件侧 `try/catch` 已覆盖其全部失败面，设计契约「解析失败 ⇒ 可读错误、零进程」成立。残留项「目标解析面未做非字符串校验（解释器候选面有）」已登记台账 **#24**（条件）；未在本批修的理由 = `src/platform.mjs` 预算余量仅 1 行、B3 测试文件 159 / ≤160 亦近顶格，且该路径经真实 seam 不可达。 |

- **子代理如实上报的另两项**（已核，不阻断）：① §9.3 用例 41 的字面期望在模块外不可观测（`environmentValue` / `resolveInterpreter` 为模块私有），实现侧以「POSIX 逐字 argv + 零探测」为可观测形态并在测试 `:144` 注释披露 —— AC-15 的自身判定方式由单测面 [8] 覆盖，故不构成验收缺口；② 两项行数顶格（`session-store.mjs` +5/≤+5 · B3 测试 159/≤160）未突破预算，但**再补一行即需调预算**。

### 四、收口核验清单（结算同步）

| 项 | 状态 |
|---|---|
| 角色表（一段一作者） | ✅ §1/§4/§6 主 agent · §2 eng-designer · §3 评审子代理 · §5 eng-coder |
| 状态行 | ✅ §1/§2/§5 已更新；§6 本行（§1 随收口转「已收口」） |
| 计数（条目 / 文件 / 用例） | ✅ 条目 2 = 台账 #20 / #21 = 需求档 P9 / P10；文件 4 改动 + 2 冻结不改；用例 33–42 |
| 指针 | ✅ 批次档 ↔ 需求档（P9 / P10 · AC-12 / AC-14 / AC-15）↔ 设计档（§4.3 / §4.4 / §5.9 / §6.2 / §7-K25..K28 / §8 / §9.3）三链同源 |
| 变更记录 | ✅ 需求档 §7 两行 · 设计档 §13 两行 |
| 待办勾稽 | ✅ #20 / #21 核销 · #19 追认核销 · 新登记 #24；#22 / #23 保持开着 |
| 前批遗留交叉核 | ✅ B1（2026-10-06）/ B2（2026-10-08）均无「条目已办、锚档未收口」的遗留 |
| 台账可见面 | ✅ 权威库 = mac 库（口径见 `docs/STANDARDS.md` §5） |
| 文档地图 | ✅ `docs/README.md` 已登记 B3 档（已收口）与本批测试文件；`docs/STANDARDS.md` §2 的 B1 测试行数参照值同步为 698 |
| 设计令牌 | ✅ 已消费（本批链路终结） |

### 五、随本批仍开着的（已上榜）

| # | 事项 | 台账 |
|---|---|---|
| 1 | `src/platform.mjs` 目标解析面未做非字符串校验（本批代码评审残留项） | #24（条件） |
| 2 | 文档行宽债务（B1 / B2 两档 10 行 + B3 档 §3 两条评审行：评审表单元格不可折行） | #22（条件） |
| 3 | 设计档 dsh 引用双坐标并存 | #23（条件） |
| 4 | 文件规模（`src/driver.mjs` 500 · B1 测试 698） | #17（条件） |
| 5 | 两项行数顶格（`session-store.mjs` 顶预算 · B3 测试顶上限） | 如实记录，不阻断 |

### 六、测试线

- 本批单元测试文件 = `docs/batches/B3-dsh-subagent-thincoder-platform-closeout.test.mjs`（159 行 · 10 例），随档存放、`node --test` 直跑，后续批次可复跑。
- 集成场景**无新增 / 修订**（本仓无产品 `test/` 树）。
- 仓库级测试脚本：`package.json` **未声明 `scripts`**（无仓库级套件）⇒ 本仓的机械回归面 = 三档批次测试文件（B1 / B2 / B3），本轮父代理已亲跑。

### 七、暂缓批复核

**暂缓批复核：无**（本仓无带「暂缓 · 复核条件」标记的批次）。
