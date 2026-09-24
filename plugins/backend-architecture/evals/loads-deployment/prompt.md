---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

Write the Dockerfile for this NestJS app. Right now `npm ci --omit=dev` fails with exit code 127 because husky is not installed.
