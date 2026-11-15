/**
 * index.js 的功能测试：不开 HTTP、不过鉴权，直接拿 apply() 注册的 handler 跑。
 * 覆盖：GET 读配置 / POST 非法配置被拦（不写盘）/ POST 合法 4-Bot 配置写盘且 --check 通过。
 * 跑完把 bots.json 还原（先备份）。
 */
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { apply } from './index.js'

const LIVE = join(homedir(), '.dsh', 'skills', 'skill-orchestrator', 'bots.json')
const BAK = LIVE + '.testbak'

let handler
apply({ webServer: { register: (route) => { handler = route.handler } }, logger: { debug() {}, warn() {} } })

function makeReq(method, body) {
  return {
    method,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body), 'utf8')
    },
  }
}

function makeRes() {
  const out = { status: 0, payload: null }
  return {
    writeHead(status) { out.status = status },
    end(text) { try { out.payload = JSON.parse(text) } catch { out.payload = text } },
    get result() { return out },
  }
}

async function call(method, body) {
  const res = makeRes()
  await handler({ method, ...(body !== undefined ? { body } : {}) }, res)
  return res.result
}

// 上面 handler 需要真正的可迭代 req，这里包一层
async function callReal(method, body) {
  const res = makeRes()
  await handler(makeReq(method, body), res)
  const r = res.result
  return { status: r.status, ...(r.payload && typeof r.payload === 'object' ? r.payload : { error: r.payload }) }
}

const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)

async function main() {
  await copyFile(LIVE, BAK)
  try {
    const g = await callReal('GET')
    if (!g.config) console.log('GET 原始响应：', JSON.stringify(g).slice(0, 400))
    ok('GET 返回配置', g.status === 200 && Array.isArray(g.config?.bots), `bots=${g.config?.bots?.length}`)
    ok('三个内置 Bot 都带 vars', g.config.bots.every((b) => Array.isArray(b.vars)))
    ok('GET 附带 issues 字段', !!g.issues)

    // ① 非法：id 不合规 + 空 mission
    const bad = JSON.parse(await readFile(LIVE, 'utf8'))
    bad.bots[0].id = 'Bad_ID'
    bad.bots[1].mission = ''
    const r1 = await callReal('POST', bad)
    ok('非法配置被拦（400）', r1.status === 400, JSON.stringify(r1.error))
    const afterBad = JSON.parse(await readFile(LIVE, 'utf8'))
    ok('非法配置没写盘', afterBad.bots[0].id !== 'Bad_ID')

    // ② 合法：加第 4 个 Bot（factcheck）
    const good = JSON.parse(await readFile(LIVE, 'utf8'))
    good.bots.push({
      id: 'factcheck',
      name: 'Bot 4 · 事实核查',
      enabled: true,
      vars: ['output_path'],
      mission: '你是事实核查员，只核事实，不给建议。',
      output: '一张表：断言 / 证据位置 / 复现结果。审 <output_path>。',
      bounds: '工具预算 ≤8 次；查不到写「无法核实」；不改文件。',
    })
    const r2 = await callReal('POST', good)
    ok('合法 4-Bot 配置写入（200）', r2.status === 200, JSON.stringify(r2.error || ''))
    ok('写盘后 --check 通过', !!r2.check?.ok, JSON.stringify(r2.check?.detail || '').slice(0, 120))
    const disk = JSON.parse(await readFile(LIVE, 'utf8'))
    ok('磁盘上真有 4 个 Bot', disk.bots.length === 4, disk.bots.map((b) => b.id).join(','))

    // ③ 删除一个 Bot（回到 3 个，删 scribe）
    const minus = JSON.parse(await readFile(LIVE, 'utf8'))
    minus.bots = minus.bots.filter((b) => b.id !== 'scribe')
    const r3 = await callReal('POST', minus)
    ok('删除 scribe 后仍可保存', r3.status === 200 && r3.config.bots.length === 3,
      r3.config.bots.map((b) => b.id).join(','))
    ok('删除后 --check 仍通过（不强制三件套）', !!r3.check?.ok)
  } finally {
    await copyFile(BAK, LIVE)
    const restored = JSON.parse(await readFile(LIVE, 'utf8'))
    console.log('已还原 bots.json：', restored.bots.map((b) => b.id).join(','))
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
