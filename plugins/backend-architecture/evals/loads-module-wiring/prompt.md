---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

Nest fails to boot with "Nest can't resolve dependencies of CreateOrderUseCase" after I added a repository. How should the provider be registered and exported?
