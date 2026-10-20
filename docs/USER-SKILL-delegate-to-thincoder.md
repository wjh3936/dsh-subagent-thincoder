# 随仓发布的 skill：`delegate-to-thincoder`

> 本档记录**随本仓一同发布**的模型面用法说明 `skills/delegate-to-thincoder/SKILL.md`：
> 它是这个插件在模型侧的使用手册，正文只有一份真源（那个文件本身）。
> 本档只管**契约依赖关系**：改了下面哪条插件行为，就必须同步改 skill，否则 skill 变成错误指引。

## 1. 它是什么

一个 **DSH skill**（model-invocable）。正文在仓内 `skills/delegate-to-thincoder/SKILL.md`（唯一真源）；
因为 DSH 只从 `$DSH_HOME/skills/` 装载 skill，**安装时**需要复制过去：

| 项 | 值 |
|---|---|
| 名字 | `delegate-to-thincoder` |
| 仓内真源 | `skills/delegate-to-thincoder/SKILL.md` |
| 安装落点 | `$DSH_HOME/skills/delegate-to-thincoder/SKILL.md`（`$DSH_HOME` 默认 `~/.dsh`） |
| 安装命令 | `mkdir -p "${DSH_HOME:-$HOME/.dsh}/skills" && cp -r skills/delegate-to-thincoder "$_"` |
| 形态 | 目录 + `SKILL.md`（kebab-case 名，符合 `SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`） |
| 面向 | 模型（model-invocable，无 `disable-model-invocation`） |
| GitHub 可见 | **是** —— 随仓发布，公开仓与本地一致 |
| 是否随 npm 包发布 | **否**：`package.json` 的 `files` 只含 `src` 与 `cordis.patch.yml`（但**随 Git 仓**发布） |

## 2. 它解决什么问题

模型的会话起始上下文里会出现一份 **skill 目录**（`<available_skills>`，只有 `name` + `description` 一行），
但 skill **正文只在模型显式调用 `skill` 工具时**才装载（`dsh-tool-skill` 的
`renderCatalogEntries` 只渲染 name/description；装载入口是 `skill` 工具）。

⇒ 本插件新增（或行为重要）时，如果**没有**一个能被 description 命中的 skill，
模型每次都得从工具 schema 与零散文档里重新拼装用法。本 skill 就是那份"用法"。

它的 description 以**触发条件**写成（用户会说的说法 + "即将调用本工具时"），
所以用户在别的项目里说「派给 thincoder / 调用 thincoder / 走 ACP / subagent_thincoder」时会命中。

## 3. 它依赖本插件的哪些契约（改这些 ⇒ 必须同步改 skill）

以下每一条都可在本仓源码/设计档核验。**任何一条变了，skill 就会变成错误指引。**

| # | skill 里写的 | 本仓权威落点 |
|---|---|---|
| 1 | 两个工具名 `subagent_thincoder` / `subagent_thincoder_sessions` | `src/config.mjs` 的 `toolName` / `sessionToolName` 默认值；`cordis.patch.yml` |
| 2 | 参数 `description` / `prompt` / `sessionId` / `new` / `run_in_background`；`sessionId` 与 `new` 互斥 | 设计档 §5.3 参数表、§5.11 |
| 3 | 会话解析优先序：显式 `sessionId` → `new` → 查 `(dsh session, workspace)` 记录 → 无记录则新建 | 设计档 §5.5 判据（钉死） |
| 4 | 槽记录落点 `~/.dsh/storages/subagent_thincoder.json`，表 `session_links`，键 `parentSessionId + '\u0000' + keyPath(canonicalPath(resolve(cwd)), platform)` —— 路径先由 `canonicalPath` 归一（符号链接别名与大小写形态合一；读不到则回退为原值），`keyPath` 再补 Windows 折；归一**只作用于键**，记录与 cwd 保持原值 | 设计档 §5.6、§5.9；`src/session-store.mjs` |
| 5 | **无自动回退**：显式槽不存在 / 记录失效 ⇒ 可读错误，不静默换新槽；失败不覆盖记录 | 设计档 §5.5「槽不存在 / 建立失败的回退语义（钉死）」 |
| 6 | 静默 fork：并发委派同一槽时 thincoder 可能 fork 到新槽，回报号取自请求、未必等于实际槽号；插件不自造锁 | 设计档 §2 理由 P5、§5.5 尾、§12-3；本仓工具 description（`src/tools.mjs` 末句） |
| 7 | fork 的**可观测面**：子进程 `stderr: 'inherit'`，thincoder 会打印 `slot busy, forked to <N>`，插件不解析 | `src/connection.mjs` 的 `stdio`；批次档 §6 决策透明表 D-3；待办 #12（fork 可观测化） |
| 8 | 只回传最终答复文本（思考 / 工具调用 / 计划不上抛） | 设计档 §2 理由 P2 |
| 9 | 子进程 cwd = 委派会话的工作区；`cwd` 配置留空即继承 | `src/config.mjs`；`cordis.patch.yml` 注释 |
| 10 | 子进程**不继承**父会话凭据，读自己的 config | **不在本仓**：用户 profile 的 `~/.dsh/profiles/web/cordis.patch.yml:114`（NOTE 注释）；本仓 `cordis.patch.yml` 无此注释 |
| 11 | 后台委派形态（默认）：工具**立即返回 job 号**（后台返回 `{kind:'background', jobId}`）；会话号进 job 的过程环（执行期间即可读回），答复文本在结算后经 `job_output` 读回；前台**成功**时返回 `{text, sessionId, stopReason, status}` | 设计档 §5.11（后台委派契约：门与解析、返回面、回报面等价） |
| 12 | **前台失败抛错**（B12 · D4）：`status !== 'completed'` 或清理失败 ⇒ **抛异常**，message 带失败详情（stopReason / diagnostic / teardown 错误）；`status === 'killed'` 仍返四键（取消是已报告结局，不是失败）。理由：失败若回空 `text` 的四键，与「子代理确实回答为空」不可区分 | 设计档 §5.3-B12（失败路径以抛错表达）、§9 用例 85；`src/tools.mjs#delegationFailed` |
| 13 | **cwd 权威在宿主**（B12）：`config.cwd` 留空 ⇒ 不传 `request.cwd`，由宿主取父会话**当前**目录（不再是 `header.cwd` 的原始项目目录）；非空 ⇒ 作请求覆盖，起进程前经 `assertUsableCwd` 校验 | 设计档 §5.9-B12；`src/provider.mjs#resolveConfiguredCwd` |

### 3.1 skill 已承载的目标句（B11 · 2026-10-16 裁定取 B）

**落点**：`skills/delegate-to-thincoder/SKILL.md`（session-slot continuity 节 + 「Background by default」节 + Other behaviour / 异步限制节）。

- **不对称提示**：「拿不准就保留默认：误开新槽会丢槽内状态，接错槽可用 `new: true` 重发。」（英文运行面）
- **后台默认与三处阻塞**（与设计档 §5.11 `:794` 工具 `description` 的权威口径一致）：委派默认走后台 job，工具立即返回 jobId，答复稍后用 `job_output` 读回；阻塞仅三处 —— 显式 `run_in_background: false` / 本实例默认前台且参数缺省 / `jobs` 服务不可用（默认路径退前台）。
- **后台默认不解除「异步子代理活不过回合」**：dsh 后台 job 与 thincoder 进程内异步池是**两层**，外层不解除内层；内层异步子代理仍须在 prompt 返回前结算。

> **口径收正（本批）**：同一件事在三处曾写成三个数 —— 设计档 §5.11 `:803` 的 skill 目标句原文只列**一处**阻塞，本档 §3.1 旧稿写「两处」，工具 `description`（§5.11 `:794`）写**三处**。
> 本批以**工具 `description` 的三处为准**（那是模型真正读到的契约面）落 skill，并把设计档与本节同步 —— 详见 §5 变更记录。

## 4. 维护规则

- **改契约 ⇒ 同步改 skill**：上表任一条变动时，改仓内真源
  `skills/delegate-to-thincoder/SKILL.md`，并在本节（或本档末尾）记一行变更。
  改了 skill 之后，**已安装到 `$DSH_HOME/skills/` 的那份需要重新复制**才生效。
- **skill 里不写项目特有内容**：它是通用用法手册，写进某个具体项目的约定会误导其他项目。
  这一点 skill 自身已有专门一节声明（"What this skill does not cover"）。
- **本档不复制 skill 全文**：正文只有一份真源（skill 文件本身）。本档只记录**依赖关系与变动触发**，
  符合「同一事实只保留一个主落点」的口径。

## 5. 变更记录

- 2026-10-06 首版：登记 skill 落点、它依赖的 10 条契约、维护规则；同步记录 fork 的 stderr 可观测面（第 7 条）。
- 2026-10-07 B2：第 4 行键形态补 P10 口径 —— Windows 下 `keyPath` 折叠大小写（同一工作区的两种大小写形态落成同一个键），归一不改实际 cwd。
- 2026-10-08 B3：第 4 行键形态改写 —— 路径先经 `canonicalPath`（realpath 规范化，失败回退）再交 `keyPath` 补 Windows 折；归一仍只作用于键。
- 2026-10-16 B11（措辞面裁定取 B）：新增 §3.1（skill 侧待落的目标句：不对称提示 + 后台默认与两处阻塞）；第 2 行参数面补 `run_in_background`；依赖表新增第 11 行（后台委派形态与答复读回）。
- 2026-10-16 B11（**skill 落笔** · 父代理执行）：§3.1 由「待落」改为「**已落笔**」——仓外 `~/.dsh/skills/delegate-to-thincoder/SKILL.md` 已更新
  （frontmatter description · 参数面补 `run_in_background` + 默认口径 · 新增「Background by default」节 · session-slot 节补「按任务工作流选会话」与「拿不准就保留默认」· 异步限制节补「两层不同」）。
  **口径收正**：阻塞情形数由「两处」改为「**三处**」，以工具 `description`（设计档 §5.11 `:794`）的权威口径为准（原先设计档 `:803` 只列一处、本档旧稿写两处，同一件事三处不一致）。
- 2026-10-17 B12（**适配 dsh 0.2.1-rc.2**）：依赖表新增第 12 行（**前台失败抛错** · D4）与第 13 行（**cwd 权威在宿主**）；第 11 行「前台形态仍返回四键」收正为「前台**成功**返回四键」——原文在失败路径改抛错后已不完整。
  **skill 落笔**（父代理执行，仓外路径）：`~/.dsh/skills/delegate-to-thincoder/SKILL.md` 的「In cases (1) and (2)」段改写为成功/失败两分（成功返四键、非 `completed` 或清理失败抛错、`killed` 仍返四键），并说明抛出 message 的三种可分辨原因。
- 2026-10-20 **开源整理**：skill 正文迁入仓内 `skills/delegate-to-thincoder/SKILL.md` 并成为**随仓发布物**（仍不进 npm 包）；
  同时剔除个人协作习惯与项目特有约定，只保留 ACP 调用机制、工具契约与两处真踩坑（并发静默 fork · 异步子代理活不过回合）。
  本档由「仓外依赖清单」改为「随仓发布 skill 的契约依赖清单」。

  > **对冻结档的说明**：B11 §6 与 B12 §6 内仍留有「仓外 skill 实体不在可写面 / 我只读复核，未改」的表述 ——
  > 那是当时的**事实记录**（当时 skill 实体确在 `~/.dsh/skills/`、确在会话写域之外），不是错误。
  > 按 `docs/STANDARDS.md` §4.3「已 close 冻结的批次档不回改」，那些表述**保持原样**；
  > 现状以本行与本档 §1 为准。
