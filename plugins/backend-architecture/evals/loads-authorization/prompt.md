---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

A signed-in user can read another account's invoice just by guessing its id. How should the access check work?
