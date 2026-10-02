---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

The settings menu has a light/dark/system picker. Switching should animate out from the button the user clicked, and "system" has to follow the OS if it changes while the tab is open. How should I wire that up?
