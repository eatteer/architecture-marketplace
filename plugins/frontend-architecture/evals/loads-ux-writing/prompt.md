---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

Our delete dialog says "Are you sure?" with "Yes" and "No" buttons, and after deleting we show a toast that says "Success!". How should those texts read instead?
