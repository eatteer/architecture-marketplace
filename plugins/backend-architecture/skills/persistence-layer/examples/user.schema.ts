// A persistence schema: identity minted by the domain, timestamps as domain state, no version key,
// enumerable fields constrained by the domain's array, an explicit `type:` on every union, and the
// indexes its queries and its uniqueness rule need.

import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";

import { USER_ENTITY_COLLECTION } from "@/features/users/domain/entities/user.entity";
import { ACTIVE_STATUS_VALUE, USER_STATUS_VALUES } from "@/features/users/domain/value-objects/user-status";

import type { HydratedDocument, Schema as MongooseSchema } from "mongoose";

export type UserDocument = HydratedDocument<UserSchema>;

@Schema({ collection: USER_ENTITY_COLLECTION, timestamps: false, versionKey: false, _id: false })
export class UserSchema {
  @Prop({ required: true })
  public _id!: string;

  @Prop({ required: true })
  public email!: string;

  @Prop({ required: true })
  public name!: string;

  @Prop({ required: true, enum: USER_STATUS_VALUES, default: ACTIVE_STATUS_VALUE })
  public status!: string;

  @Prop({ required: true })
  public createdAt!: Date;

  @Prop({ required: true })
  public updatedAt!: Date;

  @Prop({ type: Date, default: null })
  public deletedAt!: Date | null;
}

export const UserSchemaFactory: MongooseSchema<UserSchema> = SchemaFactory.createForClass(UserSchema);

// Partial, so a soft-deleted user releases its email.
UserSchemaFactory.index({ email: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });

// The default listing: equality filter, sort field, tiebreaker.
UserSchemaFactory.index({ deletedAt: 1, createdAt: -1, _id: -1 });
