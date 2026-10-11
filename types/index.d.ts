export type ModelCap = 'haiku' | 'sonnet' | 'opus' | 'fable'

export type GuardSettings = {
  isEnabled: boolean
  maxConcurrent: number
  modelCap: ModelCap
}

export type RunStatus = 'running' | 'done' | 'failed' | 'stopped'

/** One thing a helper did, in plain words, and when (ms after it started). */
export type Step = { text: string; at: number }

/** One helper agent's run, as the pane's activity list shows it. */
export type Run = {
  id: string
  label: string
  type: string
  model: string
  status: RunStatus
  startedAt: number
  endedAt?: number
  tools: number
  lastTool?: string
  tokens?: number
  /** Hat colour, so a helper keeps its look while it works and back in the pen. */
  hat: string
  steps: Step[]
  /** The helper's own closing report, once it has one. */
  summary?: string
}

declare module 'claude-code' {
  interface PluginState {
    'subagent-guard': {
      /** This session's live settings: the saved default plus any override. */
      settings: GuardSettings
      /** The remembered default, mirrored from `$.store` for the pane. */
      saved: GuardSettings
      /** Spawns refused so far this session. */
      blocked: number
      /** Helper agents seen this session, oldest first. */
      runs: Run[]
      /** The helper whose details are open in the detail pane. */
      selected: string | null
    }
  }
}
