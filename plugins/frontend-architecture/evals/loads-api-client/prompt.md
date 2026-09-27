---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

The backend renamed a field in one of its responses, and the frontend still compiles and just shows undefined on screen. How are we supposed to keep the frontend's types in sync with the API?
