---
tags: [agent]
runs: 1
max_turns: 12
timeout_seconds: 420
allowed_tools: [Agent, Skill, Read, Glob, Grep]
append_system_prompt: "Do not create or edit files."
---

Have the convention reviewer check this component from our React app before I commit it, and tell me what it found:

```tsx
import { useMemo } from "react";

export enum OrderStatus {
  Pending = "pending",
  Settled = "settled",
}

export default function OrderTotal({ amounts }: { amounts: any[] }) {
  console.log("rendering", amounts.length);
  const total = useMemo(() => amounts.reduce((sum, amount) => sum + amount, 0), [amounts]);
  return <span>{total}</span>;
}
```
