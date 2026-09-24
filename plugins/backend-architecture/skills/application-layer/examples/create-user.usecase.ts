// The canonical use case: construct the value objects, read the clock, open the unit of work, load,
// guard, mutate, save, close, then publish.

import { Inject, Injectable } from "@nestjs/common";

import { EVENT_BUS_TOKEN } from "@/common/application/events/event-bus.interface";
import type { IEventBus } from "@/common/application/events/event-bus.interface";
import { TRANSACTION_MANAGER_TOKEN } from "@/common/application/persistence/transaction-manager.interface";
import type { ITransactionManager } from "@/common/application/persistence/transaction-manager.interface";
import { CLOCK_TOKEN } from "@/common/application/time/clock.interface";
import type { IClock } from "@/common/application/time/clock.interface";
import type { Transaction } from "@/common/domain/utils/transaction";
import { PersonName } from "@/common/domain/value-objects/person-name";
import type { CreateUserCommand } from "@/features/users/application/commands/create-user.command";
import { User } from "@/features/users/domain/entities/user.entity";
import { USERS_REPOSITORY_TOKEN } from "@/features/users/domain/repositories/users.repository";
import type { IUserRepository } from "@/features/users/domain/repositories/users.repository";
import { EmailAlreadyRegisteredError } from "@/features/users/domain/users.errors";
import { Email } from "@/features/users/domain/value-objects/email";

/**
 * @throws {EmailAlreadyRegisteredError} If another user already holds the email
 */
@Injectable()
export class CreateUserUseCase {
  public constructor(
    @Inject(USERS_REPOSITORY_TOKEN)
    private readonly _usersRepository: IUserRepository,
    @Inject(TRANSACTION_MANAGER_TOKEN)
    private readonly _transactionManager: ITransactionManager,
    @Inject(EVENT_BUS_TOKEN)
    private readonly _eventBus: IEventBus,
    @Inject(CLOCK_TOKEN)
    private readonly _clock: IClock,
  ) {}

  public async execute(command: CreateUserCommand): Promise<string> {
    const email = Email.create(command.email);
    const name = PersonName.create(command.name);

    const now = this._clock.now();

    const user = await this._transactionManager.run(
      async (transaction: Transaction): Promise<User> => {
        const existing = await this._usersRepository.getByEmail(email, transaction);

        if (existing) {
          throw new EmailAlreadyRegisteredError(email.value);
        }

        const created = User.create({ email, name, performedBy: command.performedBy, now });

        await this._usersRepository.save(created, transaction);

        return created;
      },
    );

    this._eventBus.publish(user.getEvents());

    return user.id;
  }
}
