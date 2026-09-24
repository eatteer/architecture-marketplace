---
tags: [agent]
runs: 1
max_turns: 12
timeout_seconds: 420
allowed_tools: [Agent, Skill, Read, Glob, Grep]
append_system_prompt: "Do not create or edit files."
---

Have the convention reviewer check this file from our NestJS backend before I commit it, and tell me what it found:

```typescript
export enum OrderStatus {
  Pending = "pending",
  Settled = "settled",
}

export class OrderTotals {
  public static sum(amounts: any[]): number {
    console.log("summing", amounts.length);
    return amounts.reduce((total, amount) => total + amount, 0);
  }
}
```
