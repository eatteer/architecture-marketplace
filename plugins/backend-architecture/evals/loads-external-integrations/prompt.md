---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

I need to call a shipping provider's HTTP API from a use case, with a timeout, and a fake provider for local development.
