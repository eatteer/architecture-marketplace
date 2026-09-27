---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

I need to add a maps API key and the base URL of our image CDN to the frontend. Where do those values go, and how does the app read them?
