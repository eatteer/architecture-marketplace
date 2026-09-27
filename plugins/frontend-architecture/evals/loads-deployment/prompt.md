---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

After deploying the SPA behind nginx, reloading /orders/42 gives a 404, and some users keep seeing the old version after a release. How should the server be configured?
