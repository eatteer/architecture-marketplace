---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

We need to show product descriptions that the API returns as HTML written in a rich text editor. Is dangerouslySetInnerHTML ok for that?
