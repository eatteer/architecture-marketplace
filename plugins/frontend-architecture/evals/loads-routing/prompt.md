---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

If someone edits the URL of the orders page to ?page=abc&status=whatever, the page crashes. And changing a filter leaves them on page 3 of nothing. How should those URL parameters be handled?
