---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

Users report being signed out at random when they have the app open in two tabs. The backend rotates refresh tokens and revokes the whole family when one is reused. What is probably happening, and how should the browser handle the refresh?
