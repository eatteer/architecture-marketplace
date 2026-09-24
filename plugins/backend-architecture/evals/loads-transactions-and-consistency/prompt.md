---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

Two simultaneous requests both pass the 'at most 5 open orders' check and the account ends up with 6. How do I fix it?
