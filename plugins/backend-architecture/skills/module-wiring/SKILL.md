---
name: module-wiring
description: "NestJS module composition — the feature module's shape, DI tokens as `unique symbol`, binding an interface to an implementation, what a module may export, the policy for `@Global()` modules, selecting an implementation per environment with `useFactory`, provider scope and why request-scoped is contagious, lifecycle hooks, and breaking a dependency cycle between features."
when_to_use: "Trigger on — writing or editing a `*.module.ts`, registering a provider or a token, exporting something from a module, importing another feature's module, choosing between `useClass`/`useFactory`/`useValue`, a `Nest can't resolve dependencies` error, a circular import that only fails at boot, reaching for `forwardRef`, deciding whether something belongs in a global module, a shared port in `common/` with one consumer, code that must run at startup or shutdown, binding a different implementation per environment, or a variable that selects a provider's adapter."
---

# Module wiring

A module declares what a feature needs, what it provides, and what it lets others use. It is the
only file in a feature that knows about other features.

```typescript
@Module({
  imports: [MongooseModule.forFeature([{ name: UserSchema.name, schema: UserSchemaFactory }])],
  controllers: [UsersController],
  providers: [
    provideDomainErrorStatuses(USER_ERROR_STATUSES),
    { provide: USERS_REPOSITORY_TOKEN, useClass: UsersMongoRepository },
    CreateUserUseCase,
    GetUserByIdUseCase,
    UsersEventsHandlers,
  ],
  exports: [USERS_REPOSITORY_TOKEN],
})
export class UsersModule {}
```

The first provider registers the feature's domain-error-to-status list from the feature's own
module, so deleting the feature takes its entries with it; the list and the registry that collects
it belong to the `error-handling` skill.

## Tokens

Every interface is injected through a token, and every token is a `unique symbol` declared beside
the interface it identifies:

```typescript
export const USERS_REPOSITORY_TOKEN: unique symbol = Symbol("USERS_REPOSITORY_TOKEN");
```

A symbol cannot collide with another module's token the way a string can, and it cannot be produced
by accident. Declaring it next to the interface means a consumer needs one import to get both, and
the token can never drift to a different file from the contract it names.

An interface has no runtime representation, so **the token is the only thing the container can bind
to**. This is what the `@Inject(TOKEN)` in every constructor is for; injecting the concrete class
instead compiles, works, and deletes the seam.

## What a module exports

Export the **token**, so consumers receive whatever is bound to it. A **use case** goes on the list
the day another feature calls it — not before, or the list stops saying who depends on what.

Never export a concrete implementation class. A consumer that gets `UsersMongoRepository` is coupled
to the database choice of a feature it does not own, and the environment switch below stops working
for it.

Export as little as possible. Every export is a commitment: it is the part of the feature other
features are now allowed to depend on, and it cannot be changed without finding all of them.

## Global modules

`@Global()` is for infrastructure with exactly one instance that nearly every feature needs — the
database connection, the event bus, the transaction manager, the logger, password hashing.

It also fits a **shared port declared in `common/`** — file storage, the email transport — even when
a single feature consumes it today. There is one instance and no feature owns it, so making it a
feature's export would hand that feature a dependency it has no business owning, and the second
consumer would have to import a feature to reach infrastructure.

A global module's exports are available everywhere without an import, so **a feature module never
imports one**. An explicit import of a global module reads as a dependency the reader then has to
trace, and it is one more line to update when the module changes shape.

Anything that is not genuinely universal stays a normal module. `@Global()` reached for as a way to
stop a resolution error is hiding a dependency, not resolving one.

## Selecting an implementation per environment

Whether a provider gets a simulator at all, and how one must behave, belongs to the
`external-integrations` skill — most do not. When one does, the choice is bound with `useFactory`:

```typescript
{
  provide: PAYMENT_GATEWAY_TOKEN,
  inject: [ConfigService],
  useFactory: (config: ConfigService<EnvironmentVariables, true>): IPaymentGateway => {
    if (config.get("NODE_ENV", { infer: true }) === "production") {
      return new HttpPaymentGateway(config);
    }

    return new MockPaymentGateway();
  },
}
```

The switch is on `NODE_ENV` by default, not on a dedicated flag. A flag whose only purpose is to
choose a simulator is also a way to enable the simulator in production by mistake; the environment is
already the thing that decides, and it cannot be set to the wrong value without much louder
consequences.

**A selector variable is sanctioned when an environment other than production needs the real
provider** — a development or staging stack that pays through the provider's sandbox. Then which
adapter answers is a fact about that environment, and a variable naming it (`gateway` or
`simulator`) is configuration like any other, on three conditions:

- **Startup refuses the simulator in production**, in the cross-validation step, so the mistake the
  `NODE_ENV` switch guards against is a boot failure instead;
- **the real provider's settings are required only when it is selected**, and the simulator reads
  none of them (see the `configuration` skill);
- **the factory switches on the selector alone**, never on the selector and `NODE_ENV` together — two
  inputs to one decision is two places to look when it is wrong.

**Write the factory as a named function, not a closure inside the module.** The module stays a
wiring file, and the decision becomes something a test can call — which matters, because a provider
bound to one implementation unconditionally is invisible: everything works, in every environment,
until the environment where it is wrong.

```typescript
// payments.module.ts
{ provide: PAYMENT_GATEWAY_TOKEN, useFactory: createPaymentGateway, inject: [ConfigService] }
```

Consumers inject the token and never learn which side answered. The port belongs to the
`application-layer` skill.

## Provider scope

Providers are singletons. Keep them that way.

A request-scoped provider forces every provider that injects it to become request-scoped too, and
then everything that injects *those* — the scope spreads up the whole graph until the container is
instantiating a tree per request. Anything that starts as "just this one service needs the current
request" ends as a measurable throughput cost.

When code deep in the graph needs per-request data, read it from an ambient request context backed
by async local storage rather than injecting the request. The context and its middleware belong to
the `observability` skill.

## Lifecycle hooks

- `OnModuleInit` for work that must happen once the container is built — registering handlers,
  warming a cache, validating that an external dependency answers.
- `OnApplicationShutdown` for releasing what the process holds.

A hook that throws fails the boot. That is usually correct: a process that starts without a
dependency it needs will fail later, further from the cause, on a user's request instead of in the
deploy log.

Shutdown hooks only run if they are enabled on the application; see the `project-bootstrap` skill.

## Cycles

Two features that each need the other are telling you there is a third concept neither of them owns.
The fix is to find that concept and give it a home.

Work through it in this order:

1. **Is one direction only a read?** Then it does not need the module at all — it needs the data,
   which can be passed in by the caller that already has it.
2. **Is the shared thing a concept?** Extract it. A rule that both features consult is a policy or a
   value object that belongs to neither of them.
3. **Is one direction actually an event?** A feature that needs to *react* to another does not
   depend on it; it subscribes. See the `event-driven` skill — this is the resolution that fits most
   cycles, because the dependency was never really there.

A lazy forward reference makes the container boot with the cycle still in place. It converts a
design problem into an initialization-order problem, which is strictly worse: it fails later, only
sometimes, and the error names the container rather than the two features that are tangled.

## Checklist

- [ ] Every interface is bound through a `unique symbol` token declared beside it.
- [ ] No module exports a concrete implementation class, and every exported use case is called by
      another feature.
- [ ] Every feature module provides its own domain-error status list.
- [ ] No feature module imports a global module, and every `@Global()` module is universal
      infrastructure or a shared port declared in `common/`.
- [ ] Every environment-dependent provider switches inside `useFactory`, written as a named
      function, on `NODE_ENV` — or on a selector variable only where a non-production environment
      needs the real provider, with the simulator refused in production at startup.
- [ ] No provider is request-scoped.
- [ ] No module pair depends on each other in both directions.
