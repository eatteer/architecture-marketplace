---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

When the use case throws OrderNotFoundError the API answers 500 instead of 404. How does a domain error become an HTTP status here?
