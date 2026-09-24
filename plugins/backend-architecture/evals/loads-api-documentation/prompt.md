---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

The generated OpenAPI document shows POST /orders returning the DTO directly, but the endpoint really answers { data: ... }. How do I document the real response shape?
