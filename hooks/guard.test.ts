import { expect, mock, test } from 'claude-code/testing'

const agent = (status: string, type = 'general-purpose') => ({
  id: `a-${status}-${type}`,
  description: '',
  type,
  status,
})

test('denies a spawn while another subagent is running', async ($, on) => {
  on('agent.list', () => ({ value: [agent('running')] }) as never)
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'new' }))
  on('ui.status', () => ({ value: undefined }) as never)

  const out = await $.agent.spawn({ prompt: 'x' })

  expect(out.deny).toContain('limit reached')
})

test('allows a spawn when nothing is running and caps the model', async ($, on) => {
  let seen: string | undefined
  on('agent.list', () => ({ value: [] }) as never)
  on('agent.spawn', (_$, e) => {
    seen = e.model

    return { model: e.model ?? 'x', agentId: 'new' }
  })
  on('ui.status', () => ({ value: undefined }) as never)

  const out = await $.agent.spawn({ prompt: 'x', model: 'opus' })

  expect(out.deny).toBeUndefined()
  expect(seen).toBe('haiku')
})

test('keeps a model already at or under the cap', async ($, on) => {
  let seen: string | undefined
  on('agent.list', () => ({ value: [] }) as never)
  on('agent.spawn', (_$, e) => {
    seen = e.model

    return { model: e.model ?? 'x', agentId: 'new' }
  })
  on('ui.status', () => ({ value: undefined }) as never)

  await $.agent.spawn({ prompt: 'x', model: 'haiku' })

  expect(seen).toBe('haiku')
})

test('leaves exempt built-in types alone', async ($, on) => {
  on('agent.list', () => ({ value: [agent('running')] }) as never)
  on('agent.spawn', () => ({ model: 'opus', agentId: 'new' }))
  on('ui.status', () => ({ value: undefined }) as never)

  const out = await $.agent.spawn({ prompt: 'x', subagentType: 'Explore', model: 'opus' })

  expect(out.deny).toBeUndefined()
})

test('refuses everything when disabled', async ($, on) => {
  on('agent.list', () => ({ value: [] }) as never)
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'new' }))
  on('ui.status', () => ({ value: undefined }) as never)

  await $.command.run({ command: 'subagents', args: 'off' })
  const out = await $.agent.spawn({ prompt: 'x' })

  expect(out.deny).toContain('disabled')
})

test('max 2 admits a second subagent', async ($, on) => {
  on('agent.list', () => ({ value: [agent('running')] }) as never)
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'new' }))
  on('ui.status', () => ({ value: undefined }) as never)

  await $.command.run({ command: 'subagents', args: "max 2" })
  const out = await $.agent.spawn({ prompt: 'x' })

  expect(out.deny).toBeUndefined()
})

test('save writes the default to the store', async ($, on) => {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }) as never)

  await $.command.run({ command: 'subagents', args: 'model sonnet' })
  await $.command.run({ command: 'subagents', args: 'save' })

  const out = await $.command.run({ command: 'subagents', args: 'status' })

  expect(out.text).toContain('Saved default: 1 helper at a time, up to Sonnet')
})
