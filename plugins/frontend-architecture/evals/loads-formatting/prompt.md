---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

I need to show product prices that arrive from the API as `{ amountMinor: "1999", currency: "JPY" }`, plus the date each product was created. Right now I divide by 100 and call toLocaleDateString. Is that ok?
