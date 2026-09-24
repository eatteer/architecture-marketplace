import type { mongo } from "mongoose";

// Runs AFTER the deploy that declares the case-insensitive name index: the ODM never drops the
// case-sensitive one it replaces. Idempotent: an index already gone is the state this wants.

const COLLECTION: string = "products";
const REPLACED_INDEX: string = "name_1";

export async function up(db: mongo.Db): Promise<void> {
  const exists = await db.collection(COLLECTION).indexExists(REPLACED_INDEX);

  if (exists) {
    await db.collection(COLLECTION).dropIndex(REPLACED_INDEX);
  }
}

// The index the previous version declared, exactly.
export async function down(db: mongo.Db): Promise<void> {
  await db
    .collection(COLLECTION)
    .createIndex({ name: 1 }, { name: REPLACED_INDEX, unique: true, partialFilterExpression: { deletedAt: null } });
}
