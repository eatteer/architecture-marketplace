// A complete aggregate root: the collection and entity-type constants, the audit actions, a private
// constructor over the props, a `create()` that audits and emits, a `reconstitute()` that does
// neither, getters that expose primitives, and a business method that guards, mutates, stamps,
// audits and emits.

import { AggregateRoot } from "@/common/domain/aggregates/aggregate-root";
import { AuditLog } from "@/common/domain/entities/audit-log.entity";
import { generateId } from "@/common/domain/utils/generate-id";
import type { Actor } from "@/common/domain/value-objects/actor";
import type { PersonName } from "@/common/domain/value-objects/person-name";
import { UserCreatedEvent, UserEmailChangedEvent } from "@/features/users/domain/events/user.events";
import { UserNotActiveError } from "@/features/users/domain/users.errors";
import type { Email } from "@/features/users/domain/value-objects/email";
import { UserStatus } from "@/features/users/domain/value-objects/user-status";

export const USER_ENTITY_COLLECTION: string = "users";
export const USER_ENTITY_TYPE: string = "user";

export const USER_AUDIT_ACTION_VALUES = ["created", "email_changed"] as const;

export type UserAuditAction = (typeof USER_AUDIT_ACTION_VALUES)[number];

export type UserProps = {
  id: string;
  email: Email;
  name: PersonName;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
};

export class User extends AggregateRoot {
  private readonly _id: string;
  private _email: Email;
  private _name: PersonName;
  private _status: UserStatus;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private _deletedAt?: Date;
  private readonly _auditLogs: AuditLog<UserAuditAction>[] = [];

  private constructor(props: UserProps) {
    super();

    this._id = props.id;
    this._email = props.email;
    this._name = props.name;
    this._status = props.status;
    this._createdAt = props.createdAt;
    this._updatedAt = props.updatedAt;
    this._deletedAt = props.deletedAt;
  }

  public static create({
    email,
    name,
    performedBy,
    now,
  }: {
    email: Email;
    name: PersonName;
    performedBy: Actor;
    now: Date;
  }): User {
    const user = new User({
      id: generateId(),
      email,
      name,
      status: UserStatus.active(),
      createdAt: now,
      updatedAt: now,
    });

    user._auditLogs.push(AuditLog.create<UserAuditAction>({ action: "created", performedBy, performedAt: now }));

    user.publishEvent(new UserCreatedEvent({ userId: user._id }, { occurredAt: now, performedBy: performedBy.id }));

    return user;
  }

  public static reconstitute(props: UserProps): User {
    return new User(props);
  }

  public get id(): string {
    return this._id;
  }

  public get email(): string {
    return this._email.value;
  }

  public get name(): string {
    return this._name.value;
  }

  public get status(): string {
    return this._status.value;
  }

  public get createdAt(): Date {
    return this._createdAt;
  }

  public get updatedAt(): Date {
    return this._updatedAt;
  }

  public get deletedAt(): Date | undefined {
    return this._deletedAt;
  }

  public get isActive(): boolean {
    return this._status.isActive && this._deletedAt === undefined;
  }

  public get auditLogs(): ReadonlyArray<AuditLog<UserAuditAction>> {
    return this._auditLogs;
  }

  public changeEmail(email: Email, performedBy: Actor, now: Date): void {
    if (this._email.equals(email)) {
      return;
    }

    if (!this.isActive) {
      throw new UserNotActiveError(this._id);
    }

    const previous = this._email.value;

    this._email = email;
    this._updatedAt = now;

    this._auditLogs.push(
      AuditLog.create<UserAuditAction>({
        action: "email_changed",
        performedBy,
        performedAt: now,
        metadata: { changes: { email: { before: previous, after: email.value } } },
      }),
    );

    this.publishEvent(
      new UserEmailChangedEvent({ userId: this._id, email: email.value }, { occurredAt: now, performedBy: performedBy.id }),
    );
  }
}
