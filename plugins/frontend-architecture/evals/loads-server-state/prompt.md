---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

After deleting an order, the orders list keeps showing it until I reload the page. How should the delete be wired so every affected screen updates?
