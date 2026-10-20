# dsh-subagent-thincoder · 文档地图

本仓是 dsh 的一个插件：把任务经 ACP 委派给 ThinCoder CLI，并在同一工作区续用同一条 thincoder 会话槽。

## 文档

| 文档 | 管什么 |
|---|---|
| `docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md` | **需求档**：背景与问题 · 模块目标 · 功能点 P1–P12 · 边界 · 验收 AC-1..AC-21 · 依赖 · 关键事实出处表 · 变更记录 |
| `docs/design/DESIGN-dsh-subagent-thincoder.md` | **设计档**：机制与数据流 · 包与插件身份 · 配置面 · 装载形态 · 受影响文件清单（含行数预算）· 接口契约 · 逐行动作表 · 关键决策 K1–K52 · 验收对照 · 用例表 · 边界 · 上抛项 · 变更记录 |
| `docs/batches/B1-dsh-subagent-thincoder.md` | **批次档**（已收口 2026-10-06）：首批交付（会话续用插件本体）的六段记录 |
| `docs/batches/B2-dsh-subagent-thincoder-win32.md` | **批次档**（已收口 2026-10-08）：Windows 平台适配（P9 跨平台启动 / P10 续用键路径归一） |
| `docs/batches/B3-dsh-subagent-thincoder-platform-closeout.md` | **批次档**（已收口 2026-10-08）：平台适配收口（P9 解释器 ComSpec 大小写 / P10 键归一半文件系统语义 + realpath） |
| `docs/batches/B4-dsh-subagent-thincoder-launch-face.md` | **批次档**（已收口 2026-10-09）：启动面收敛（启动 spec 单一来源 + 目标解析面可用性守卫） |
| `docs/batches/B5-dsh-subagent-thincoder-standards-scope.md` | **批次档**（已收口 2026-10-09）：**记录批次** —— 父代理直接落笔三笔的补账（#18 缺陷修复 · #23 双坐标统一 · #22/#17 判据适用面裁定 + STANDARDS §6） |
| `docs/batches/B6-dsh-subagent-thincoder-linux.md` | **批次档**（已收口 2026-10-10）：**Linux 收口批** —— 判据面核对（Linux 已在 P9 / P10 语义内、不新增行为判据句）+ 真 Linux 容器实证（AC-18 · 条件性验收）；`src/**` **0 行**。**⚠ 勘误（行为主体归因）：见 B8 档** —— 档内多处把**父代理**的核实 / 复跑 / 委派正文记成了「用户」；按冻结纪律**不回改**，勘误总表落 B8 |
| `docs/batches/B7-dsh-subagent-thincoder-closeout-correction.md` | **批次档**（已收口 2026-10-10）：**修正批** —— B6 收口记录的**陈旧计数更正**（B6 档 165→**284** 行 · 超宽 9→**10** 行 · 设计档增量 +169→**+176**）；**冻结面不回改**，更正落在活面（设计档 §4.8/§13 · 台账 #27 · 本档）。**⚠ 勘误（行为主体归因）：见 B8 档** |
| `docs/batches/B8-dsh-subagent-thincoder-attribution-correction.md` | **批次档**（已收口 2026-10-11）：**归因修正批** —— B6 / B7 两档把**父代理**的核实 / 复跑 / 发现 / 委派正文记成了「用户」（**从未为真**的事实性错误）；**冻结面不回改**，勘误总表与正确归因落本档 + 台账 `evidence` + 本表 ⚠ 指针 |
| `docs/batches/B9-dsh-subagent-thincoder-record-disciplines.md` | **批次档**（已收口 2026-10-11）：**落笔批** —— 把 B7 / B8 沉淀的两条记录纪律落进 `docs/STANDARDS.md` **§4.1**（授权口径须逐项标明来源）· **§4.2**（计数须在内容落定之后量取）；`src/**` **0 行** |
| `docs/batches/B10-dsh-subagent-thincoder-freeze-discipline.md` | **批次档**（已收口 2026-10-11）：**落笔批** —— 把「**已 close 冻结的批次档不回改**」落进 `docs/STANDARDS.md` **§4.3**（出处 B7 :29 / B8 :57–:61 / 台账「B5 记录批次」条 `evidence` / B3 :116）；四处出处逐处核实，**B5 那处更正为台账行**；`src/**` **0 行** |
| `docs/batches/B11-dsh-subagent-thincoder-nonblocking.md` | **批次档**（进行中 · **未收口**）：**非阻塞批** —— P11 非阻塞委派（后台 job）：委派默认走 dsh 的 `ctx.jobs` 后台路径，主会话在 thincoder 执行期间不阻塞、可被插入对话响应。**实施已落**（`src/` 三处；本批单测 9/9、B1–B4 冻结面零回归）；**未收口** —— AC-20 与 AC-19③ 需真 dsh 实例实跑（台账 #34） |
| `docs/batches/B12-dsh-subagent-thincoder-dsh-021.md` | **批次档**（已收口 2026-10-18）：**宿主版本面批** —— 跟 dsh `0.2.1-rc.2` 的 subagent seam 迁移（P12）：`startActivation` 启动面 · 会话号私有载体盒 · cwd 权威上收 · settle 自实现（台账 #37）。AC-21 收口时标 `unverified`，**用户升级后已实测转验通过**（见档内 `§6 十一` 补记） |
| `docs/USER-SKILL-delegate-to-thincoder.md` | **skill 说明**：随仓发布的 `skills/delegate-to-thincoder/SKILL.md` 与本模块的契约依赖 |
| `docs/VERIFY-win32.md` | **Windows 验证清单**：B12 全 mac 验证后的待验面（`resolve` 语义 / `assertUsableCwd` / 端到端 a–g）、「注入 platform 可覆盖 vs 必须真机」的判定口径、无设备时的替代路径 |
| `docs/RELEASING.md` | **发布流程**：Gitea 主线 + GitHub 孤立根镜像的形态、首次建立、每次同步配方、发布前检查清单、镜像线的已知限制 |
| `docs/README.md` | 本档（文档地图） |
| `docs/STANDARDS.md` | 项目标准：本仓声明的判据与既有事实（评审 / 实现的判据来源）：判据来源与未声明语义 · 已知规模 · 工程形态 · **批次形态（含 §4.1 授权口径来源 / §4.2 计数时点 / §4.3 冻结面不回改三条记录纪律）** · 台账口径 · **行宽与代码结构的判据适用面** |

## 代码

- `src/` —— 纯 ESM `.mjs`，零构建，dsh 直接加载（**无** tsc / 无打包步骤）。
- 入口 `src/index.mjs`；包身份与 bundle 指向见 `package.json` 与 `cordis.patch.yml`。

## 单元测试

存放于 `test/`，全部使用 `node:test`，零外部测试框架。

```bash
npm test                              # 等价于 `node --test`（跨平台，不依赖 shell 展开通配符）
node --test test/core.test.mjs        # 单跑一档
```

| 文件 | 覆盖面 | 来源批次 |
|---|---|---|
| `test/core.test.mjs` | 配置面 / 会话槽存储 / 错误与诊断 / 两个工具 / driver 握手与结算 | B1 |
| `test/platform-win32.test.mjs` | Windows 启动包装（`cmd /s /c call`）与续用键路径折大小写 | B2 |
| `test/platform-closeout.test.mjs` | `ComSpec` 大小写读取与 realpath 键归一 | B3 |
| `test/launch-face.test.mjs` | 启动 spec 单一来源与目标解析守卫 | B4 |
| `test/background.test.mjs` | 后台 job 委派（两级门 / 立即返回 / 取消 / 降级） | B11 |
| `test/host-seam.test.mjs` | dsh `0.2.1` 启动面 / 会话号回带 / cwd 权威 / settle | B12 |

## 项目声明

机器可读声明在仓根的 `PROJECT-MANIFEST.json`；其判据含义见 `docs/STANDARDS.md`。
