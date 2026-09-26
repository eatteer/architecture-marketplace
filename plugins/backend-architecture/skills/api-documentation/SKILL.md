---
name: api-documentation
description: "The generated OpenAPI document — `@Api*` decorators on DTOs and controllers, documenting the success envelope and the Problem Details body with `ApiDataResponse`, `ApiPaginatedResponse` and `ApiProblemResponse`, declaring both security schemes by named constant, an operator API-key header, tag groups, operation ids and their factory, documenting a restriction a guard enforces, and controlling who can reach the docs endpoint."
when_to_use: "Trigger on — adding `@ApiProperty`, `@ApiPropertyOptional`, `@ApiOperation`, `@ApiResponse`, `@ApiTags`, `@ApiBearerAuth`, `@ApiCookieAuth` or `@ApiHeader`, setting `operationIdFactory`, documenting what an endpoint returns or how it fails, editing the docs setup, a field missing from the generated schema, a documented response that is not what the endpoint sends, a generated client reading fields one level too shallow, a nullable field a generated client types as an empty object, an endpoint appearing without a tag or in no group, a generated client with colliding method names, or exposing the documentation endpoint in an environment."
---

# API documentation

This skill owns every `@Api*` decorator. Other skills show one only where the DTO's shape needs it —
a response DTO is a class because of them — so each example can show the pattern it is about without
the noise.

## DTOs

Every property on a request or response DTO is annotated, or it does not appear in the generated
schema at all — the decorators are the only source, since TypeScript types are erased:

```typescript
export class CreateUserDTO {
  @ApiProperty({ example: "jane@example.com" })
  @IsEmail({}, { message: i18nValidationMessage("users.create_user.email_invalid") })
  public email!: string;

  @ApiPropertyOptional({ enum: LANGUAGE_VALUES })
  @IsOptional()
  @IsIn(LANGUAGE_VALUES, { message: i18nValidationMessage("common.validation.enum") })
  public preferredLanguage?: string;
}
```

- `@ApiPropertyOptional` for anything optional; `@ApiProperty` marks it required, and a mismatch
  with the validator produces a document that contradicts the code.
- A nullable property names its `type:` beside `nullable: true` (`type: String`, `type: Number`).
  The decorator reads the type from the compiler's metadata, which records a `string | null` union
  as `Object`, so without it the document declares an empty object and a generated client types the
  field as `Record<string, never> | null`.
- `enum:` takes the domain's `const` array — the same array the validator uses, so the documented
  values cannot drift from the accepted ones.
- An `example` on anything whose format is not obvious from its name. It is what the reader copies
  into their first request.
- No `default:` for a value the server fills from configuration — the default language, say. It is
  applied when the record is created and differs per deployment, so a constant in the document is a
  claim that is wrong somewhere.

## Controllers

```typescript
@ApiTags("Users")
@ApiBearerAuth(BEARER_SECURITY_SCHEME)
@ApiCookieAuth(COOKIE_SECURITY_SCHEME)
@ApiProblemResponse(HttpStatus.UNAUTHORIZED, "No valid credentials were presented")
@ApiProblemResponse(HttpStatus.FORBIDDEN, "Missing the required permission")
@Controller("users")
export class UsersController {
  @ApiOperation({ summary: "Create a user", description: "Requires the `users:create` permission." })
  @ApiDataResponse(CreatedDTO, { status: HttpStatus.CREATED, description: "User created" })
  @ApiProblemResponse(HttpStatus.BAD_REQUEST, "The body is not valid")
  @ApiProblemResponse(HttpStatus.CONFLICT, "The email is already registered")
  @Post()
  public async createUser(/* ... */): Promise<DataResponse<CreatedDTO>> { /* ... */ }

  @ApiOperation({ summary: "Delete a user", description: "Requires the `users:delete` permission." })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: "User deleted" })
  @ApiProblemResponse(HttpStatus.NOT_FOUND, "No user matches the id")
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  public async deleteUser(/* ... */): Promise<void> { /* ... */ }
}
```

- **Both security schemes are declared** on any authenticated route. A route that only advertises
  the bearer scheme tells a browser client it cannot authenticate, and vice versa; the API accepts
  both (see the `authentication` skill).
- **A scheme's name is a named constant**, shared by the docs setup that declares it and the
  controllers that reference it. The name is a string nothing type-checks: misspelled on a
  controller, it points at a scheme that does not exist and the viewer offers no way to
  authenticate. The cookie scheme takes its cookie name from the auth cookie's own constant, for the
  same reason:

  ```typescript
  export const BEARER_SECURITY_SCHEME: string = "bearer";
  export const COOKIE_SECURITY_SCHEME: string = "cookie";

  const config = new DocumentBuilder()
    .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" }, BEARER_SECURITY_SCHEME)
    .addCookieAuth(ACCESS_TOKEN_COOKIE, { type: "apiKey", in: "cookie" }, COOKIE_SECURITY_SCHEME)
    .build();
  ```

- **An operator endpoint authenticated by an API-key header is documented with `@ApiHeader`**, not
  a security scheme, and its `description` states that only the key opens it. A scheme would put
  the key field on every route in the viewer, for a credential that opens one:

  ```typescript
  @ApiOperation({
    summary: "Run the expired-token prune now",
    description: "Requires the operator key; no role grants it.",
  })
  @ApiHeader({ name: ADMIN_API_KEY_HEADER, required: true, description: "Operator key" })
  @ApiProblemResponse(HttpStatus.UNAUTHORIZED, "The operator key is missing or wrong")
  ```

- **Document the failures that are part of the contract** — the conflict, the not-found, the
  permission denial. A client writes its error handling from this list, and an undocumented 409
  becomes an unhandled case in every consumer.
- **A failure every route on the controller shares is declared once, on the class.** The 401 and 403
  that come from the guards are the same for all of them, and `@ApiResponse` applies to every
  operation when it sits on the controller. Copied per route it is noise, and noise is how five of
  six routes end up documented and the sixth does not.
- **`summary` is a sentence, in sentence case**, describing what the endpoint does rather than
  restating its verb and path.

## What an endpoint returns

The document describes the body the endpoint sends, which is the DTO **inside** the envelope. An
`@ApiResponse({ type: UserDTO })` documents a body no endpoint returns, and every client generated
from it reads the user's fields off the envelope — one level too shallow, on every call. Three
decorators, applied through `applyDecorators`, are the only way a response is documented:

```typescript
export function ApiDataResponse(model: Type<unknown>, options: EnvelopeOptions): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status: options.status ?? HttpStatus.OK,
      description: options.description,
      schema: { type: "object", required: ["data"], properties: { data: { $ref: getSchemaPath(model) } } },
    }),
  );
}
```

- **`ApiDataResponse(dto, …)`** — `{ data }`, the DTO referenced with `getSchemaPath`.
- **`ApiPaginatedResponse(dto, …)`** — `{ data: dto[], pagination }`, with the pagination schema
  referenced the same way.
- **`ApiProblemResponse(status, description)`** — the Problem Details schema under
  `application/problem+json`, which is the media type the filter sends. Documented under
  `application/json`, it is a content type the endpoint never answers with.
- **A 204 is a plain `@ApiResponse` with a status and no schema** — there is no body to describe.
- **A health route's 200 is a plain `@ApiResponse` too.** It answers the health library's own body,
  outside the envelope (see `presentation-layer`), so an envelope decorator would document a body
  it never sends.

`ApiExtraModels` inside each decorator is what puts the referenced schema in the document at all:
`getSchemaPath` only writes a `$ref`, and a model nothing else mentions is a reference to nothing.

**Check the output, not the decorators.** Fetch the generated JSON and compare one real response of
each shape against it — a list, a single resource, a validation failure. A decorator that looks
right and a schema that says something else are only caught there.

## Tags and groups

Each controller carries exactly one tag. Two controllers sharing a tag merge in the navigation, and
a controller with two tags appears twice.

**Grouping tags is optional and is not an OpenAPI concept.** `x-tagGroups` is a vendor extension
that some viewers render and others ignore, so it is worth adding when the document has enough tags
to need a second level of navigation — and worth leaving out until then. What must not happen is
half of them grouped: a tag in no group renders outside the navigation of a viewer that honors the
extension, where nobody finds it. Group all of them or none, and when they are grouped, adding a
controller means adding its tag to a group in the same change.

## Operation ids

An operation id equals the controller method name only because the docs setup says so — the
framework's default is `Controller_method`:

```typescript
const document = SwaggerModule.createDocument(app, config, {
  operationIdFactory: (_controllerKey: string, methodKey: string): string => methodKey,
});
```

Generated clients turn operation ids into their method names, and the bare method name is the one a
reader would write — which is why **controller method names are unique application-wide**, not just
within a controller. Three controllers each with a `create` produce three identical operation ids,
and which one a generated client keeps depends on the generator.

## Documenting what a guard enforces

A guard is invisible to the generator: an endpoint restricted to one permission, one environment, or
one kind of caller still appears in the document exactly like any other. Whoever reads it will try
it and get a rejection they cannot explain.

State the restriction in the operation's `description` — on a permission-guarded route, the
permission it requires. It is the only place the reader can learn it
short of reading the source.

## Reaching the documentation

Docs exposure is decided by an explicit allowlist, not by the environment: a staging deployment
usually needs them and production sometimes does. The allowlist variable is required like any other,
and an **empty** value disables the endpoint entirely — a declared "off", not a missing setting (see
`configuration`).

A request that is not allowed gets **404, not 403** — the same rule as any hidden route (see the
`presentation-layer` skill). A 403 confirms the documentation is there and invites a second attempt.

## Checklist

- [ ] Every DTO property carries `@ApiProperty` or `@ApiPropertyOptional`, matching its validator.
- [ ] Every nullable property declares its `type:`.
- [ ] Every documented enum references the domain's `const` array.
- [ ] Every controller has exactly one tag; if tags are grouped, every tag is in exactly one group.
- [ ] Every authenticated route declares both security schemes, by their named constants.
- [ ] Every operator endpoint behind an API-key header declares it with `@ApiHeader`.
- [ ] Every success is documented with `ApiDataResponse` or `ApiPaginatedResponse`, and every 204
      and every health 200 with a plain `@ApiResponse`; no response is documented as a bare DTO.
- [ ] Every failure that is part of the contract has an `ApiProblemResponse`, and the ones shared by
      the whole controller are declared on the class rather than per route.
- [ ] Every controller method name is unique across the application, and the docs setup's
      `operationIdFactory` returns the method name.
- [ ] Every guard-enforced restriction is stated in the operation description.
- [ ] The docs endpoint answers 404 when it is not allowed.
