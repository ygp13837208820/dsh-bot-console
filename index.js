/**
 * Host half of the bot console.
 *
 * Owns the Bot list that `skill-orchestrator` reads before it dispatches, and
 * exposes them over one same-origin HTTP route so the settings page can load
 * and save without a Remote endpoint:
 *
 *   GET  /plugins/dsh-bot-console/config  -> { config, seeded, issues }
 *   POST /plugins/dsh-bot-console/config  -> { ok: true, savedAt, path, config, issues }
 *
 * The file lives next to the skill so the agent can read it as plain JSON:
 *   ~/.dsh/skills/skill-orchestrator/bots.json
 *
 * v2（2026-11-15）：**Bot 数量与 id 不再写死**——数组里有几个就是几个，id 由用户
 * 自己起（`^[a-z][a-z0-9-]{1,31}$`，全局唯一），顺序即流水线顺序。保存前先做结构
 * 校验，再调 `dispatch_prompt.py --check` 复核（派单脚本仍走 fail-closed，两边
 * 必须一致，否则会出现「页面存进去了、派单发不出」）。
 */
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const ROUTE = '/plugins/dsh-bot-console/config'
const MAX_BODY = 256 * 1024
const MAX_BOTS = 24
const ID_RE = /^[a-z][a-z0-9-]{1,31}$/

/** Current SKILL.md wording, used as the seed the first time the page opens. */
const DEFAULTS = {
  version: 3,
  rounds: 2,
  writeBack: true,
  varLabels: {
    skill: '本次使用的 skill 名',
    task: '用户原始请求（原样粘贴）',
    output_path: '产出路径（文件或目录，绝对路径）',
    rule_files: '本次任务所用 skill 的规则文件（绝对路径，多个用「;」分隔；没有就写「无」）',
    receipt: '上游 Bot 的 4 行回执（路径或原文）',
    target_file: '唯一允许改的文件（绝对路径）',
    conclusions: '要沉淀的高置信度结论（逐条）',
  },
  bots: [
    {
      id: 'executor',
      name: 'Bot 1 · 执行',
      enabled: true,
      vars: ['skill', 'task', 'output_path'],
      anchors: [],
      receiptAnchors: [],
      mission:
        '第一步必须调用 skill("<skill>") 拿到该技能的完整说明，然后再动手；在此之前不要读文件、不要试探、不要复述它将做什么。\n任务：<用户原始请求，原样粘贴>',
      output: '写到 <output_path>；回执只回 4 行，不要贴产出正文：1) 产出路径 2) ≤5 行摘要 3) 未覆盖 4) 是否偏离 skill 说明。',
      bounds: '不得修改任何 SKILL.md，不得 git commit，不得派子代理（深度已满，工具不可用）。',
    },
    {
      id: 'critic',
      name: 'Bot 2 · 挑刺',
      enabled: true,
      vars: ['output_path', 'rule_files', 'receipt'],
      anchors: ['自我净化', '自我完善', '自我更新', '自我提高'],
      receiptAnchors: ['自我净化', '自我完善', '自我更新', '自我提高'],
      mission:
        '你是独立审查者，没有参与上述工作，只读产出。输入：产出路径 + 执行者 4 行回执 + 本次所用 skill 的规则文件。\n按原始任务意图审，不看执行者的自我评价。',
      output:
        '最多 5 条，按严重度排序：- [blocker/major/minor][high/medium/low] 一句话问题 / 证据（文件:行 或原文摘录）/ 建议。\n没有 blocker 或 major 时只回一行 PASS。',
      bounds:
        '每条发现必须给证据，给不出来就不要写；风格、命名、格式不算发现；工具调用预算 ≤10 次，预算只管无效闲逛，为已命名发现取证不计入。',
    },
    {
      id: 'scribe',
      name: 'Bot 3 · 写回',
      enabled: true,
      vars: ['target_file', 'conclusions'],
      anchors: [],
      receiptAnchors: [],
      mission:
        '你是 skill 维护者，只做一次最小改动。目标文件在派发时由父 agent 判定——就是本轮 --skill 指向的那个技能的 SKILL.md 或它引用的某个附件，只改那一个。',
      output: '回执：1) 改了几行、改了哪一节 2) commit 短哈希（或「未提交：原因」）3) 一句话说明为什么这是模式级而不是流水账。',
      bounds: '只写模式级经验；不写本次任务流水账；单次改动 ≤20 行；提交只 add 这一个文件，禁止 git add -A。',
    },
  ],
}

/** @returns {string} absolute path of bots.json */
function configPath() {
  return join(homedir(), '.dsh', 'skills', 'skill-orchestrator', 'bots.json')
}

function dispatchScript() {
  return join(homedir(), '.dsh', 'skills', 'skill-orchestrator', 'scripts', 'dispatch_prompt.py')
}

/** Coerce anything into the shape the page expects (never throws). */
function normalize(input) {
  const source = input && typeof input === 'object' ? input : {}
  const raw = Array.isArray(source.bots) ? source.bots : DEFAULTS.bots
  const seen = new Set()
  const strList = (v) =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : []
  const bots = raw.slice(0, MAX_BOTS).map((bot, index) => {
    let id = typeof bot?.id === 'string' ? bot.id.trim() : ''
    if (id === '') id = `bot${index + 1}`
    if (seen.has(id)) id = `${id}-${index + 1}`
    seen.add(id)
    return {
      id,
      name: typeof bot?.name === 'string' && bot.name !== '' ? bot.name : id,
      enabled: bot?.enabled !== false,
      vars: strList(bot?.vars),
      anchors: strList(bot?.anchors),
      receiptAnchors: strList(bot?.receiptAnchors),
      mission: typeof bot?.mission === 'string' ? bot.mission : '',
      output: typeof bot?.output === 'string' ? bot.output : '',
      bounds: typeof bot?.bounds === 'string' ? bot.bounds : '',
    }
  })
  const varLabels =
    source.varLabels && typeof source.varLabels === 'object'
      ? Object.fromEntries(
          Object.entries(source.varLabels)
            .filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && v.trim() !== '')
            .map(([k, v]) => [k.trim(), v.trim()]),
        )
      : DEFAULTS.varLabels
  return {
    version: 3,
    rounds: Number.isFinite(source.rounds) ? Math.min(9, Math.max(0, Math.round(source.rounds))) : DEFAULTS.rounds,
    writeBack: typeof source.writeBack === 'boolean' ? source.writeBack : DEFAULTS.writeBack,
    varLabels,
    bots,
  }
}

/** Both fatal (block save) and advisory findings. */
function validate(config) {
  const fatal = []
  const warn = []
  const { bots } = config
  if (!Array.isArray(bots) || bots.length === 0) fatal.push('至少要有一个 Bot')
  if (bots.length > MAX_BOTS) fatal.push(`最多 ${MAX_BOTS} 个 Bot`)
  const ids = new Set()
  const placeholders = new Set()
  let enabledCount = 0
  bots.forEach((bot, i) => {
    const tag = `${i + 1}. ${bot.id || '(空 id)'}`
    if (!ID_RE.test(bot.id)) fatal.push(`${tag}：id 必须匹配 ${ID_RE}（小写字母开头，可含数字与连字符，2–32 位）`)
    if (ids.has(bot.id)) fatal.push(`${tag}：id 重复`)
    ids.add(bot.id)
    if (!bot.mission.trim()) fatal.push(`${tag}：任务（mission）不能为空`)
    if (bot.enabled) enabledCount += 1
    for (const m of bot.mission.matchAll(/<([^<>\s]{1,40})>/g)) placeholders.add(`${bot.id}:${m[1]}`)
    for (const m of `${bot.output}\n${bot.bounds}`.matchAll(/<([^<>\s]{1,40})>/g)) {
      if (!bot.vars.includes(m[1])) {
        warn.push(`${tag}：产出/边界里的 <${m[1]}> 未列进 vars（派单时不会提示缺值）`)
      }
    }
    for (const v of bot.vars) {
      if (!new RegExp(`<[^<>]*${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<>]*>`).test(bot.mission) &&
          !new RegExp(`<${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>`).test(`${bot.output}
${bot.bounds}`)) {
        warn.push(`${tag}：vars 里的 ${v} 在该 Bot 的文本里没有对应占位符`)
      }
    }
    for (const a of bot.anchors || []) {
      if (!bot.mission.includes(a)) {
        warn.push(`${tag}：anchors 里的「${a}」没出现在 mission —— dispatch_prompt.py --check 会判不合格`)
      }
    }
  })
  if (enabledCount === 0) fatal.push('所有 Bot 都被停用了，流水线是空的')
  return { fatal, warn, placeholders: [...placeholders] }
}

/** Ask the dispatch script to re-check the file we just wrote (fail-closed parity). */
function checkWithDispatch() {
  const script = dispatchScript()
  const tries = [process.env.PYTHON, 'python', 'python3'].filter(Boolean)
  for (const bin of tries) {
    const out = spawnSync(bin, [script, '--check'], { encoding: 'utf8', timeout: 30000 })
    if (out.error && out.error.code === 'ENOENT') continue
    return {
      ran: true,
      ok: out.status === 0,
      detail: `${(out.stdout || '').trim()}${(out.stderr || '').trim()}`.slice(0, 2000),
    }
  }
  return { ran: false, ok: true, detail: '未找到 python，跳过 --check' }
}

/** Read the JSON body of a request with a hard size cap. */
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** @param {import('node:http').ServerResponse} res */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

async function loadConfig() {
  try {
    const text = await readFile(configPath(), 'utf8')
    const config = normalize(JSON.parse(text))
    return { config, seeded: false, issues: validate(config) }
  } catch {
    return { config: DEFAULTS, seeded: true, issues: validate(DEFAULTS) }
  }
}

async function saveConfig(config) {
  const path = configPath()
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.tmp-${Date.now()}`
  await writeFile(temp, JSON.stringify(config, null, 2) + '\n', 'utf8')
  await rename(temp, path)
  return path
}

export const inject = ['webServer']

export function apply(ctx) {
  ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    async handler(req, res) {
      try {
        if (req.method === 'GET') {
          sendJson(res, 200, await loadConfig())
          return
        }
        if (req.method === 'POST') {
          const raw = await readBody(req)
          let parsed
          try {
            parsed = JSON.parse(raw)
          } catch {
            sendJson(res, 400, { ok: false, error: 'JSON 解析失败' })
            return
          }
          const config = normalize(parsed)
          const issues = validate(config)
          if (issues.fatal.length > 0) {
            sendJson(res, 400, { ok: false, error: '结构校验未通过', issues })
            return
          }
          const path = await saveConfig(config)
          const check = checkWithDispatch()
          if (!check.ok) {
            sendJson(res, 400, {
              ok: false,
              error: '已写入 bots.json，但 dispatch_prompt.py --check 未通过——请修正后再存',
              path,
              check,
              issues,
            })
            return
          }
          ctx.logger?.debug?.(`bot-console: 已写入 ${path}`)
          sendJson(res, 200, { ok: true, savedAt: Date.now(), path, config, issues, check })
          return
        }
        sendJson(res, 405, { ok: false, error: '只支持 GET / POST' })
      } catch (error) {
        ctx.logger?.warn?.(`bot-console: ${error?.message ?? error}`)
        sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  })
}
