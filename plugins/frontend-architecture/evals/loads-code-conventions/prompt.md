---
tags: [trigger]
runs: 1
max_turns: 6
timeout_seconds: 240
allowed_tools: [Skill, Read, Glob, Grep]
append_system_prompt: "Answer in a few paragraphs at most. Do not create or edit files."
---

In our React components, is it fine to wrap this click handler in useCallback and the filtered list in useMemo, or is there a reason not to?
