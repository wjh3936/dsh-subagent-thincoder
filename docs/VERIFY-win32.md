# Windows 验证清单

> 本档登记**只能在 Windows 上验证**的面，以及「为什么它们不能在 mac 上被等价覆盖」。
> 用途：拿到 Windows 设备（或 CI 跑绿）时照单验收，不必重新推导哪些面有风险。

## 1. 为什么需要这份清单

B12（dsh `0.2.1-rc.2` 适配）的全部实测都在 macOS 上完成。逐项核对后，**绝大多数面与平台无关**，
但有一小部分面的语义 **由宿主的 `node:path` 决定**，注入 `platform` 参数并不能等价替代。

判定口径：**注入 `platform` 能覆盖的，不算 Windows 面**；**依赖宿主 `node:path` / `fs` / 进程语义的，算。**

## 2. 已由测试覆盖、无需真机的面

这些用注入的 `platform: 'win32'` 在任意宿主上跑，等价性成立（`test/platform-win32.test.mjs` 等）：

| 面 | 覆盖方式 |
|---|---|
| 批处理包装 `[interpreter, '/d', '/s', '/c', 'call', target, ...args]` | 桩 seam + 注入 platform，纯字符串判定 |
| `args` 元字符拒绝（`%` `&` `\|` `<` `>` `^`） | 纯字符串，起进程前拒绝 |
| `ComSpec` 三候选顺序 + 大小写不敏感读取 | 注入 platform + 注入 env |
| `keyPath()` 折大小写（含 UNC） | 纯字符串变换 |
| `isBatchTarget()` 扩展名判定 | 纯字符串 |

## 3. 只能在 Windows 上验证的面

### 3.1 `resolve()` 的绝对路径语义（**已知缺口**）

`linkKey` 内部调用 `node:path` 的 `resolve()`，它**绑定宿主平台**：

```
在 macOS 上：resolve('C:\Work\WS') → '<当前目录>/C:\Work\WS'   ← 当成相对路径
在 Windows 上：resolve('C:\Work\WS') → 'C:\Work\WS'            ← 正确
```

**影响**：win32 的续用键**从未用真实 Windows 绝对路径验证过**。
`test/platform-win32.test.mjs` 里已把这一边界写成显式用例（标注 KNOWN GAP），
它断言的是「在本宿主上可证到哪一步」，而不是「Windows 上结果如何」。

**Windows 上要验的**：

```powershell
node --test test/platform-win32.test.mjs
```

期望：全部通过。特别是 `P10: the resolve() step is host-bound` 那条在 Windows 上走 `if (IS_WIN) return` 提前返回，
而 `keyPath` 那条应独立通过。

手工复核（PowerShell）：

```powershell
node -e "const {linkKey}=await import('./src/session-store.mjs'); console.log(JSON.stringify(linkKey('s','C:\Work\WS','win32')))"
```

期望第二个字段 = `c:\work\ws`（**不带任何 cwd 前缀**）。若带了前缀，说明 `resolve()` 在该环境上仍把它当相对路径 —— 需要报告。

### 3.2 `assertUsableCwd` 的 Windows 语义（**B12 新引入**）

dsh 的 `assertUsableCwd` 做两件事，都用宿主的 `node:path` / `fs`：

```js
if (!isAbsolute(cwd)) throw ...          // Windows: 认 'C:\x' 与 '\\server\share'，不认 'C:x'
if (!isEnterableDirectory(cwd)) throw ... // 真实 stat + 访问
```

**风险点**：thincoder 的 `session/new` 要求 `params.cwd === process.cwd()`，比对是 `normalizeCwd(p).toLowerCase()`。
如果 dsh 传来的 `request.cwd` 与进程 cwd 的**大小写形态不一致**（`c:\users\…` vs `C:\Users\…`），
理论上仍能匹配（两边都折了），但这依赖 thincoder 的实现细节，**只在 Windows 上有意义**。

**Windows 上要验的**：

1. 在任意工作区跑一次真实委派，确认不出现 `must be an absolute path` / `is not an accessible directory`。
2. **反向验证**：把 `cwd` 配置成一个盘符相对路径（如 `C:Work`，缺反斜杠），期望**被拒**且信息可读。
3. 把 `cwd` 配置成 UNC 路径（`\\server\share\ws`），确认校验不误拒（能否真跑通取决于该共享是否可达）。

### 3.3 端到端委派（**AC-21 a–g 在 Windows 上从未执行**）

B12 的验收 a1–a3 / b–g 全部在 macOS 的真实 web profile 上完成。以下链路**只要有一段依赖进程/文件语义，就属 Windows 面**：

| 环节 | 为何与平台相关 |
|---|---|
| `startActivation` 完整链路 | dsh 宿主内部分支未在 Windows 上跑过 |
| 会话号私有载体盒回带 | 纯内存，理论上无关；但整链未跑过 |
| `session/close` → 进程 reap 顺序 | Windows 的进程终止与信号语义不同 |
| 后台 job 路径（`ctx.jobs`） | 定时器/事件循环行为一致，但整链未跑过 |

**Windows 上要验的**（与 B12 档 §6 的 a–g 同构）：

- **b** 前台委派：`run_in_background: false` ⇒ 返回四键（`text` / `sessionId` / `stopReason` / `status`），`status = completed`
- **c** 同会话再委派不传 `new` ⇒ 回到同一 `sessionId`，且答复能引用上一轮的内容
- **d** 后台委派：`run_in_background: true` ⇒ 立即返回 `jobId`，`job_output` 能读回答复
- **e** cwd 随当前目录：在两个不同目录各委派一次，答复里报告的 cwd 应当**不同**且等于该次的工作目录
- **f** 显式接回：传上一轮的 `sessionId` ⇒ 返回同一个号
- **g** 枚举：`subagent_thincoder_sessions` 能列出该工作区的会话，且新委派后数量/更新时间有变化

### 3.4 一处历史用例的修正（2026-10-20）

`test/platform-win32.test.mjs` 的 `zero process: an unresolvable argv starts nothing on either face`
（`skip: !IS_WIN`）在 B12 之后**缺少 `request.cwd`**，会先撞上「host resolved no working directory」而
匹配不到它断言的 `/could not launch/`。已在 2026-10-20 补上 `cwd: process.cwd()` 并加注说明。

该用例在 Windows 上的预期：`stubSeam(fail)` 让 `resolveExecutable` 抛出 ⇒ win32 分支包成
`could not launch "thincoder"` ⇒ 两个面都 reject ⇒ **零 spawn**。已在本机用 `platform: 'win32'` 直接调
`resolveLaunchArgv` 验过该分支确实抛出该文案（POSIX 分支不调用解析器，故本机不可能覆盖整条用例）。

## 4. 没有 Windows 设备时怎么办

**首选：CI**。`.github/workflows/test.yml` 已声明 `windows-latest` × node 22/24 矩阵，
push 到 GitHub 后自动跑全部 78 个用例。这是**不需要你拥有设备**的验证路径。

它能覆盖的：3.1（`resolve` 语义）、3.4（修正后的用例）、以及全部平台无关面在 Windows 上的回归。
它**不能**覆盖的：3.2 / 3.3 —— 那两条需要真实的 dsh 宿主 + thincoder 凭据，CI 里没有。

**次选：借用 Windows 环境**（任选其一即可满足 3.2 / 3.3）：

- 一台 Windows 机器（同事/家庭机），装 dsh + thincoder 后走第 3 节清单
- 云主机按小时计费（Azure / AWS / 阿里云 Windows Server），验完即释放
- Windows Sandbox（仅 Win10/11 专业版）+ 临时安装

## 5. 结论与优先级

| 面 | 现在能否验证 | 优先级 |
|---|---|---|
| 3.1 `resolve` 语义 | ✅ CI 即可 | 高（已写进用例，CI 一跑就知道） |
| 3.4 历史用例修正 | ✅ CI 即可 | 高 |
| 3.2 `assertUsableCwd` | ❌ 需真机 | 中（只在显式配置 `cwd` 时触发；默认空值不走这条） |
| 3.3 端到端 a–g | ❌ 需真机 | 中（进程/reap 语义与 mac 不同，但无已知差异点） |

**发布判断**：3.1 / 3.4 靠 CI 就能给出答案，**建议发布前先让 CI 在 Windows 上跑绿**。
3.2 / 3.3 在「Windows 不是首要目标平台」时可以带着此项已知缺口发布 —— 但应在 README 与发行说明里
**如实声明「Windows 端到端未经验证」**，而不是默认它可用。

## 6. 变更记录

- 2026-10-20 首版：登记 B12 全 mac 验证之后的 Windows 待验面（`resolve` 语义 / `assertUsableCwd` / 端到端 a–g），
  给出「注入 platform 可覆盖 vs 必须真机」的判定口径，以及无设备时的替代路径（CI 优先）。
