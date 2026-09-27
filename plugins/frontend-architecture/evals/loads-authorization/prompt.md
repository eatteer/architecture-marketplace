---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

I want to hide the "Delete order" button from people who are not allowed to delete orders, and also stop them from opening the delete page by typing its URL. How should I do this?
