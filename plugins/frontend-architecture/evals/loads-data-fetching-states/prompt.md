---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

Our order detail page jumps around when its data arrives, and the component is full of `order?.total ?? 0`. What is the right way to render it while it loads?
