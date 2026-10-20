# 发布与镜像流程

> 本档是这个仓**如何对外发布**的操作手册：主线在哪、GitHub 镜像怎么同步、发布前查什么。
> 它与代码契约无关 —— 契约见 `docs/design/`，判据见 `docs/STANDARDS.md`。

## 1. 仓的形态

**主线真源 = Gitea 上的 `master`。GitHub 是定期同步的只读镜像。**

```
本地仓
├── master   ← 唯一真源，日常开发都在这条线上；推 origin（Gitea）
└── public   ← 镜像线，孤立根（无共同祖先）；推 github（GitHub）

origin  = git.onenex.cn/.../dsh-subagent-thincoder.git   （主线）
github  = github.com/<owner>/dsh-subagent-thincoder.git  （镜像）
```

**为什么用孤立根而不是直接推 `master`**：本仓的历史里有开发期的内部信息（个人绝对路径、内部台账编号、私有镜像名）。
GitHub 对外展示的是**分支的完整可达历史**，无法只隐藏其中一部分。孤立根让镜像从「Initial commit」开始，
内部历史自然不随行；而 `master` 的完整历史留在 Gitea，不受影响。

**关键约束**：

- **只在 `master` 上开发。** `public` 是快照，不是第二条开发线。
- **永远显式指定分支推送**：`git push github public:main`。
  **禁止** `git push --all` / `git push --mirror` —— 那会把 `master` 连同全部历史公开。

## 2. 首次建立镜像（只做一次）

```bash
cd <repo>

# 镜像线上的提交身份：用 GitHub 匿名邮箱，不要用真实邮箱
git config user.name  "<你的名字>"
git config user.email "<id>+<username>@users.noreply.github.com"

# 造孤立根（此时工作树内容保持不变，只是换了一条没有父提交的线）
git checkout --orphan public
git add -A
git commit -m "Initial public release"

# 提交后、推送前，逐项核对拍进去了什么
git show --stat HEAD
git status --short              # 应为空

git remote add github git@github.com:<owner>/dsh-subagent-thincoder.git
git push -u github public:main
```

> `--orphan` 会把**当时工作树里的所有文件**拍进快照，包括被 `.gitignore` 排除之外的任何东西。
> 所以推送前那两条核对命令不是可选项。

## 3. 每次同步

不要 `merge` —— 两条线无共同祖先，merge 会把 `master` 的整段历史带进镜像。
用**树覆盖**：把 `public` 的工作树换成 `master` 的内容，但 `public` 的父提交仍是上一个快照。

```bash
cd <repo>

# 0) 确认工作区干净（read-tree --reset 会丢弃未提交改动）
git status --short

# 1) 切到镜像线，用 master 的当前内容覆盖工作树与索引
git checkout public
git read-tree -u --reset master

# 2) 核对这次要发布的差异
git status --short
git diff --cached --stat

# 3) 提交并推送
git commit -m "sync: <一句话说明本次同步内容>"
git push github public:main

# 4) 回到主线，日常开发继续在 master
git checkout master
```

**`git read-tree -u --reset master` 是这一步的核心**：它重置工作树与索引到 `master` 的树，
不产生 merge 提交、不引入 `master` 的任何父提交。**它会丢弃 `public` 上的未提交改动**，所以第 0 步必须先跑。

若第 2 步 `git status --short` 为空，说明 `master` 与上次快照内容一致，本次无需提交。

## 4. 发布前检查

### 4.1 个人信息扫描

`master` 的当前树必须干净。**先提交再扫描** —— `git grep <rev>` 查的是提交里的树，不是工作区：

```bash
# 前提：改动已提交到 master
git grep -nE 'nvm4w|/Users/[A-Za-z0-9_-]+|C:\\\\Users|/home/[a-z]+|@gmail\.com|sub2api|/opt/homebrew' \
  master -- . ':!docs/batches' || echo "✅ 活面干净"
```

- 排除 `docs/batches/` 只用于**日常巡检**（批次档是历史记录）；**首次发布前必须连批次档一起扫**：
  去掉 `':!docs/batches'` 再跑一次。
- 想扫**工作区**（含未提交改动）用 `grep -rnE '<同一串>' --include='*.md' --include='*.mjs' --include='*.json' --include='*.yml' .`
  并排除 `.thincoder/` 与 `node_modules/`。
- `/private/tmp` 与 `/tmp` **不算**个人信息 —— macOS 上 `/tmp` 本就是 `/private/tmp` 的符号链接，
  这是测试符号链接归一所需的正当夹具。

### 4.2 冻结档说明

`docs/batches/` 下的批次档是 append-only 的历史记录，已 close 的**不回改**（`docs/STANDARDS.md` §4.3）。
它们的正文里留有当时的路径读数与内部编号 —— 这些已在整理时逐处核实：

| 类别 | 处置 |
|---|---|
| 个人绝对路径 / 私有项目名 / 私有镜像名 | **已就地清除**（历史事实不受影响：改后仍是真话） |
| 「当时 skill 在仓外、改不了」这类流程表述 | **保留**（改后反而变成假话；现状由活面说明） |
| 内部台账编号 `台账 #N` | **保留**（`docs/STANDARDS.md` §5 已说明它是仓外库、不可跳转） |

### 4.3 测试与打包

```bash
npm test                    # 全绿才能发布；skip 的用例是平台条件跳过，不算失败
npm pack --dry-run          # 核对包里只有 src 与 cordis.patch.yml
```

**Windows 面必须以 CI 为准，不能只看 mac 上的绿。** 一批面的语义由宿主 `node:path` 决定，
注入 `platform` 参数无法等价替代 —— 清单与判定口径见 `docs/VERIFY-win32.md`。
`.github/workflows/test.yml` 已声明 `windows-latest` × node 22/24 矩阵，
**发布前该工作流应在 Windows 上跑绿**（它不需要本地有 Windows 设备）。

`package.json` 的 `files` 只含 `src` 与 `cordis.patch.yml` —— **文档、测试、skill 都不进 npm 包**。
其中 `skills/` 随 **Git 仓**发布，供使用者手动安装到 `$DSH_HOME/skills/`（见 `docs/USER-SKILL-delegate-to-thincoder.md`）。

## 5. 已知的限制

**镜像的历史是断续的。** 每次同步是一个快照提交；从 GitHub clone 后提交的 PR 与 `master` 无共同祖先，
合回主线会产生「双根合并」节点。因此：

- GitHub 侧按**只读发布**对待：让人阅读、clone、下载。
- 收到 PR 时，在 `master` 上**手工重建**同样的改动并署原作者，而不是直接把镜像线 merge 回来。

**镜像线不要有日常提交。** 在 `public` 上直接改的东西会在下次 `read-tree --reset` 时被静默覆盖。

## 6. 变更记录

- 2026-10-20 首版：确立「Gitea 主线 + GitHub 孤立根镜像」形态，给出首次建立、每次同步、发布前检查三节。
