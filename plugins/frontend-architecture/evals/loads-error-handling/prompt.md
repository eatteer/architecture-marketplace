---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

When saving fails, sometimes the user sees nothing at all and other times two toasts appear for the same failure. What should decide how a failure is shown to the user?
