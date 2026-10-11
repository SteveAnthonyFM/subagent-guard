import type { EngineInterface, Register } from 'claude-code'

import type { GuardSettings, ModelCap, Run, Step } from '../types'

const PANE = 'subagent-guard'
const DETAIL = 'subagent-guard-detail'
const TIERS: readonly ModelCap[] = ['haiku', 'sonnet', 'opus', 'fable']
const MAX_LIMIT = 8
// Built-in read-only helpers are left alone, as asked.
const EXEMPT: readonly string[] = ['Explore', 'Plan', 'statusline-setup', 'claude-code-guide']
const ACTIVE = ['pending', 'running', 'waiting']
const FACTORY: GuardSettings = { isEnabled: true, maxConcurrent: 1, modelCap: 'haiku' }

const SETTINGS = { plugin: 'subagent-guard', key: 'settings' } as const
const SAVED = { plugin: 'subagent-guard', key: 'saved' } as const
const BLOCKED = { plugin: 'subagent-guard', key: 'blocked' } as const
const RUNS = { plugin: 'subagent-guard', key: 'runs' } as const
const SELECTED = { plugin: 'subagent-guard', key: 'selected' } as const

// `$.state` is the session's home for these values (survives a hot reload and
// redraws the pane). The module copy is a fallback for an engine without it.
const mem: {
  settings: GuardSettings
  saved: GuardSettings
  blocked: number
  runs: Run[]
  selected: string | null
} = {
  settings: FACTORY,
  saved: FACTORY,
  blocked: 0,
  runs: [],
  selected: null,
}

// Run updates are applied one after another so parallel helpers never lose a step.
let queue: Promise<unknown> = Promise.resolve()
const enqueue = (job: () => Promise<unknown>) => {
  queue = queue.then(job).catch(() => undefined)

  return queue
}

const redraw = ($: EngineInterface) => {
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // nothing is drawing
  }
}

const getSettings = async ($: EngineInterface): Promise<GuardSettings> => {
  try {
    const held = await $.state.get(SETTINGS)
    if (held.value !== undefined) {
      return held.value
    }
  } catch {
    // no $.state here: the module copy answers
  }

  return mem.settings
}
const putSettings = async ($: EngineInterface, v: GuardSettings) => {
  mem.settings = v
  try {
    await $.state.set(SETTINGS, v)
  } catch {
    redraw($)
  }
}
const getSaved = async ($: EngineInterface): Promise<GuardSettings> => {
  try {
    const held = await $.state.get(SAVED)
    if (held.value !== undefined) {
      return held.value
    }
  } catch {
    // module copy
  }

  return mem.saved
}
const putSaved = async ($: EngineInterface, v: GuardSettings) => {
  mem.saved = v
  try {
    await $.state.set(SAVED, v)
  } catch {
    redraw($)
  }
}
const getBlocked = async ($: EngineInterface): Promise<number> => {
  try {
    const held = await $.state.get(BLOCKED)
    if (held.value !== undefined) {
      return held.value
    }
  } catch {
    // module copy
  }

  return mem.blocked
}
const countBlock = async ($: EngineInterface) => {
  const n = (await getBlocked($)) + 1
  mem.blocked = n
  try {
    await $.state.set(BLOCKED, n)
  } catch {
    redraw($)
  }
  await showStatus($, await getSettings($))
}

const HATS = ['#8B5A2B', '#2E9E6B', '#F2F2F2', '#F2B632', '#4A7FD6', '#B06AD1', '#D9534F', '#3FB8B8']
const BODY = '#D97757'
const EYE = '#1F1F1F'

// A pixel crab on an 11 x 9 grid; no hat is Claude, a hat is a helper.
// Bobbing is two still frames swapped by the pane's own tick: plain images, so nothing reloads.
type Crab = { hat?: string; isBobbing: boolean }

const crabScene = (crabs: readonly Crab[], frame: number, isSolo: boolean) => {
  const px = 4
  const w = 11
  const gap = 2
  const rect = (x: number, y: number, c: string, ww = 1) =>
    `<rect x="${x * px}" y="${y * px}" width="${ww * px}" height="${px}" fill="${c}"/>`
  let out = ''
  crabs.forEach((crab, i) => {
    const body = isSolo ? '#8a8a8a' : BODY
    const lift = crab.isBobbing && !isSolo && (frame + i) % 2 === 0 ? 0 : 1
    let g = ''
    if (crab.hat !== undefined) {
      g += rect(3, lift, crab.hat, 5) + rect(2, lift + 1, crab.hat, 7)
    }
    g += rect(2, lift + 2, body, 7) + rect(2, lift + 3, body, 7)
    g += rect(0, lift + 4, body, 11) + rect(0, lift + 5, body, 11)
    g += rect(2, lift + 6, body, 7)
    g += rect(3, lift + 3, EYE) + rect(7, lift + 3, EYE)
    for (const x of [2, 4, 6, 8]) {
      g += rect(x, lift + 7, body) + rect(x, lift + 8, body)
    }
    out += `<g transform="translate(${i * (w + gap) * px} 0)">${g}</g>`
  })
  const width = (crabs.length * w + (crabs.length - 1) * gap) * px
  const height = 10 * px

  return {
    width,
    height,
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" shape-rendering="crispEdges">${out}</svg>`,
  }
}

const getRuns = async ($: EngineInterface): Promise<Run[]> => {
  try {
    const held = await $.state.get(RUNS)
    if (held.value !== undefined) {
      return held.value
    }
  } catch {
    // module copy
  }

  return mem.runs
}
const putRuns = async ($: EngineInterface, v: Run[]) => {
  mem.runs = v
  try {
    await $.state.set(RUNS, v)
  } catch {
    redraw($)
  }
}
const patchRun = async ($: EngineInterface, id: string, fn: (r: Run) => Run) => {
  const runs = await getRuns($)
  if (runs.some(r => r.id === id)) {
    await putRuns($, runs.map(r => (r.id === id ? fn(r) : r)))
  }
}

const getSelected = async ($: EngineInterface): Promise<string | null> => {
  try {
    const held = await $.state.get(SELECTED)
    if (held.value !== undefined) {
      return held.value
    }
  } catch {
    // module copy
  }

  return mem.selected
}
const showDetail = async ($: EngineInterface, id: string) => {
  mem.selected = id
  try {
    await $.state.set(SELECTED, id)
  } catch {
    redraw($)
  }
  await $.ui.open({ id: DETAIL, title: 'What the helper did', focus: true })
}

const shorten = (text: string, n: number) => {
  const one = text.replace(/\s+/g, ' ').trim()

  return one.length > n ? `${one.slice(0, n - 1)}\u2026` : one
}
const baseName = (path: unknown) => String(path ?? '').split('/').filter(Boolean).pop() ?? 'a file'

// One step in plain words, from what the helper's tool call said.
const stepWords = (tool: string, input: Record<string, unknown>): string => {
  switch (tool) {
    case 'Read':
      return `Read ${baseName(input.file_path)}`
    case 'Edit':
    case 'MultiEdit':
      return `Edited ${baseName(input.file_path)}`
    case 'Write':
      return `Wrote ${baseName(input.file_path)}`
    case 'Bash':
      return `Ran a command: ${shorten(String(input.command ?? ''), 90)}`
    case 'Grep':
      return `Searched files for \u201c${shorten(String(input.pattern ?? ''), 60)}\u201d`
    case 'Glob':
      return `Looked for files matching ${shorten(String(input.pattern ?? ''), 60)}`
    case 'WebSearch':
      return `Searched the web for \u201c${shorten(String(input.query ?? ''), 60)}\u201d`
    case 'WebFetch':
      return `Opened a web page: ${shorten(String(input.url ?? ''), 70)}`
    default:
      return tool.startsWith('mcp__') ? 'Used a connected tool' : `Used ${tool}`
  }
}

const TOOL_WORDS: Record<string, string> = {
  Read: 'Reading files',
  Edit: 'Editing a file',
  Write: 'Writing a file',
  NotebookEdit: 'Editing a notebook',
  Bash: 'Running a command',
  Grep: 'Searching files',
  Glob: 'Looking for files',
  WebSearch: 'Searching the web',
  WebFetch: 'Reading a web page',
}
const toolWords = (tool: string) =>
  TOOL_WORDS[tool] ?? (tool.startsWith('mcp__') ? 'Using a connected tool' : `Using ${tool}`)

const clockText = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000))

  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
const kTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const kindWords = (t: string) => (t === 'general-purpose' ? 'General helper' : t)

// The pane's heartbeat: it swaps a working crab's two frames and ticks the clocks. Each
// beat redraws the pane, so it runs only while a helper is working and stops when idle.
const BEAT_MS = 1000
let isBeating = false

const watch = ($: EngineInterface) => {
  if (isBeating) {
    return
  }
  isBeating = true
  const beat = () => {
    redraw($)
    if (mem.runs.some(r => r.status === 'running')) {
      $.clock.after(BEAT_MS, beat)
    } else {
      isBeating = false
    }
  }
  $.clock.after(BEAT_MS, beat)
}

const clampMax = (n: number) => Math.min(MAX_LIMIT, Math.max(1, Math.round(n)))

const normalize = (raw: unknown): GuardSettings => {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>

  return {
    isEnabled: typeof r.isEnabled === 'boolean' ? r.isEnabled : FACTORY.isEnabled,
    maxConcurrent:
      typeof r.maxConcurrent === 'number' && Number.isFinite(r.maxConcurrent)
        ? clampMax(r.maxConcurrent)
        : FACTORY.maxConcurrent,
    modelCap: TIERS.includes(r.modelCap as ModelCap) ? (r.modelCap as ModelCap) : FACTORY.modelCap,
  }
}

const tierOf = (model: string | undefined): number => {
  const m = (model ?? '').toLowerCase()

  return TIERS.findIndex(t => m.includes(t))
}

const isSame = (a: GuardSettings, b: GuardSettings) =>
  a.isEnabled === b.isEnabled && a.maxConcurrent === b.maxConcurrent && a.modelCap === b.modelCap

const NAMES: Record<ModelCap, string> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fable: 'Fable' }
const BLURBS: Record<ModelCap, string> = {
  haiku: 'fastest and lightest on usage',
  sonnet: 'balanced speed and ability',
  opus: 'most capable, uses more',
  fable: 'top tier, uses the most',
}

const modelName = (m: string) => {
  const i = tierOf(m)

  return i === -1 ? m : NAMES[TIERS[i] as ModelCap]
}

const plural = (n: number) => (n === 1 ? '1 helper' : `${n} helpers`)

const describe = (s: GuardSettings) =>
  s.isEnabled
    ? `${plural(s.maxConcurrent)} at a time, up to ${NAMES[s.modelCap]}`
    : 'helper agents are off'

const showStatus = async ($: EngineInterface, s: GuardSettings) => {
  const n = await getBlocked($)
  const stopped = n > 0 ? ` \u00b7 ${n} stopped` : ''
  $.ui.status(
    s.isEnabled
      ? `Helper agents: ${s.maxConcurrent} at a time \u00b7 up to ${NAMES[s.modelCap]}${stopped}`
      : `Helper agents: off${stopped}`,
  )
}

const change = async ($: EngineInterface, patch: Partial<GuardSettings>) => {
  const next = normalize({ ...(await getSettings($)), ...patch })
  await putSettings($, next)
  await showStatus($, next)
}

const saveDefault = async ($: EngineInterface) => {
  const s = await getSettings($)
  await $.store.set('saved', s)
  await putSaved($, s)
}

export const register: Register = on => {
  // Spawns admitted by the guard that `agent.list()` may not show yet.
  let inflight = 0

  on('session.start', async ($, e, next) => {
    const remembered = normalize(await $.store.get('saved'))
    await putSaved($, remembered)

    // A hot reload fires session.start again: keep this session's override.
    let isFresh = true
    try {
      isFresh = (await $.state.get(SETTINGS)).value === undefined
    } catch {
      isFresh = true
    }
    if (isFresh) {
      await putSettings($, remembered)
    }
    await showStatus($, await getSettings($))

    await $.command.register({
      name: 'subagents',
      description: 'Subagent safeguard: pane, or "max N", "model <tier>", "on|off", "save", "reset", "status"',
    })
    void $.ui.open({ id: PANE, title: 'Helper Agent Safeguard' })

    return next(e)
  })

  // A pane opened unasked can wait undrawn (narrow window, or a surface still attaching).
  // A pane opened behind the person's own prompt is placed at any width, so the first
  // prompt of the session seats it, once; closing it afterwards is respected.
  let isSeated = false

  on('prompt.submit', async ($, e, next) => {
    if (!isSeated) {
      isSeated = true
      void $.ui.open({ id: PANE, title: 'Helper Agent Safeguard' })
    }

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    let out = e
    if (!EXEMPT.includes(e.subagentType)) {
      const s = await getSettings($)
      if (!s.isEnabled) {
        await countBlock($)

        return {
          deny: 'subagent-guard: subagents are disabled for this session. Do this work directly in the main thread.',
        }
      }

      const agents = await $.agent.list()
      // No await between this count and the increment, so parallel spawns see each other.
      const active = agents.filter(a => !EXEMPT.includes(a.type) && ACTIVE.includes(a.status)).length
      if (active + inflight >= s.maxConcurrent) {
        await countBlock($)

        return {
          deny: `subagent-guard: subagent limit reached (${active + inflight} running, max ${s.maxConcurrent}). Do this work directly in the main thread, or wait for the running subagent to finish.`,
        }
      }

      // Pull a heavier requested (or inherited) model down to the cap.
      const cap = TIERS.indexOf(s.modelCap)
      const requested = e.model === undefined || e.model === 'inherit' ? e.parentModel : e.model
      const tier = tierOf(requested)
      const isOver = !e.fork && (tier === -1 || tier > cap)
      out = isOver ? { ...e, model: s.modelCap } : e
      inflight += 1
    }

    const isGuarded = !EXEMPT.includes(e.subagentType)
    try {
      const started = await next(out)
      if (started.deny === undefined && started.agentId !== undefined) {
        const id = started.agentId
        const run: Run = {
          id,
          label: (out.description || out.prompt).slice(0, 60),
          type: out.subagentType,
          model: started.model,
          status: 'running',
          startedAt: await $.clock.now(),
          tools: 0,
          hat: HATS[0] ?? BODY,
          steps: [],
        }
        await enqueue(async () => {
          const runs = await getRuns($)
          const inUse = runs.filter(r => r.status === 'running').map(r => r.hat)
          run.hat = HATS.find(h => !inUse.includes(h)) ?? HATS[runs.length % HATS.length] ?? BODY
          await putRuns($, [...runs.filter(r => r.id !== id), run].slice(-24))
        })
        watch($)
      }

      return started
    } finally {
      if (isGuarded) {
        inflight -= 1
      }
    }
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) {
      const tool = e.tool
      const text = stepWords(tool, e as unknown as Record<string, unknown>)
      void enqueue(async () => {
        const at = await $.clock.now()
        await patchRun($, id, r => ({
          ...r,
          tools: r.tools + 1,
          lastTool: toolWords(tool),
          steps: [...r.steps, { text, at: at - r.startedAt } as Step].slice(-60),
        }))
      })
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) {
      const now = await $.clock.now()
      const status = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
      const tokens = e.usage ? e.usage.input_tokens + e.usage.output_tokens : undefined
      void enqueue(() =>
        patchRun($, id, r => ({
          ...r,
          status,
          endedAt: now,
          summary: e.answer.trim() === '' ? r.summary : shorten(e.answer, 1400),
          tokens: tokens === undefined ? r.tokens : (r.tokens ?? 0) + tokens,
        })),
      )
    }

    return next(e)
  })

  on('command.run', { command: 'subagents' }, async ($, e) => {
    const args = e.args.trim().toLowerCase()
    const [word, value] = args.split(/\s+/)

    if (args === '') {
      // The pane may still be seating itself when open() answers, so never report failure here.
      await $.ui.open({ id: PANE, title: 'Helper Agent Safeguard' })
      const s = await getSettings($)

      return {
        text: `Opening the Helper Agent Safeguard pane. Now: ${describe(s)}. (Typed shortcuts: /subagents max N, model <tier>, on, off, save, reset.)`,
      }
    }
    if (word === 'status') {
      const s = await getSettings($)
      const d = await getSaved($)
      const n = await getBlocked($)

      return {
        text: `Now: ${describe(s)}. Saved default: ${describe(d)}. Blocked this session: ${n}.`,
      }
    }
    if (word === 'on' || word === 'off') {
      await change($, { isEnabled: word === 'on' })
    } else if (word === 'max' && value !== undefined && Number.isFinite(Number(value))) {
      await change($, { maxConcurrent: Number(value) })
    } else if (word === 'model' && TIERS.includes(value as ModelCap)) {
      await change($, { modelCap: value as ModelCap })
    } else if (word === 'save') {
      await saveDefault($)
      return { text: `Saved as your default: ${describe(await getSettings($))}.` }
    } else if (word === 'reset') {
      await change($, await getSaved($))
    } else {
      return { text: 'Usage: /subagents [status | on | off | max <1-8> | model <haiku|sonnet|opus|fable> | save | reset]' }
    }

    return { text: `Now: ${describe(await getSettings($))} (this session only; /subagents save to keep).` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, ...rest } = $.ui.resolve(e)
    const Svg = 'Svg' in rest ? rest.Svg : undefined
    const s = await getSettings($)
    const d = await getSaved($)
    const n = await getBlocked($)
    const isSaved = isSame(s, d)
    const isSolo = !s.isEnabled
    const runs = await getRuns($)
    const now = await $.clock.now()
    const running = runs.filter(r => r.status === 'running')
    const frame = Math.floor(now / BEAT_MS) % 2
    const finished = runs.filter(r => r.status !== 'running')

    // The pen holds Claude and the helpers who are not out working.
    const inUse = running.map(r => r.hat)
    const penCount = isSolo ? 0 : Math.max(0, s.maxConcurrent - running.length)
    const pen: Crab[] = HATS.filter(h => !inUse.includes(h))
      .slice(0, penCount)
      .map(hat => ({ hat, isBobbing: false }))
    const scene = crabScene([{ isBobbing: false }, ...pen], frame, isSolo)
    const caption =
      running.length > 0
        ? `${plural(running.length)} out working${pen.length > 0 ? `, ${pen.length} resting here.` : '.'}`
        : isSolo
          ? 'Claude is working solo.'
          : s.maxConcurrent === 1
            ? 'Claude and 1 helper, ready when needed.'
            : `Claude and ${s.maxConcurrent} helpers, ready when needed.`

    const glyph = (r: Run) =>
      r.status === 'running'
        ? { mark: '● Working', color: 'claude' }
        : r.status === 'done'
          ? { mark: '✓ Done', color: 'success' }
          : r.status === 'stopped'
            ? { mark: '■ Stopped', color: 'warning' }
            : { mark: '✕ Problem', color: 'error' }
    const row = (r: Run) => {
      const g = glyph(r)
      const spent = clockText((r.endedAt ?? now) - r.startedAt)
      const detail = r.status === 'running' ? (r.lastTool ?? 'Getting started…') : 'Finished'
      const stepsLabel = r.tools === 1 ? '1 step taken' : `${r.tools} steps taken`
      const crab = crabScene([{ hat: r.hat, isBobbing: true }], frame, false)

      return (
        <Box key={`run-${r.id}`} flexDirection="row" gap={2} marginBottom={1}>
          {r.status === 'running' && Svg ? (
            <Svg source={crab.source} width={crab.width} height={crab.height} alt="A helper crab at work" />
          ) : null}
          <Box flexDirection="column" flexGrow={1}>
            <Box justifyContent="space-between">
              <Button
                key={`title-${r.id}`}
                plain
                label={r.label}
                onPress={() => showDetail($, r.id)}
              />
              <Text color={g.color}>{g.mark}</Text>
            </Box>
            <Text dimColor>
              {kindWords(r.type)} ({modelName(r.model)})
            </Text>
            <Text dimColor>{detail}</Text>
            <Box justifyContent="space-between">
              <Button
                key={`steps-${r.id}`}
                plain
                dimColor
                label={`${stepsLabel} ›`}
                onPress={() => showDetail($, r.id)}
              />
              <Text dimColor>
                {r.tokens === undefined ? '' : `${kTokens(r.tokens)} tokens · `}
                {spent}
              </Text>
            </Box>
            <Text color={g.color} dimColor={r.status !== 'running'}>
              {'━'.repeat(r.status === 'running' ? 12 : 30)}
            </Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Box flexDirection="column">
          <Text bold color="claude">
            Helper Agent Safeguard
          </Text>
          <Text dimColor>Keeps background helpers from running up your usage.</Text>
        </Box>

        <Box borderStyle="round" borderColor="subtle" paddingX={1} paddingY={1} flexDirection="column" alignItems="center">
          {Svg ? (
            <Svg source={scene.source} width={scene.width} height={scene.height} alt={`Claude with ${pen.length} resting helper crabs`} />
          ) : (
            <Text>{'\u{1F980}'.repeat(pen.length + 1)}</Text>
          )}
          <Text dimColor>{caption}</Text>
        </Box>

        {runs.length > 0 && (
          <Box borderStyle="round" borderColor={running.length > 0 ? 'claude' : 'subtle'} paddingX={1} flexDirection="column">
            {running.length > 0 && (
              <Box flexDirection="column">
                <Text bold>Running {'·'} {String(running.length)}</Text>
                <Text> </Text>
                {running.map(row)}
              </Box>
            )}
            {finished.length > 0 && (
              <Box flexDirection="column">
                <Text bold dimColor>
                  Finished {'·'} {String(finished.length)}
                </Text>
                <Text> </Text>
                {finished.map(row)}
                <Box>
                  <Button
                    key="clear"
                    label="Clear finished"
                    onPress={() =>
                      enqueue(async () => {
                        const all = await getRuns($)
                        await putRuns($, all.filter(r => r.status === 'running'))
                      })
                    }
                  />
                </Box>
              </Box>
            )}
          </Box>
        )}

        <Box borderStyle="round" borderColor={s.isEnabled ? 'success' : 'warning'} paddingX={1} flexDirection="column">
          <Box justifyContent="space-between">
            <Text bold>Helper agents</Text>
            <Text bold color={s.isEnabled ? 'success' : 'warning'}>
              {s.isEnabled ? '● Allowed' : '○ Turned off'}
            </Text>
          </Box>
          <Text dimColor>
            {s.isEnabled
              ? 'Claude may hand side tasks to helpers.'
              : 'Claude will do everything itself, in one place.'}
          </Text>
          <Box marginTop={1}>
            <Button
              key="toggle"
              variant={s.isEnabled ? 'secondary' : 'primary'}
              label={s.isEnabled ? 'Turn off' : 'Turn on'}
              onPress={async () => change($, { isEnabled: !(await getSettings($)).isEnabled })}
            />
          </Box>
        </Box>

        <Box borderStyle="round" borderColor="subtle" paddingX={1} flexDirection="column">
          <Text bold>How many at a time</Text>
          <Text dimColor>Helpers working side by side. One keeps things calm and cheap.</Text>
          <Box marginTop={1} gap={2} alignItems="center">
            <Button
              key="max-dec"
              label=" − "
              onPress={async () => change($, { maxConcurrent: (await getSettings($)).maxConcurrent - 1 })}
            />
            <Text bold color="claude">
              {String(s.maxConcurrent)}
            </Text>
            <Button
              key="max-inc"
              label=" + "
              onPress={async () => change($, { maxConcurrent: (await getSettings($)).maxConcurrent + 1 })}
            />
            <Text dimColor>of up to {String(MAX_LIMIT)}</Text>
          </Box>
        </Box>

        <Box borderStyle="round" borderColor="subtle" paddingX={1} flexDirection="column">
          <Text bold>Strongest model a helper may use</Text>
          <Text dimColor>A helper that asks for more is stepped down to this.</Text>
          <Box flexDirection="column" marginTop={1} gap={1}>
            {TIERS.map(tier => {
              const isPicked = tier === s.modelCap

              return (
                <Button key={`cap-${tier}`} onPress={() => change($, { modelCap: tier })}>
                  <Text bold={isPicked} color={isPicked ? 'claude' : undefined}>
                    {isPicked ? '● ' : '○ '}
                    {NAMES[tier]}
                  </Text>
                  <Text dimColor> ({BLURBS[tier]})</Text>
                </Button>
              )
            })}
          </Box>
        </Box>

        <Box flexDirection="column">
          <Text color={isSaved ? 'success' : 'warning'}>
            {isSaved ? '✓ Matches your saved default' : '• Changed for this session only'}
          </Text>
          <Box marginTop={1} gap={1}>
            <Button
              key="save"
              variant={isSaved ? 'secondary' : 'primary'}
              label="Save as my default"
              onPress={() => saveDefault($)}
            />
            <Button
              key="reset"
              label="Undo changes"
              dimColor={isSaved}
              onPress={async () => change($, await getSaved($))}
            />
          </Box>
        </Box>

        <Box flexDirection="column">
          <Text dimColor>
            {n === 0
              ? 'Nothing has been stopped yet this session.'
              : `Stopped ${plural(n)} from starting this session.`}
          </Text>
          <Text dimColor>Quick look-up helpers (Explore, Plan) are never limited.</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: DETAIL }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const id = await getSelected($)
    const runs = await getRuns($)
    const now = await $.clock.now()
    const r = runs.find(x => x.id === id)

    if (r === undefined) {
      return (
        <Box paddingX={1}>
          <Text dimColor>That helper is no longer in the list.</Text>
        </Box>
      )
    }

    const isRunning = r.status === 'running'
    const spent = clockText((r.endedAt ?? now) - r.startedAt)
    const shown = r.steps.slice(-40)

    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Box flexDirection="column">
          <Text bold color="claude">
            {r.label}
          </Text>
          <Text dimColor>
            {kindWords(r.type)} ({modelName(r.model)}) {'·'} {spent}
            {r.tokens === undefined ? '' : ` · ${kTokens(r.tokens)} tokens`}
          </Text>
          <Text color={isRunning ? 'claude' : r.status === 'done' ? 'success' : r.status === 'stopped' ? 'warning' : 'error'}>
            {isRunning ? '● Still working' : r.status === 'done' ? '✓ Finished' : r.status === 'stopped' ? '■ Stopped early' : '✕ Ran into a problem'}
          </Text>
        </Box>

        <Box borderStyle="round" borderColor="subtle" paddingX={1} flexDirection="column">
          <Text bold>In short</Text>
          <Text>
            {r.summary ?? (isRunning ? 'The helper is still working. Its summary appears here when it finishes.' : 'The helper did not leave a written summary.')}
          </Text>
        </Box>

        <Box borderStyle="round" borderColor="subtle" paddingX={1} flexDirection="column">
          <Text bold>What it did, step by step</Text>
          {shown.length === 0 && <Text dimColor>No steps recorded yet.</Text>}
          {shown.map((step, i) => (
            <Box key={`step-${i}`} gap={1}>
              <Text dimColor>{clockText(step.at)}</Text>
              <Text>{step.text}</Text>
            </Box>
          ))}
          {r.steps.length > shown.length && <Text dimColor>Earlier steps are not shown.</Text>}
        </Box>
      </Box>
    )
  })
}
