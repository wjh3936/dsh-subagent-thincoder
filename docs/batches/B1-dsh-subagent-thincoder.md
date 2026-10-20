# 2026-10-05 · dsh-subagent-thincoder
> 六段 append-only，一段一作者：§1 讨论（主 agent）· §2 批次任务与设计（eng-designer）· §3 设计评审（评审子代理）· §4 用户批准（主 agent）· §5 实施记录（eng-coder）· §6 验证与收口（父代理）。
> 编制：主 agent · 2026-10-05 · 来源 = 用户口述（2026-10-05）：dsh 经 ACP 调 thincoder 时因 dsh-subagent-acp 不支持 load/resume，评审通过后的 designToken 无法跨会话使用；以插件形式补足会话续用并做 thincoder 场景适配。
> 台账 = #1–#8（REQUIREMENTS-dsh-subagent-thincoder · 归批）。前情 = 无（首批）。
## §1 讨论（主 agent）
**状态行**：已收口 2026-10-06

**本批条目（8 条，与需求档 §2 同源）**：P1 插件包形态与挂载 · P2 ACP 子代理 provider ·
P3 会话续用与持久化（核心） · P4 模型面工具 subagent_thincoder · P5 槽生命周期与并发 ·
P6 工程模式前置 · P7 会话枚举 · P8 验证面。

**关键判据（全部由用户裁定）**：

- 交付落点 = 本仓；`dsh-thincoder` 是另一个独立插件，与本模块无关（不并包、不互引）。
- 续用策略 = 默认接回旧会话，除非显式要求新开。
- 九项适配建议全部采纳（cwd 恒定 / 槽冲突透传 / 工程前置 / 关闭语义 / 权限 / 流映射 /
  会话枚举 / stopReason / 多步续用）。
- 允许并发推进（用户口径：以最快速度实现——并发是手段，不因此裁剪步骤）。

**断点事实（已逐行核实，出处见需求档 §6）**：dsh 的 ACP provider 每次 run 只走
`initialize`→`session/new`→`session/prompt` 且不存远端会话号；dsh 的续用机制只服务进程内子代理，
跨进程 ACP 子代理结构上无法接入；thincoder 侧已具备会话族能力，且 designToken 的权威台账是
会话槽文件（接回同槽即恢复）。

**授权口径**：需求讨论已收口（2026-10-05），用户已指令开始；`git init` 未做（仓内暂无版本控制，
用户未要求）。

**补充授权（2026-10-05）**：用户预授权 —— 设计档回报后，若核对无问题、且无需要用户裁决之处，
主 agent 可直接发起设计评审（firing 权由用户以预授权方式行使，非同人自决）；
若存在上抛项或需要裁决之处，则停下请示，不自行放行。

**需求修订（2026-10-05，设计期上抛后裁定）**：P6/AC-6 原判据「无工程清单的工作区接回工程会话 ⇒ 可读错误」
与代码事实不符 —— 已核实 `thincoder-core/manifest.mjs:200-235`：`resolveEngineeringManifest` 的 `init`
默认 true，**缺档会就地建档后照常接回**（`:228-231`），并不拒载；真正拒载的是 `invalid` / `ambiguous` /
`init-failed` 三类，文案族「项目不可解析」。裁定：保留 P6 机制（前置失败转可读工具错误），触发条件改为
「工程档不可解析」，AC-6 改为可复现构造（放一份非法工程档）。需求档 §2-P6、§4-AC-6、§6 事实表、§7
变更记录已同步。上抛方 = eng-designer#1；裁定方 = 主 agent（属需求档自持面的文实对齐，未扩范围）。

## §2 批次任务与设计（eng-designer）
**状态行**：设计完成（设计档 docs/design/DESIGN-dsh-subagent-thincoder.md 落稿；P6/AC-6 按用户裁定落地。）
<§2 模板占位：本批条目（覆盖） / 设计档落点 / 机制设计 / 受影响文件与测试面 / 验收对照 / 关键决策 / 上抛项>

**本批条目（8 条，与需求档 §2 同源，无增删）**：P1 插件包形态与挂载 · P2 ACP 子代理 provider ·
P3 会话续用与持久化（核心） · P4 模型面工具 `subagent_thincoder` · P5 槽生命周期与并发 ·
P6 工程模式前置 · P7 会话枚举 · P8 验证面。

**设计档落点**：`docs/design/DESIGN-dsh-subagent-thincoder.md`（385 行）。含：问题陈述 / 方案与理由 / 包与插件身份 /
受影响文件清单 / 接口契约 / 逐行动作表（40 行）/ 关键决策 K1–K16 / 验收对照 P1–P8 ↔ AC-1..AC-9 /
用例表（14 例）/ 边界 / UI 决策（无 UI，无 open 项）/ 上抛项 / 变更记录。

**机制设计（一句话）**：注册一个 ACP 子代理 provider + 两个模型面工具；每次委派 = 起一个 `thincoder acp` 子进程，
走 `initialize` → 会话建立（`session/new` 或 `session/resume`，默认续用）→ `session/prompt` → 取最终答复文本
→ 先 `session/close` 再断开进程；「父 dsh 会话 + 工作区 → thincoder 会话号」落盘续用。

**本批钉死的设计决策（摘）**：

- 包名/插件 id `dsh-subagent-thincoder`，`dsh.bundle.patch` → `./cordis.patch.yml`，零构建纯 ESM；`inject = ['tools','subagents','subprocess','storageDomain']`（硬注入，缺则启动失败）。
- 续用判据：显式 `sessionId` 与显式 `new` 互斥；都不给 → 查记录，有则 `session/resume`，无则 `session/new`。
- 槽不存在**不自动回退**，报可读错误；记录只在成功建立后重写（避免静默丢连续性）。
- 断开顺序固定：`session/close`（best-effort）→ stdin EOF →（必要时）terminate → waitForExit。
- 存储面：`storageDomain` 的独立 domain `subagent_thincoder`（下划线；`UNIT_NAME_RE` 不容连字符，也不得复用已被 `dsh-thincoder` 长开的 `thincoder`），表 `session_links`，键 = `parentSessionId + NUL + resolve(cwd)`。
- 复用 `@deepseek-ai/dsh-subagent` 的 out-of-process 助手（`NO_START_CAPABILITIES` / `resolveChildCwd` / `validateConfiguredCwd` / `assertPositiveFinite` / `AssistantOutputFold` / `settleRunResult` / `subprocessRunHandle`）；
  ACP 线驱动与 stopReason 映射自持（`@deepseek-ai/dsh-subagent-acp` 当前 profile 未安装，包根也不导出这两个符号）。
- 会话选择经 `ctx.subagents.start` 的插件私有字段 `thincoderSession` 传递、会话号经 run 句柄 `thincoderSessionId` 回带（运行期依据：`dsh-subagent/lib/index.js:3125-3128` 的 `{...request}` 透传、`:260-284` 的 `observeRun` 原样返回）。
- P7 = 独立只读工具 `subagent_thincoder_sessions`（不改 P4 钉死的参数面）。
- P6 按用户裁定：拒载面 = 工程档**不可解析**（invalid / ambiguous / init-failed）；**缺档不是拒载面**；工具错误必须携带 thincoder 的 `/项目不可解析/` 文案族，不得吞。

**受影响文件与测试面**：本仓无既有源码，**全部为新增文件**，无既有文件被修改（profile 文件不在本批写域内）：

`package.json` · `cordis.patch.yml` · `src/index.mjs` · `src/config.mjs` · `src/session-store.mjs` · `src/errors.mjs` ·
`src/stop-reason.mjs` · `src/connection.mjs` · `src/driver.mjs` · `src/provider.mjs` · `src/tools.mjs` ·
`docs/batches/B1-dsh-subagent-thincoder.test.mjs`（单元测试文件，随本批次档存放，直接 `node --test` 跑）。

测试面：单元测试覆盖六个变更面（config / session-store / stop-reason / errors / 工具参数校验 / driver 会话选择判据）；
集成面本批不新增（端到端按 AC-2 / AC-5 / AC-6 / AC-9 走 dsh 侧真实委派，收口在 §6 回填）。

**验收对照（P → AC → 怎么验）**：

| 需求点 | 验收 | 怎么验 |
|---|---|---|
| P1 | AC-1 | 按设计档 §3.2 挂载后启动 dsh，日志无 loader 报错；`node -e "import('./src/index.mjs').then(m=>console.log(m.name,m.inject))"` 输出 `dsh-subagent-thincoder` 与四项注入 |
| P2/P4/P8 | AC-8 | `node --test docs/batches/B1-dsh-subagent-thincoder.test.mjs` 全绿 |
| P3 | AC-2 | 同 dsh 会话 + 同工作区连续两次委派：返回会话号相同；该槽文件 history 条数继续增长（同一文件） |
| P3 | AC-3 | 第二次带 `new: true`：返回会话号与第一次不同 |
| P3 | AC-9 | 端到端：第一条会话内评审通过产出 designToken → 第二次接回同槽 → 该会话内令牌可用（以槽文件令牌台账为准） |
| P4 | AC-4 | 传入 AC-2 的会话号：返回同一会话号 |
| P5 | AC-5 | 委派结束即刻再次接回同槽：会话号仍相同；thincoder 日志无 `slot busy, forked to` 后缀 |
| P6 | AC-6 | 目标工作区放一份非法工程档，再接回工程会话：工具错误文本含 `/项目不可解析/` |
| P7 | AC-7 | 调用 `subagent_thincoder_sessions`：返回集合含 AC-2 的会话号 |

**上抛项（4 条，详见设计档 §12）**：

1. 需求与现实冲突（**已由用户裁定**）：AC-6 原「无工程清单 ⇒ 拒载」不可复现（thincoder 对缺档就地建档后照常接回）；已按裁定改为「工程档不可解析」并在设计档落地。
2. 环境发现（非阻断）：`~/.dsh/profiles/web/cordis.patch.yml:108-123` 挂载的 `@deepseek-ai/dsh-subagent-acp` 在 profile 与真实树中均不存在；本设计的替换挂载形态已不引用该包。
3. 协议限制（非阻断）：`session/resume` 应答不含会话号；目标槽被另一活进程占用时 thincoder 静默 fork，插件线上观测不到（AC-2/AC-5/AC-9 为单路场景，不受影响）。
4. 命名约束：domain 名受 `UNIT_NAME_RE` 限制，取 `subagent_thincoder`（下划线）。

**环境事实更正（2026-10-06 · 定点修复轮）**：本段两处 `@deepseek-ai/dsh-subagent-acp` 安装状态表述（设计决策摘「该包当前 profile 未安装」、上抛项第 2 条「在 profile 与真实树中均不存在」）**据实更正**为：该包**已安装**于 profile 自带树 `~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-subagent-acp/`（版本 `0.2.0-rc.2`）；`~/.dsh/profiles/node_modules` 是指向真实树的软链，其下与真实树均无此包。**结论不变**：包根 `exports["."]` → `./lib/index.js` 只导出 `name`/`inject`/`Config`/`apply`，线驱动复用不到，且其握手正是本模块要修的断点 ⇒ ACP 线驱动与 stopReason 映射仍自持、替换挂载形态仍不引用该包。设计档同步位置：§7-K5 注、§12 第 2 行。

**数字失效更正（2026-10-06 · 定点修复轮）**：本段两处数字经其后三轮修复已失效，**据实更正**为：
① `:74`「测试面：单元测试覆盖六个变更面（config / session-store / stop-reason / errors / 工具参数校验 / driver 会话选择判据）」—— **六个变更面 → 十个**（权威处：设计档 §6-K1 清单 / §8-AC-8）；
② `:47`「`docs/design/DESIGN-dsh-subagent-thincoder.md`（385 行）」—— **385 行 → 397 行**（当前 `wc -l` 读数）。
结论不变：测试面仍为单元测试（桩/假件）；集成面本批不新增。

## §3 设计评审（评审子代理）

### 轮次 1（评审子代理）

| # | Orig# | File | Severity | Status | Notes |
|---|-------|------|----------|--------|-------|
| 1 | (new) | docs/design/DESIGN-dsh-subagent-thincoder.md | 🔴 | New | 配置读取时机存在机制级冲突：设计契约把 `command`、`args`、`cwd` 定为每次委派读取，且说明行为叶运行期生效；但逐行动作表又要求 `resolveIdentity` 在装载期解析这三项。当前文档原文：`DESIGN-dsh-subagent-thincoder.md:77: | command | string，thincoder | 是 | 每次委派 |`；`DESIGN-dsh-subagent-thincoder.md:79: | cwd | string，''（空 = 取父会话 cwd） | 是 | 每次委派（经 readLiveLeaf） |`；`DESIGN-dsh-subagent-thincoder.md:85: 理由：身份叶决定注册面（provider 名、工具名），**运行期改名必须触发重挂载**才能重注册目录，故不标 volatile；行为叶在每次委派/teardown读取，标 volatile 使设置写入就地生效、不打乱已注册目录。`；`DESIGN-dsh-subagent-thincoder.md:266: | B3 | 导出 `resolveIdentity(config)`：装载期解析 providerName/toolName/sessionToolName/command/args/cwd | `。若按 B3 实施，运行期修改行为配置不会按契约生效；若按契约实施，B3 的装载期解析定义失效。须在批准前统一机制与动作表。 |
| 2 | (new) | docs/design/DESIGN-dsh-subagent-thincoder.md | 🔴 | New | 并发续用时会话号可能被错误回报和持久化：设计要求同工作区并发放行并声称透传会话号，但同时明确 `session/resume` 无会话号，目标槽被占用时会静默 fork，插件在线上不可观测；随后又把本次会话号定义为请求中的旧 `sessionId`。当前文档原文：`DESIGN-dsh-subagent-thincoder.md:28: - **不自造全局锁（P5）**：同工作区多路并发一律放行；槽冲突交给 thincoder 自己的「占用则 fork」语义；插件如实透传结果里报告的会话号。`；`DESIGN-dsh-subagent-thincoder.md:206: - `session/resume` → 应答**不含**会话号（`ResumeSessionResponse` 只有 `configOptions`；`handlers-slots.mjs:139-194`）；本次会话号 = 请求里的 `sessionId`。`；`DESIGN-dsh-subagent-thincoder.md:379: 3 | 协议面限制（非阻断） | `session/resume` 的应答不含会话号（`ResumeSessionResponse` 仅 `configOptions`）；若目标槽被另一活进程占用，thincoder 会**静默 fork 到新槽**（`handlers-slots.mjs:170-187`），插件在线上观测不到 | 上报。P5 的「如实透传」对 `session/new` 完全成立（应答含号）；对 resume，插件报告的是本次 ACP 会话 id（请求原文）。AC-2/AC-5/AC-9 为单路场景，不受影响 |`。这会使工具输出及 `store.remember` 仍指向旧槽，而实际工作可能已在新槽，破坏并发场景下的可续用语义；不能仅作为非阻断发现，须明确并发时的会话号/记录处理契约或改变并发策略。 |
| 3 | (new) | docs/design/DESIGN-dsh-subagent-thincoder.md / docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md | 🔴 | New | P8 的测试计划没有覆盖需求声明的全部变更面：需求要求每个功能点的变更面配单元测试，而设计的 K1 只列出 config/store/stop-reason/errors/工具校验/driver 判据六类，AC-8 也只列 stopReason、参数互斥、会话选择和诊断文本。当前文档原文：`REQUIREMENTS-dsh-subagent-thincoder.md:101: - 每个功能点的变更面配单元测试文件（随批次档存放，直接 [?25l`node --test`[?25h 跑）。`；`DESIGN-dsh-subagent-thincoder.md:301: | K1 | 单元测试文件（六个变更面：config/store/stop-reason/errors/工具校验/driver 判据） | `；`DESIGN-dsh-subagent-thincoder.md:332: | P2 / P4 / P8 | AC-8 | `node --test docs/batches/B1-dsh-subagent-thincoder.test.mjs` 全绿（stopReason 映射、参数互斥、会话选择四判据、诊断文本边界） |`。按现有计划，连接/权限/断开阶梯、provider/cwd、会话枚举、插件挂载等功能面没有对应的单元测试验收，设计未满足 P8。须补齐测试面或由需求/设计明确裁定覆盖边界。 |
| 4 | (new) | docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md | 🟡 | New | 需求档内部存在工程档缺失判据冲突：一处仍写成必须有工程清单，另一处又明确缺档不是拒载面；设计档采用后者。当前文档原文：`REQUIREMENTS-dsh-subagent-thincoder.md:91: - 「工作区没有工程档」**不是**拒载面：thincoder 会在锚处就地建档后照常接回，插件不得把缺档当失败。`；`REQUIREMENTS-dsh-subagent-thincoder.md:134: - 工作区需有 ThinCoder 工程清单时方可跑工程模式会话（P6）。`。这是文档状态矛盾，按规则为非阻断项，但应在父文档层清理。 |

VERDICT: changes-required

计数：🔴 3，🟡 1，🔵 0

### 轮次 2（评审子代理）

| # | Orig# | File | Severity | Status | Notes |
|---|-------|------|----------|--------|-------|
| 1 | 1 | `docs/design/DESIGN-dsh-subagent-thincoder.md` | 🔴 | Fixed | 当前配置表将 `command`、`args`、`cwd` 标为每次委派读取；B3 明确装载期只解析身份叶，行为叶由 driver 按次读取，配置读取时机已统一。 |
| 2 | 2 | `docs/design/DESIGN-dsh-subagent-thincoder.md` | 🔴 | Fixed | 当前设计明确规定 resume 无法获得新号时回报/记录请求号，并明确静默 fork 时可能与实际槽不一致；需求档 P5 同样将其定义为已知限制并要求告知使用方，口径已对齐。 |
| 3 | 3 | `docs/design/DESIGN-dsh-subagent-thincoder.md` / `docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md` | 🔴 | Fixed | K1/§6 当前列出十个变更面，覆盖配置、存储、stop reason、错误、工具、枚举、provider cwd、连接、driver、插件身份；AC-8 引用该十面清单。 |
| 4 | 4 | `docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md` | 🟡 | Fixed | P6 与依赖段均明确不可解析才拒载，缺档由 thincoder 就地建档且不算失败，矛盾已消除。 |

VERDICT: pass
计数：🔴 0 条未解决；🟡 0 条未解决；🔵 0 条未解决。

## §4 用户批准（主 agent）

**用户已批准（2026-10-06）**

- 批准对象：`docs/design/DESIGN-dsh-subagent-thincoder.md`，`sha256 = 55692040038ea8afdeafa722cb56baec1617aecfbf9faa2b482afaa5ba6e9217`（397 行）——与评审通过（§3 轮次 2 · VERDICT pass）同一版本；此后该档零写入。
- 批准方式：用户口述（2026-10-06）「评审通过了…那等收回来后就开始实施吧」——带条件；条件（把在飞的记录卫生轮次收干净并核对）已于同刻满足（id 9 落地并核验，批次档 §2 更正记在册，设计档哈希未变）。
- 令牌：评审已签发，按纪律不落文档、不回显数值。
- 批准后动作：派 eng-coder 按设计档 §6 动作表实现 11 个源文件 + 本批单元测试文件；父侧随后核验落地、跑单元测试，再走收口（§6 结算 + 台账核销 + 设计令牌消费）。

## §5 实施记录（eng-coder）

**状态行**：实施完成

### 交付摘要（本续做轮 · round=fix）

上一轮在 `src/connection.mjs` 前中断，交付回执为碎片。本轮按设计档 §6 动作表补齐缺失的 6 件；
上轮已落的 6 件本轮未改（形制性微调也未做）。

**12 项落点状态（设计档 §4 文件清单，逐项）**

| # | 落点 | 覆盖动作行 | 本轮处置 | 状态 |
|---|---|---|---|---|
| 1 | `package.json` | A1 | 上轮已落，本轮未改 | ✅ |
| 2 | `cordis.patch.yml` | A2 | 上轮已落，本轮未改 | ✅ |
| 3 | `src/config.mjs` | B1–B3 | 上轮已落，本轮未改 | ✅ |
| 4 | `src/session-store.mjs` | C1–C4 | 上轮已落，本轮未改 | ✅ |
| 5 | `src/errors.mjs` | E1–E4 | 上轮已落，本轮未改 | ✅ |
| 6 | `src/stop-reason.mjs` | D1 | 上轮已落，本轮未改 | ✅ |
| 7 | `src/connection.mjs` | F1–F4 | 本轮新落 | ✅ |
| 8 | `src/driver.mjs` | G1–G13 | 本轮新落 | ✅ |
| 9 | `src/provider.mjs` | H1–H3 | 本轮新落 | ✅ |
| 10 | `src/tools.mjs` | I1–I3 | 本轮新落 | ✅ |
| 11 | `src/index.mjs` | J1–J2 | 本轮新落 | ✅ |
| 12 | `docs/batches/B1-dsh-subagent-thincoder.test.mjs` | K1 + §6-K1 后十面清单 | 本轮新落 | ✅ |

12/12 落点已落。`node --test` 覆盖 §6-K1 后那行清单的**十个变更面**（全桩/假件，无真子进程、无真 ACP 端点）：

- config 身份叶解析与 `readLiveLeaf`
- store 键与 schema
- stopReason 映射
- errors 文本边界
- 工具参数互斥与返回文本
- sessions 应答解析
- provider cwd 解析与缺 cwd 报错
- connection 断开阶梯与权限应答
- driver 会话选择四判据
- index 身份导出

### 验证原样读数

`node --test docs/batches/B1-dsh-subagent-thincoder.test.mjs`（末 12 行）：

```
✔ driver: the four session-selection criteria (0.146875ms)
✔ driver: a startup rollback releases an established session before reaping the child (9.727584ms)
✔ index: exports the plugin identity the loader reads (1.711125ms)
ℹ tests 32
ℹ suites 0
ℹ pass 32
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 304.118292
```

`node -e "import('./src/index.mjs').then(m=>console.log(m.name, JSON.stringify(m.inject)))"`：

```
dsh-subagent-thincoder ["tools","subagents","subprocess","storageDomain"]
```

### 决策透明表（设计档未逐字钉死、由实现者裁定的落法）

| # | 裁定 | 理由 |
|---|---|---|
| T1 | `driver.mjs` 把 G2/G4/G5 的握手与建立收进私有 `establishSession(agent, target, cwd, onEstablished)`，由 `startThincoderRun` 调用 | 设计档 G2/G4/G5 锚点写作 `startThincoderRun.initialize/.new/.resume`；行为、参数、失败 stage 与设计一致，仅内部结构落位不同 |
| T2 | 额外导出 4 个纯函数供测试与复用：`permissionResponse`（connection）· `resolveDelegationCwd` / `resolveBehaviourSpec`（provider）· `resolveSessionTarget`（driver，设计档 G3 本就点名） | 单元测试需可注入；`resolveBehaviourSpec` 让「一次委派」与「会话枚举」共用同一份行为叶读取，避免两处读法漂移 |
| T3 | `closeSession` 增加可选第三参 `onError`（设计档钉死 `closeSession(agent, sessionId)`） | F4 要求「失败不抛（记日志）」；connection 是无 logger 的叶子模块，日志责任交调用点（driver 传 sink），主签名不变 |
| T4 | provider 在 `start()` 内按次用 `assertPositiveFinite` 校验两个 teardown grace | K5 点名复用该助手；两个 grace 是 volatile 行为叶、按次读取，故校验落在按次读取处（装载期会冻结行为叶） |
| T5 | 工具描述含设计档 §5.3 那句并发限制说明原文，但去掉其尾注「（见 §12-3）」 | 提示面纪律：模型可读的一切不得出现文档名 / 节号 / 「见 X」指针；说明本身逐字保留 |
| T6 | `listWorkspaceSessions` 观察 `request.signal`（与 `session/list` 赛跑，取消即中止） | 工具纪律：异步工作须观察 `exec.signal`；设计档 G13 未提取消，此处按上层纪律补上 |
| T7 | `startThincoderRun` 用 `randomUUID()` 作 run id，并以 `{...subprocessRunHandle(...), thincoderSessionId}` 回带 | 设计档 §5.2 要求在 run 句柄上回带 `thincoderSessionId`；`subprocessRunHandle` 返回固定字面量，展开追加是唯一不改共享读物的方式 |
| T8 | 单元测试文件在十个变更面之外增加 1 例「driver 启动回滚」 | 为代码评审轮 1 的 🔴 提供回归覆盖；十面清单不受影响 |

### 内部审计与代码评审（轮次与终态）

- **内部 explore 偏离审计**：1 轮。verdict `changes-required`，唯一发现 = 本 §5 未写入；**代码级零偏离**
  （F/G/H/I/J/K 六组动作行、钉死项、十个变更面逐条核对相符；无静默简化、无超清单改动、无文档漂移）。
  该发现由本段写入即消解。
- **内部 advisor 代码评审**：3 轮。
  - 轮 1：`changes-required` —— 2🔴 + 1🔵。
    🔴① 启动回滚未先 `session/close`（设计档 §5.8 要求取消 / 协议失败 / 启动回滚都先尽力关闭）；
    🔴② `terminalFailure` 对 `max_tokens`/`refusal`/`cancelled` 在无权限事实时返回 `undefined`
    （G12 / §9 用例 14 要求非 `end_turn` 都构造安全 diagnostic）；🔵③ 权限测试用墙钟轮询。
  - 修复：① 回滚路径先 `releaseSession` 再 `disposeChild`，并给在飞建立一个以 `disposeGraceMs` 为界的等待；
    ② `terminalFailure` 非 `end_turn` 一律返回固定安全行（新增 category `remote-stop`），
    本地取消仍走 `settleRunResult` 的 `cancelled` 分支、保持 `aborted`/killed；③ 权限等待改为写事件驱动。
  - 轮 2：`changes-required` —— 🔴（残留竞态：建立若在定界等待之后才落号，仍不会被释放）
    + 🔵（等待器未按 id 基线化）。修复：新增 `releasedSessions` 集合 + `releaseSession`（同一会话号最多关一次）
    + `rollback` 标志；`onEstablished` 在 rollback 已开始后就地释放；等待器按 id 匹配。
  - 轮 3：**`pass`**（四条发现全部 Fixed）。
- **终态：`clean`（收敛）**。

### 偏差、未落地与上抛

- **与设计档的偏差**：无。六件逐条对应 §4/§5/§6；上表 T1–T8 是设计档未逐字钉死处的落法裁定，非语义偏离。
  上轮已落 6 件本轮零改动（未发现与设计档冲突，故无上抛）。
- **未落地**：端到端 AC-1/2/3/4/5/6/7/9 需真实 dsh + thincoder 子进程，**不在本实现者范围、本轮未跑**
  （不得记作通过）。AC-8 由本批单元测试文件承担，已跑并全绿。
- **未做仓库套件验证**：按纪律，仓库套件的唯一一次运行在父侧收口；本实现者只跑本批单元测试文件。
- **上抛项**：无新增。

## §6 验证与收口（父代理）

**状态行**：已收口（2026-10-06）
**结算**：本批条目 8 条（台账 #1–#8）全部落地并实测；设计令牌已消费；无遗留债务。

### 一、本次交付

12 个文件（11 源 + 1 单元测试文件）+ 装载形态：

| 落点 | 覆盖动作行 | 行数 |
|---|---|---|
| `package.json` / `cordis.patch.yml` | A1–A2 | — |
| `src/{config,session-store,errors,stop-reason}.mjs` | B1–B3 / C1–C4 / E1–E4 / D1 | — |
| `src/{connection,driver,provider,tools,index}.mjs` | F1–F4 / G1–G13 / H1–H3 / I1–I3 / J1–J2 | — |
| `docs/batches/B1-dsh-subagent-thincoder.test.mjs` | K1 + 十面清单 | — |

### 二、验收逐条判决（全部由父代理亲跑，读数原样）

| # | 判决 | 实测证据（命令 / 可观测读数） |
|---|---|---|
| AC-1 | ✅ | 真 loader：`dsh web --patch <overlay>` 启动，插件不在失败清单；诊断日志无 `failed`/`pending` 行。**关键：`name:` 必须是包名**（`file://<目录>` 会 `failed to import`，见偏差 D-1） |
| AC-2 | ✅ | 同一 dsh 会话连发两次委派：`first=4` / `second=4`；子进程日志 `session 4 resumed as session 4 (no replay)`（走 resume 而非 new） |
| AC-3 | ✅ | 第二次带 `new: true`：`third=5`（新槽），日志 `session 5 closed by client` |
| AC-4 | ✅ | 显式 `sessionId="4"` ⇒ 回报 `4`，正文 `PONG4` |
| AC-5 | ✅ | 委派结束即接回同槽：`session 23 resumed as session 23 (no replay)`，**无** `slot busy, forked to` 后缀 ⇒ 无残留认领 |
| AC-6 | ✅ | 工作区放非法工程档 ⇒ 工具错误：`the target workspace's ThinCoder engineering manifest is not parsable. failed to resume session 1: 项目不可解析：PROJECT-MANIFEST.json 非法（fail-closed）…— use new: true …`（锚句在、可读、非超时、带下一步提示） |
| AC-7 | ✅ | `subagent_thincoder_sessions()` ⇒ `4, 2, 5, 3, 1`（含 AC-2 的 4，且其 updatedAt 最新） |
| AC-8 | ✅ | `node --test docs/batches/B1-dsh-subagent-thincoder.test.mjs` ⇒ `tests 32 / pass 32 / fail 0` |

### 三、AC-9（本模块存在的理由）判决：✅

三条证据链，缺一不可：

1. **同槽钉回**（干净路径）：`session 23 resumed as session 23 (no replay)`，无 fork 后缀。
2. **令牌被读回内存**：槽 23 的 `engDesignTokens` 在该轮结束后的整档保存里**逐位不变**
   （SHA256 前 16 位 `ce43f5d4b6f91274`，前后一致；该轮保存是**从内存**重写整档，
   若未恢复则会被写成空数组）；`history` 43 → 45，同一槽文件继续生长。
3. **fork 路径的旁证**：槽 33 被活进程占用时 thincoder 静默 fork 到 34，
   而槽 34 **携带着与槽 33 逐位相同的令牌**（`8b67ab3a126755ca`）——
   这是「装载旧槽数据 ⇒ 令牌回内存 ⇒ 该轮写入新槽」的完整闭环证据。

未做的一步（如实标注）：未在子会话内触发一次**受写门禁的动作**来实证「令牌被写门接受」；
该行为属 thincoder 上游语义（本批未改其一行代码），本批只证到「令牌确实回到该会话的内存里」。

### 四、端到端跑法（可复现）

```
# 1) 装配面（本仓已建）：profile 的 node_modules 自链接
ln -sfn <repo> ~/.dsh/profiles/<profile>/node_modules/dsh-subagent-thincoder
# 2) 覆盖层：模型路由（公开配置，密钥由 dsh 凭据服务解析）+ 本插件行
dsh --profile <profile> --patch <model-overlay.yml> --patch <plugin-overlay.yml> "<任务>"
```
本批用的三份覆盖层与四份运行日志留在 `.thincoder/tmp/`（临时区，非交付面）。

### 五、偏差与经验（逐条登记）

| # | 偏差 | 处置 |
|---|---|---|
| D-1 | **装载形态**：`name:` 写目录路径会 `failed to import`（ESM 不支持目录导入）；必须写**包名** + profile 级自链接。设计档 §3.2 写的正是包名，是父代理实验时误改成路径 | 已按包名落地；此处登记经验 |
| D-2 | **需求档 AC-1 判定方式偏弱**：原写 `import('./src/index.mjs')`（文件路径，恒成功），测不到真 loader 走的**模块说明符**解析 | 已用真 loader 启动补验（见 AC-1）；需求档该行建议下批修订 |
| D-3 | **设计档 §12-3 的说法可再收窄**：fork 会打在子进程 stderr 上（`slot busy, forked to N`），而插件是 `stderr: inherit` ⇒ 文本**确实到达父进程**，只是当前不解析。原话「插件在线上观测不到」按现状成立，但**存在可观测面** | 记为技术待办（见六），不改已批准设计档 |
| D-4 | **批次档长行**：`§1` 更正记与 `§3` 评审表有若干 >300 字节的行。前者是父代理所写、后者是评审逐字写入（记录面） | 保留并在本表登记；`§3` 逐字是机制要求，不回改 |

### 六、台账与待办

- 本批条目 #1–#8：`在途 → 待核销 → 已核销`（结算依据 = 本 §6）。
- 技术待办（`条件` 触发）：#9 流映射扩面 · #10 长驻子进程 · #11 可选 per-workspace 串行开关 ·
  新增 #12 **fork 可观测化**（捕获子进程 stderr 的 `slot busy, forked to`，把静默 fork 变成如实上报）。
- 集成面：本批不新增集成测试（端到端按上表实跑，不沉淀为常驻套件）；单元测试文件 32 例随本档存放。

### 七、装到用户环境的改动（父直接执行 · 可回退）

- `~/.dsh/profiles/web/cordis.patch.yml`：旧两行（`subagent-acp` + `tool-subagent-acp`）⇒ 一行本插件行。
  备份：`.thincoder/tmp/web-cordis.patch.yml.bak`。
- `~/.dsh/profiles/{web,headless}/node_modules/dsh-subagent-thincoder` 自链接各一（解析面）。
