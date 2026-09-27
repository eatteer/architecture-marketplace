---
tags: [negative]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

In PostgreSQL, when does a composite index on (tenant_id, created_at) help a query, and when does it not?
