---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

React warns "A component is changing an uncontrolled input to be controlled" on our edit profile form. What causes it, and how should the form be set up so it never happens?
