# The concurrency guard

The code behind "Serializing a rule with no unique key" in the `transactions-and-consistency`
skill: a port in the shared domain, one small collection, and the repository method that writes it.
Write it with the first rule that needs it.

```typescript
export const CONCURRENCY_GUARD_REPOSITORY_TOKEN: unique symbol = Symbol("CONCURRENCY_GUARD_REPOSITORY_TOKEN");

export interface IConcurrencyGuardRepository {
  // First inside the unit of work, so the conflict is detected before the work rather than after it.
  touch(scope: string, key: string, now: Date, transaction: Transaction): Promise<void>;
}
```

```typescript
@Schema({ collection: CONCURRENCY_GUARD_COLLECTION, timestamps: false, versionKey: false, _id: false })
export class ConcurrencyGuardSchema {
  // `<scope>:<key>` — one document per protected thing.
  @Prop({ required: true })
  public _id!: string;

  @Prop({ required: true })
  public touchedAt!: Date;
}
```

```typescript
public async touch(scope: string, key: string, now: Date, transaction: Transaction): Promise<void> {
  // An upsert rather than a read: the write is the whole point. Two transactions upserting the same
  // _id conflict, which is exactly the serialization being bought.
  await this._concurrencyGuardModel
    .findOneAndUpdate(
      { _id: `${scope}:${key}` },
      { $set: { touchedAt: now } },
      { upsert: true, session: sessionOf(transaction) },
    )
    .exec();
}
```
