# Helper Agent Safeguard (`subagent-guard`)

A Claude Code mod that keeps helper agents (subagents) from running up your usage.

- Caps how many helpers run at once (default 1) and the strongest model they may use (default Haiku).
- A side pane shows the crab "pen", live activity for each helper, and a plain-language
  "what it did" view. Open it any time with `/subagents`.
- `/subagents [status | on | off | max <1-8> | model <haiku|sonnet|opus|fable> | save | reset]`

Explore, Plan, statusline-setup and claude-code-guide helpers are never limited.

## Install (once per device, from a terminal)

```
/plugin install subagent-guard --marketplace <owner>/subagent-guard
```

Answer `y` to add the marketplace, then pick the user scope. It then loads in every new
session on that device, including the desktop app's Code tab. Your saved default is
kept per device.

## Develop

`claude plugin validate .` then `claude plugin test .`
