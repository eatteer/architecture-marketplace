---
name: background-jobs
description: "Work that runs without a request — scheduled jobs and why a schedule needs a lock once there is more than one replica, taking and releasing that lock safely, overlapping runs, jobs as thin callers of use cases, retries with backoff and a dead-letter destination, making a job resumable and idempotent, batching over large collections, and the reconciliation sweep that finishes work an event handler missed."
when_to_use: "Trigger on — adding a scheduled or cron job, a job that ran twice or produced duplicate records after scaling out, a job still running when the next run starts, a job that never runs again after a process died holding its lock, a long job that fails halfway and cannot be re-run, retrying failed work, moving repeatedly failing work aside, or sweeping records left in an intermediate state."
---

# Background jobs

Work with no request behind it: schedules, queue consumers, sweeps. Everything here assumes the
process runs more than once, because eventually it does.

## A schedule is not a lock

A scheduled handler fires **on every replica**. Two instances means the job runs twice, at the same
moment, with the same inputs — and the symptom is duplicated records, doubled emails, or a counter
incremented twice, appearing the day the service was scaled out and correlating with nothing in the
code.

So every scheduled job takes a lock first:

```typescript
@Cron(CronExpression.EVERY_HOUR)
public async settleExpiredOrders(): Promise<void> {
  await this.runSettleExpiredOrders();
}

public async runSettleExpiredOrders(): Promise<void> {
  await this._context.run(
    {
      method: "JOB",
      path: SETTLE_EXPIRED_ORDERS_JOB,
      traceId: generateTraceId(),
      agent: {},
      principal: Actor.system(),
    },
    async (): Promise<void> => await this._settle(),
  );
}

private async _settle(): Promise<void> {
  const lock = await this._locks.acquire(SETTLE_EXPIRED_ORDERS_JOB, LOCK_TTL_MS, this._clock.now());

  if (!lock) {
    return;
  }

  try {
    await this._settleExpiredOrders.execute(new SettleExpiredOrdersCommand({ performedBy: Actor.system() }));
  } catch (error: unknown) {
    this._logger.error({ message: "Scheduled settlement failed", job: SETTLE_EXPIRED_ORDERS_JOB, err: error });
  } finally {
    await this._locks.release(lock);
  }
}
```

The `@Cron` method only delegates. The public `run…()` method is the job: it opens the job's own
request context, with a fresh trace id, so every line the run writes can be followed from first to
last (the `observability` skill owns the context's shape); an operator endpoint and a test call it
without waiting for the schedule. The `catch` is there because a schedule has nobody to report to —
a failure it does not log is one nobody learns about (the `error-handling` skill owns the rule).

- **The lock is a document keyed by the job's name, with an expiry and a token**, and the uniqueness
  of that key is the mutual exclusion — not a read-then-write check (see the
  `transactions-and-consistency` skill).
- **Acquiring is a conditional upsert on `expiresAt <= now`.** An expired lock matches the filter
  and is taken over in the same write; a live one matches nothing, so the upsert's insert collides
  on the unique key, and that duplicate key is the loss. A plain insert cannot take over: the
  expired document is still there, and the job never runs again until somebody deletes it by hand.
  `now` is the clock port's reading, passed in.
- **The expiry is not optional.** A process that dies holding a lock without one blocks the job
  forever, and nobody notices until somebody asks why a report stopped updating.
- **The expiry comfortably exceeds the job's longest run**, or the lock expires mid-run and a second
  instance starts the same work alongside the first. A ceiling on the batches one run processes is
  what makes "longest run" a number (see below).
- **Release in a `finally`, by the holder's token.** A job that throws must not keep the lock for
  its full expiry. Each acquisition writes a fresh token and the release deletes only the document
  that carries it: a run that outlived its expiry no longer holds the lock, and releasing by name
  alone would delete the lock a second run now holds.

The loser does nothing and says nothing. A replica that did not win the lock is the normal case, not
a warning.

## Overlapping runs

A job scheduled every minute that sometimes takes three is running three copies of itself. The lock
prevents that across replicas and within one, which is the second reason it is not optional.

If the work genuinely cannot keep up, the interval is wrong or the work needs partitioning — not a
longer timeout.

## A job is a thin caller

The job opens its context, acquires the lock, calls one use case, and releases. The work lives in
the use case, where it can be tested without a lock or a schedule around it.

The actor is `Actor.system()` — there is no request and nobody clicked anything (see the
`application-layer` skill).

## Retries

A failure that might succeed on a second attempt is retried; one that cannot is not.

- **Retry a transient failure**: a timeout, a connection reset, a dependency answering 5xx or 429.
- **Do not retry a permanent one**: a validation failure, a 4xx that is not 429, a domain rule
  refusing. Retrying it burns the budget and delays the moment somebody learns it is broken.
- **Back off exponentially, with jitter.** A fixed interval turns a brief outage into a synchronized
  stampede the moment the dependency recovers.
- **Cap the attempts.** After the cap, the item goes to a dead-letter destination with the reason
  and the payload — visible, inspectable, and re-runnable once the cause is fixed.

A dead-letter destination nobody looks at is a queue where work goes to be forgotten. Its depth is
one of the few numbers worth alerting on.

## Resumable and idempotent

Any job long enough to be interrupted will be interrupted — by a deploy, a restart, a timeout.

- **Process in batches, and let the filter be the progress.** The default is a filter the
  processed items stop matching, re-read from the first page each time: whatever is left is the next
  batch, and a re-run resumes by construction. Stop when a page is empty, and when a full page
  changes nothing — or that page is read forever.
- **A cursor is the alternative when items do not leave the filter** — an export, a recomputation.
  Page on the sort key and `_id`, and record the last key reached so a re-run resumes rather than
  restarting.
- **Cap the batches one run processes.** When the cap is reached the run returns, and what is left
  waits for the next one. Without it a backlog keeps one run going past its lock's expiry, and the
  second instance the lock exists to prevent starts alongside it.
- **Make each item's work idempotent**, because the batch that was in flight when the process died
  gets processed again. Both shapes that achieve it belong to the `transactions-and-consistency`
  skill.
- **One transaction per item**, not one around the batch, and the item is read again inside it (see
  the `transactions-and-consistency` skill). A transaction around ten thousand items holds for
  minutes, conflicts with everything, and rolls back all of them for one bad row.
- **Log the counts** — read, processed, skipped, failed. A job that logs only "done" cannot be
  distinguished from one that found nothing to do.

## Reconciliation sweeps

What a sweep is for, and which consequences are owed one, is the `transactions-and-consistency`
skill's. As a job it gets the same treatment as any other — a lock, capped batches, idempotent
items — and it logs the count it finds, which is the number that concept is watched by.

## Checklist

- [ ] Every scheduled job acquires a lock before doing anything.
- [ ] Every lock has an expiry longer than the job's longest run, and is released in a `finally`
      by the token its acquisition wrote.
- [ ] Acquiring a lock is a conditional upsert that takes over a document whose `expiresAt <= now`.
- [ ] A replica that does not win the lock exits quietly.
- [ ] The `@Cron` method delegates to a public `run…()` method that opens the job's own trace
      context; the work is one use case, and a failure is caught and logged with `err`.
- [ ] The actor is `Actor.system()`.
- [ ] Only transient failures are retried, with exponential backoff and jitter.
- [ ] Retries are capped and exhausted work lands somewhere visible.
- [ ] Long jobs run in batches — the first page of a filter processed items leave, or a cursor when
      they do not — with a ceiling on batches per run, one transaction per item, and idempotent
      item work.
- [ ] Every job logs counts, not just completion.
- [ ] Every reconciliation sweep runs as a locked job with capped batches and logs the count it
      finds.
