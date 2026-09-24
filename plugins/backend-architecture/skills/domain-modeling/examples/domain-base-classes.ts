// The shared base classes every aggregate builds on. In a project each one is its own file in the
// shared domain folder (`common/domain/`); they are together here so one read shows all four.

import { v7 as uuidv7 } from "uuid";

export function generateId(): string {
  return uuidv7();
}

export type DomainEventMeta = {
  occurredAt: Date;
  performedBy?: string;
};

export abstract class DomainEvent {
  public readonly id: string;
  public readonly occurredAt: Date;
  public readonly performedBy?: string;

  public constructor({ occurredAt, performedBy }: DomainEventMeta) {
    this.id = generateId();
    this.occurredAt = occurredAt;
    this.performedBy = performedBy;
  }
}

export abstract class AggregateRoot {
  private _events: DomainEvent[] = [];

  protected publishEvent(event: DomainEvent): void {
    this._events.push(event);
  }

  public getEvents(): DomainEvent[] {
    const events = [...this._events];

    this._events = [];

    return events;
  }
}

export class DomainError extends Error {
  public constructor(
    public readonly message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}
