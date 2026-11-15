# 多 Bot 编排（dsh-bot-console）

给「用编排」那套流水线一个**设置窗口**：在 DSH 设置里直接改每个 Bot 的任务、产出、边界与必填上下文，**并且随意增删 Bot**。

## 位置

**设置 → 多 Bot 编排**

## v0.2（2026-11-15）改了什么

| 之前 | 现在 |
|---|---|
| 只有 `executor / critic / scribe` 三个，页面上 id 是只读徽章 | **任意数量、任意 id**（`^[a-z][a-z0-9-]{1,31}$`，全局唯一），id 可直接改 |
| 不能加、不能删 | 「＋ 新增 Bot」、「删除」（二次确认）、「↑ ↓」调整流水线顺序 |
| 派单脚本只认三个 id，新 id 一律拒渲染 | 派单改读 `bots.json` 里每个 Bot 的 `vars`，新 Bot 无需改脚本 |
| 保存不校验 | 保存前做结构校验；写入后再跑 `dispatch_prompt.py --check`，不通过会报错并提示 |
| —— | 新增 `vars` 必填上下文字段（页面里是标签式增删），派单时逐个检查有没有值 |

## 它管什么

| 字段 | 作用 |
|---|---|
| `rounds` | 执行 Bot ↔ 审查 Bot 最多返工几轮（默认 2） |
| `writeBack` | 关掉则写回 Bot 只出 diff，不自己 commit |
| `bots[].id` | 派单用 `--bot <id>`；名字自己起（如 `executor`、`factcheck`） |
| `bots[].vars` | 该 Bot 派单时必须由调用方提供的上下文（如 `output_path`、`rule_files`、`receipt`） |
| `bots[].mission` | 派发时原样写进 brief 的主体；`<占位符>` 会被 `--var` 的值替换 |
| `bots[].output` / `bounds` | 产出与回执要求 / 边界与禁令 |
| `bots[].enabled` | 关掉即跳过该环节 |
| **数组顺序** | 就是流水线顺序 |

## 数据存在哪

```
%USERPROFILE%\.dsh\skills\skill-orchestrator\bots.json
```

和技能放一起，父 agent 用普通读文件就能拿到。

## 服务任意 Skill（不绑定）

Bot 不绑定技能。一次「用编排」时先定 `--skill <技能名>`，再把该技能的规则文件作为 `rule_files` 传下去；写回 Bot 的目标文件就是**本次 `--skill` 指向的那个技能**的 SKILL.md 或附件。所以同一套 Bot 审 `digest-md-pipeline`、审 `ego-browser` 都成立。

## 怎么实现的（没有 Remote）

```
GET  /plugins/dsh-bot-console/config   → { config, seeded, issues }
POST /plugins/dsh-bot-console/config   → { ok, savedAt, path, config, issues, check }
```

- `index.js` 用 `ctx.webServer.register({ kind:'exact', path, handler })` 注册；写入是「临时文件 + rename」。
- POST 顺序：`normalize()` → `validate()`（结构）→ 落盘 → `spawnSync(python dispatch_prompt.py --check)` 复核；结构非法直接 400 不写盘。
- `client.js` 注册 `settings.section`，用 `fetch` 调这两个方法。

## 已知限制

- 路由没有鉴权：本机任何页面都能 POST 改配置。别把端口暴露到局域网。
- 改 id 后旧派单记录对不上（页面会提示）。
- 改完不用重启；**进行中的那一轮**不受影响。

## 改完必做：同步到安装副本

源码目录（`$PLUGIN_SRC`）与桌面端实际加载的安装副本不是同一份，改完要同步：

```powershell
$PLUGIN_SRC = "<插件源码目录>"          # 放了 index.js / client.js 的那个目录
$PLUGIN_DST = "$HOME\.dsh\profiles\desktop\node_modules\dsh-bot-console"
foreach ($f in "index.js","client.js","README.md","package.json") {
  Copy-Item (Join-Path $PLUGIN_SRC $f) (Join-Path $PLUGIN_DST ($f + ".new")) -Force
  Move-Item (Join-Path $PLUGIN_DST ($f + ".new")) (Join-Path $PLUGIN_DST $f) -Force
}
```

> ⚠️ 直接 `Copy-Item -Force` 打目标文件会报「正由另一进程使用」——DSH 运行中锁着它们。
> 先写 `.new` 再 `Move-Item` 替换（Win32 允许对已打开文件做 replace-rename）才行。

然后刷新 GUI（客户端插件热更需要 `pnpm run dev:web` 在跑，否则直接刷新页面）。

自测：`node test-run.mjs`（用假 req/res 直接调 handler，覆盖 GET / 非法 POST / 合法新增 / 删除，跑完自动还原 bots.json）。

## 卸载

`plugin_manager` → `remove_bundle`，target `dsh-bot-console`。配置留在 `bots.json`，不会被删。
