---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

The Next button of our orders table stays enabled on the last page, and I compute the page count myself. How should the table and its paging controls work against the backend's paginated endpoint?
