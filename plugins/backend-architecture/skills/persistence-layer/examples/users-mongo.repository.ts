// A repository implementation: a load skips soft-deleted documents, every call takes the unit of
// work's session, documents go through the persistence mapper, and `save()` upserts the whole
// aggregate, translates the duplicate key it can cause into a domain error, and writes the pending
// audit entries in the same unit of work.

import { Inject, Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

import { AUDIT_LOG_REPOSITORY_TOKEN } from "@/common/domain/repositories/audit-log.repository";
import type { IAuditLogRepository } from "@/common/domain/repositories/audit-log.repository";
import type { Transaction } from "@/common/domain/utils/transaction";
import { isDuplicateKeyOn } from "@/common/infrastructure/persistence/mongodb/duplicate-key";
import { sessionOf } from "@/common/infrastructure/persistence/mongodb/mongo-transaction";
import { USER_ENTITY_COLLECTION, USER_ENTITY_TYPE } from "@/features/users/domain/entities/user.entity";
import type { User } from "@/features/users/domain/entities/user.entity";
import type { IUserRepository } from "@/features/users/domain/repositories/users.repository";
import { EmailAlreadyRegisteredError } from "@/features/users/domain/users.errors";
import { UserPersistenceMapper } from "@/features/users/infrastructure/persistence/mongodb/mappers/user.persistence-mapper";
import { UserSchema } from "@/features/users/infrastructure/persistence/mongodb/schemas/user.schema";

@Injectable()
export class UsersMongoRepository implements IUserRepository {
  public constructor(
    @InjectModel(UserSchema.name)
    private readonly _userModel: Model<UserSchema>,
    @Inject(AUDIT_LOG_REPOSITORY_TOKEN)
    private readonly _auditLogRepository: IAuditLogRepository,
  ) {}

  public async getById(id: string, transaction?: Transaction): Promise<User | undefined> {
    const document = await this._userModel
      .findOne({ _id: id, deletedAt: null })
      .session(sessionOf(transaction))
      .lean<UserSchema>()
      .exec();

    if (!document) {
      return undefined;
    }

    return UserPersistenceMapper.toDomain(document);
  }

  public async save(user: User, transaction?: Transaction): Promise<void> {
    const document = UserPersistenceMapper.toPersistence(user);

    try {
      await this._userModel
        .findOneAndUpdate({ _id: user.id }, document, { upsert: true, session: sessionOf(transaction) })
        .exec();
    } catch (error: unknown) {
      if (isDuplicateKeyOn(error, "email")) {
        throw new EmailAlreadyRegisteredError(user.email);
      }

      throw error;
    }

    if (user.auditLogs.length > 0) {
      await this._auditLogRepository.save(
        USER_ENTITY_COLLECTION,
        USER_ENTITY_TYPE,
        user.id,
        user.auditLogs,
        transaction,
      );
    }
  }
}
