window.__ModuleLoader__.load({
  id: 'dsh-bot-console',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo } = React

    const ROUTE = '/plugins/dsh-bot-console/config'

    const t = {
      border: 'var(--dsw-alias-border-l1, rgba(127,127,127,.28))',
      borderStrong: 'var(--dsw-alias-border-l2, rgba(127,127,127,.45))',
      card: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06))',
      nested: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10))',
      text: 'var(--dsw-alias-label-primary, inherit)',
      dim: 'var(--dsw-alias-label-secondary, rgba(127,127,127,.95))',
      brand: 'var(--dsw-alias-brand-primary, #4d8dff)',
      error: 'var(--dsw-alias-state-error-primary, #d64545)',
      ok: 'var(--dsw-alias-state-success-primary, #2f9e5b)',
    }

    const label = { display: 'block', fontSize: 12, color: t.dim, marginBottom: 4 }
    const field = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '7px 9px',
      borderRadius: 7,
      border: `1px solid ${t.border}`,
      background: t.nested,
      color: t.text,
      font: 'inherit',
      fontSize: 13,
      lineHeight: 1.55,
      outline: 'none',
      resize: 'vertical',
    }
    const card = {
      border: `1px solid ${t.border}`,
      background: t.card,
      borderRadius: 10,
      padding: 14,
      marginBottom: 12,
    }
    const button = (primary) => ({
      padding: '6px 14px',
      borderRadius: 7,
      border: `1px solid ${primary ? t.brand : t.borderStrong}`,
      background: primary ? t.brand : 'transparent',
      color: primary ? '#fff' : t.text,
      font: 'inherit',
      fontSize: 13,
      cursor: 'pointer',
      opacity: 1,
    })

    async function api(method, body) {
      const response = await fetch(ROUTE, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await response.text()
      let parsed
      try {
        parsed = text === '' ? {} : JSON.parse(text)
      } catch {
        throw new Error(`接口返回了非 JSON 内容（HTTP ${response.status}）`)
      }
      if (!response.ok) {
        const extra = parsed.issues?.fatal?.length ? '：' + parsed.issues.fatal.join('；') : ''
        throw new Error((parsed.error || `HTTP ${response.status}`) + extra)
      }
      return parsed
    }

    function Field(props) {
      return h(
        'label',
        { style: { display: 'block', marginTop: props.first ? 0 : 12 } },
        h('span', { style: label }, props.label),
        props.hint ? h('span', { style: { ...label, marginTop: -2, opacity: 0.8 } }, props.hint) : null,
        h(
          props.rows ? 'textarea' : 'input',
          {
            style: { ...field, minHeight: props.rows ? props.rows * 22 : undefined },
            rows: props.rows,
            value: props.value,
            placeholder: props.placeholder,
            onChange: (event) => props.onChange(event.target.value),
          },
        ),
      )
    }

    function ChipField(props) {
      const { text, hint, items, onChange, placeholder } = props
      const [draft, setDraft] = useState('')
      const list = Array.isArray(items) ? items : []
      const add = () => {
        const v = draft.trim()
        if (!v) return
        if (!list.includes(v)) onChange([...list, v])
        setDraft('')
      }
      return h(
        'div',
        { style: { marginTop: 12 } },
        h('span', { style: label }, text),
        hint ? h('span', { style: { ...label, marginTop: -2, opacity: 0.8 } }, hint) : null,
        h(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0' } },
          list.length === 0
            ? h('span', { style: { fontSize: 12, color: t.dim } }, '（无）')
            : list.map((v, i) =>
                h(
                  'span',
                  {
                    key: v + i,
                    style: {
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      padding: '2px 8px',
                      borderRadius: 999,
                      border: `1px solid ${t.borderStrong}`,
                      background: t.nested,
                    },
                  },
                  h('code', { style: { fontSize: 11 } }, v),
                  h(
                    'button',
                    {
                      style: { border: 'none', background: 'transparent', color: t.dim, cursor: 'pointer', fontSize: 12, padding: 0 },
                      onClick: () => onChange(list.filter((_, j) => j !== i)),
                      title: '移除',
                    },
                    '×',
                  ),
                ),
              ),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 6 } },
          h('input', {
            style: { ...field, flex: 1, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 },
            value: draft,
            placeholder: placeholder || '',
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                add()
              }
            },
          }),
          h('button', { style: button(false), onClick: add }, '添加'),
        ),
      )
    }

    function BotCard(props) {
      const { bot, onChange, index, total, onMove, onRemove } = props
      const patch = (key) => (value) => onChange(index, { ...bot, [key]: value })
      return h(
        'div',
        { style: card },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' } },
          h('span', { style: { fontSize: 11, color: t.dim, minWidth: 18 } }, `#${index + 1}`),
          h('input', {
            style: { ...field, width: 170, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 },
            value: bot.id,
            placeholder: 'id（小写字母开头）',
            title: '派单时用 --bot <id>；改动后旧记录对不上',
            onChange: (event) => patch('id')(event.target.value),
          }),
          h('input', {
            style: { ...field, flex: 1, minWidth: 160, fontSize: 14 },
            value: bot.name,
            placeholder: '显示名',
            onChange: (event) => patch('name')(event.target.value),
          }),
          h(
            'label',
            { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: t.dim, whiteSpace: 'nowrap' } },
            h('input', {
              type: 'checkbox',
              checked: bot.enabled,
              onChange: (event) => patch('enabled')(event.target.checked),
            }),
            '启用',
          ),
          h('button', { style: button(false), onClick: () => onMove(index, -1), disabled: index === 0, title: '上移' }, '↑'),
          h('button', { style: button(false), onClick: () => onMove(index, 1), disabled: index === total - 1, title: '下移' }, '↓'),
          h(
            'button',
            { style: { ...button(false), color: t.error, borderColor: t.error }, onClick: () => onRemove(index), title: '删除这个 Bot' },
            '删除',
          ),
        ),
        h(Field, {
          label: '任务（派发时原样写进 brief 的主体）',
          rows: 3,
          first: true,
          value: bot.mission,
          onChange: patch('mission'),
        }),
        h(Field, { label: '产出与回执要求', rows: 2, value: bot.output, onChange: patch('output') }),
        h(Field, { label: '边界与禁令', rows: 2, value: bot.bounds, onChange: patch('bounds') }),
        h(ChipField, {
          text: '必填上下文 vars —— 派单时这些占位符必须有值，缺一个 dispatch_prompt.py 就拒渲染',
          items: bot.vars,
          onChange: patch('vars'),
          placeholder: 'output_path',
        }),
        h(ChipField, {
          text: '契约锚词 anchors —— mission 必须含这些词（防"配置被改薄"），空则不检查',
          items: bot.anchors,
          onChange: patch('anchors'),
          placeholder: '自我净化',
        }),
        h(ChipField, {
          text: '回执锚词 receiptAnchors —— Bot 回执里必须逐条出现，缺一条判未完成',
          items: bot.receiptAnchors,
          onChange: patch('receiptAnchors'),
          placeholder: '自我净化',
        }),
      )
    }

    function BotConsole() {
      const [state, setState] = useState({ phase: 'loading', data: null, error: '', note: '' })

      const load = useCallback(async () => {
        setState({ phase: 'loading', data: null, error: '', note: '' })
        try {
          const result = await api('GET')
          setState({
            phase: 'ready',
            data: result.config,
            error: '',
            issues: result.issues || null,
            note: result.seeded ? '尚未保存过：下面是 SKILL.md 当前的默认值' : '',
          })
        } catch (error) {
          setState({ phase: 'error', data: null, error: String(error?.message ?? error), note: '' })
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const save = useCallback(async () => {
        setState((prev) => ({ ...prev, note: '保存中…' }))
        try {
          const result = await api('POST', state.data)
          setState((prev) => ({
            ...prev,
            data: result.config || prev.data,
            issues: result.issues || prev.issues,
            note: `已保存到 ${result.path || 'bots.json'}${result.check && result.check.ran === false ? '（未跑 --check）' : ''}`,
            error: '',
          }))
        } catch (error) {
          setState((prev) => ({ ...prev, note: '', error: String(error?.message ?? error) }))
        }
      }, [state.data])

      const patchBot = useCallback((index, next) => {
        setState((prev) => {
          if (!prev.data) return prev
          const bots = prev.data.bots.slice()
          bots[index] = next
          return { ...prev, data: { ...prev.data, bots }, note: '有未保存的改动' }
        })
      }, [])

      const patchTop = useCallback((key, value) => {
        setState((prev) =>
          prev.data ? { ...prev, data: { ...prev.data, [key]: value }, note: '有未保存的改动' } : prev,
        )
      }, [])

      const addBot = useCallback(() => {
        setState((prev) => {
          if (!prev.data) return prev
          const bots = prev.data.bots.slice()
          const taken = new Set(bots.map((b) => b.id))
          let n = bots.length + 1
          while (taken.has(`bot${n}`)) n += 1
          bots.push({
            id: `bot${n}`,
            name: `Bot ${bots.length + 1}`,
            enabled: true,
            vars: [],
            mission: '',
            output: '',
            bounds: '不得修改任何 SKILL.md，不得 git commit，不得派子代理。',
          })
          return { ...prev, data: { ...prev.data, bots }, note: '已新增一个 Bot：填好 id 与任务再保存' }
        })
      }, [])

      const removeBot = useCallback((index) => {
        setState((prev) => {
          if (!prev.data) return prev
          const target = prev.data.bots[index]
          if (!target) return prev
          const ok = window.confirm?.(`删除 Bot「${target.name || target.id}」？\n保存后生效，未保存前可点「重新读取」撤销。`)
          if (ok === false) return prev
          const bots = prev.data.bots.slice()
          bots.splice(index, 1)
          return { ...prev, data: { ...prev.data, bots }, note: `已移除 ${target.id}（未保存）` }
        })
      }, [])

      const moveBot = useCallback((index, delta) => {
        setState((prev) => {
          if (!prev.data) return prev
          const bots = prev.data.bots.slice()
          const j = index + delta
          if (j < 0 || j >= bots.length) return prev
          const [item] = bots.splice(index, 1)
          bots.splice(j, 0, item)
          return { ...prev, data: { ...prev.data, bots }, note: '调整了顺序（未保存）' }
        })
      }, [])

      const body = useMemo(() => {
        if (state.phase === 'loading') return h('div', { style: { color: t.dim, fontSize: 13 } }, '正在读取…')
        if (state.phase === 'error') {
          return h(
            'div',
            { style: { color: t.error, fontSize: 13 } },
            `读取失败：${state.error}`,
            h('div', { style: { marginTop: 8 } }, h('button', { style: button(false), onClick: load }, '重试')),
          )
        }
        const data = state.data
        return h(
          'div',
          null,
          h(
            'div',
            { style: card },
            h('div', { style: { fontSize: 13, color: t.dim, marginBottom: 10 } }, '全局'),
            h(
              'div',
              { style: { display: 'flex', gap: 24, flexWrap: 'wrap' } },
              h(
                'label',
                { style: { fontSize: 13, color: t.text } },
                h('span', { style: label }, 'Bot 1 ↔ Bot 2 最多几轮'),
                h('input', {
                  type: 'number',
                  min: 0,
                  max: 9,
                  style: { ...field, width: 90 },
                  value: data.rounds,
                  onChange: (event) => patchTop('rounds', Number(event.target.value)),
                }),
              ),
              h(
                'label',
                { style: { fontSize: 13, color: t.text, display: 'flex', alignItems: 'center', gap: 8, marginTop: 18 } },
                h('input', {
                  type: 'checkbox',
                  checked: data.writeBack,
                  onChange: (event) => patchTop('writeBack', event.target.checked),
                }),
                '允许 Bot 3 直接提交（关掉则只出 diff）',
              ),
            ),
          ),
          ...data.bots.map((bot, index) =>
            h(BotCard, {
              key: `${bot.id}-${index}`,
              bot,
              index,
              total: data.bots.length,
              onChange: patchBot,
              onMove: moveBot,
              onRemove: removeBot,
            }),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 } },
            h('button', { style: button(false), onClick: addBot }, '＋ 新增 Bot'),
            h(
              'span',
              { style: { fontSize: 12, color: t.dim } },
              `共 ${data.bots.length} 个；顺序即流水线顺序；id 自己起（如 factcheck / preflight）`,
            ),
          ),
          state.issues && (state.issues.fatal?.length || state.issues.warn?.length)
            ? h(
                'div',
                { style: { ...card, marginTop: 12, borderColor: state.issues.fatal?.length ? t.error : t.borderStrong } },
                h('div', { style: { fontSize: 12, color: t.dim, marginBottom: 6 } }, '校验结果（保存时以后端 --check 为准）'),
                ...(state.issues.fatal || []).map((m, i) =>
                  h('div', { key: `f${i}`, style: { fontSize: 12, color: t.error } }, `✗ ${m}`),
                ),
                ...(state.issues.warn || []).map((m, i) =>
                  h('div', { key: `w${i}`, style: { fontSize: 12, color: t.dim } }, `⚠ ${m}`),
                ),
              )
            : null,
        )
      }, [state, load, patchBot, patchTop, addBot, removeBot, moveBot])

      return h(
        'div',
        { style: { color: t.text, fontSize: 13, paddingBottom: 24 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 } },
          h('h2', { style: { margin: 0, fontSize: 16, fontWeight: 600 } }, '多 Bot 编排'),
          h('span', { style: { color: t.dim, fontSize: 12 } }, '决定「用编排」时每个子代理拿到什么任务'),
        ),
        h(
          'div',
          { style: { color: t.dim, fontSize: 12, marginBottom: 14 } },
          '保存后写入 skills/skill-orchestrator/bots.json；下次说「用编排」时父 agent 直接读它，不再改 SKILL.md。',
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 } },
          h('button', { style: button(true), onClick: save, disabled: state.phase !== 'ready' }, '保存'),
          h('button', { style: button(false), onClick: load }, '重新读取'),
          state.note ? h('span', { style: { fontSize: 12, color: t.dim } }, state.note) : null,
          state.error ? h('span', { style: { fontSize: 12, color: t.error } }, state.error) : null,
        ),
        body,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'dsh-bot-console',
              order: 25,
              label: () => '多 Bot 编排',
            },
            BotConsole,
          ),
        )
      },
    }
  },
})
