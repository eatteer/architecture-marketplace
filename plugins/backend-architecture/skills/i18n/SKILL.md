---
name: i18n
description: "Translated text leaving the backend — the translation file layout per feature namespace, the translated title and detail of a failure, resolving the language of a request, resolving the language of a notification from the recipient rather than the sender, which validator takes a shared key and which a per-operation one, notification copy, domain error codes as translation keys, and keeping every key present in every configured locale."
when_to_use: "Trigger on — adding or editing a translation file, adding a locale, translating the title or detail of a failure, wiring `i18nValidationMessage` on a validator, a validation message naming the property in code form, translating a domain error, an error that renders its key instead of a sentence, an email or notification that arrived in the wrong language, emails that switched language after the user signed in from another browser, letting a user change the language of their own account, adding a new feature's translation namespace, or adding a member to a value union that has user-visible labels."
---

# Internationalization

## Layout

One folder per locale, one file per feature namespace, plus a shared one:

```text
src/i18n/
├── en/
│   ├── common.json
│   ├── users.json
│   └── orders.json
└── es/
    ├── common.json
    ├── users.json
    └── orders.json
```

The namespace matches the feature, so a domain error code is already a translation key:
`users.user_not_found` resolves to `users.json` → `user_not_found`. Nothing has to be mapped, and a
key that fails to resolve tells you immediately which file is missing it.

`common.json` holds what belongs to no feature — the generic validation messages, the generic
failure messages, the status titles of a failure, shared field labels.

A feature's file holds three tiers:

- **Error keys**, one per `DomainError.code` (`users.user_not_found`).
- **One nested object per operation** for the validation messages whose sentence names the field or
  the limit (`users.create_user.email_invalid`).
- **One nested object per message this application renders** — an email, a push message — holding
  its copy (`users.welcome_email.subject`, `users.welcome_email.heading`).

**Every key exists in every configured locale.** A missing key renders as the raw key to whoever
requested that language, so adding a key means adding it to all of them in the same change. A locale
is not "partly translated"; it is either complete or it is visibly broken for some users.

## The language of a request

Resolvers are tried in order — a header, then the `Accept-Language` the browser sent — falling back
to the configured default. A caller who asked for a language gets it, and one who said nothing gets
what their client implied.

**Not a query parameter.** It is the obvious first resolver and it cannot work: the global
validation pipe rejects a query field no DTO declares, so `?lang=` answers 400 on every endpoint
that has a query DTO and works on the ones that do not. Half a mechanism is worse than none, because
the half that works is the half nobody tests. Whitelisting `lang` on every query DTO is the
alternative, and it puts a presentation concern in each one.

The default locale is configuration (see the `configuration` skill), not a constant scattered
through the code.

## The language of a notification

**An email, a push message, or an SMS is rendered in the *recipient's* language, read from their
stored preference at send time.**

A rendered email template receives **text**, never translation keys: resolving a key inside the
template puts the language decision where the recipient is not known. The caller resolves the copy
in the recipient's language and passes strings in.

Never from the current request. The request's language is the *sender's* — an operator approving
something, a scheduled job with no request at all, a webhook from a third party. None of them has
anything to do with the person who will read the message.

```typescript
// ❌ the recipient receives the operator's language
const language = i18n.lang;

// ✅ the recipient receives their own
const language = user.preferredLanguage;
```

A `preferredLanguage` on any entity that can be notified is part of its domain state, validated
against the same locale value union as everything else, with the default applied at creation rather
than at send time.

**It changes only when its owner says so**, through a route on the caller's own account — never
copied from the language a request arrived in. The request's language belongs to whichever browser
sent it: a shared computer or a phone set to another locale would rewrite what every later message
is written in, and nothing on screen would say the preference changed.

```typescript
// ❌ the account follows whichever browser signed in last
user.changePreferredLanguage(Language.create(i18n.lang), performedBy, now);

// ✅ only the owner's explicit choice, from the body of their own route
user.changePreferredLanguage(Language.create(command.preferredLanguage), command.performedBy, now);
```

## Validator messages

Every request-DTO validator carries its message key explicitly. The validation classes of the
environment and of a tool's input have none: their failures are read by an operator at startup, not
translated for a client.

```typescript
export class CreateUserDTO {
  @IsEmail({}, { message: i18nValidationMessage("users.create_user.email_invalid") })
  public email!: string;

  @IsString({ message: i18nValidationMessage("common.validation.string") })
  @MaxLength(PERSON_NAME_MAX_LENGTH, { message: i18nValidationMessage("users.create_user.name_max_length") })
  public name!: string;
}
```

Never rely on the library's automatic message. The default is English, it is not in the translation
files, and it names the property in a shape no product copy would use — so one untranslated sentence
appears among translated ones, for the one field somebody forgot.

Which key a validator takes depends on what its sentence says:

- **A generic validator shares a `common.validation.*` key** — string, enum, boolean, array. "The
  value must be one of the allowed options" is true of every field it guards.
- **A rule whose sentence names the field or the limit lives in the operation's object** —
  `users.create_user.email_invalid`, `users.create_user.name_max_length`, or
  `common.validation.limit.max` for a shared query parameter. "The name is too long" is the sentence
  a person understands; an interpolated "name must be shorter than or equal to 100 characters" is
  the property name and the constraint leaking into product copy.

No validation message interpolates. The field name in the code is not a word the reader uses, and
every locale would have to build a sentence around an argument whose grammar it cannot know.

## What a response translates

**A failure, never a success** — a success carries no message at all (see `presentation-layer`).
A failure's `title` and `detail` are translated here, in the request's language, because the client
cannot know what the server's rule was.

## Translating a domain error

Adding a domain error means three edits in one change: the error class, its entry in the errors map,
and its key in every locale. The `error-handling` skill owns the first two; this skill owns the
third.

The filter translates the code into the problem's `detail` and the status into its `title`; `code`
stays untranslated (see `error-handling`). The status titles live in `common.json`, one per status
the application answers on its own.

## Labels for a value union

**The test is who renders it.** An enum serialized into a JSON response is data: the client that
displays it owns the wording, and a label group here would be a second one nobody reads. The same
enum printed into an email, a PDF or a push notification is rendered by this application, and that
is when it needs labels.

When this application renders a value union's members, its label group covers **every** member of
the `const` array. A member added to the array without a label renders its raw value — which is
usually a lowercase snake_case token appearing in the middle of a sentence.

The array and its label group are edited together, for the same reason a schema and its migration
are.

## Checklist

- [ ] Every key exists in every configured locale.
- [ ] Every feature's namespace file matches its feature name.
- [ ] Every notification resolves the language from the recipient, never from the request.
- [ ] A stored `preferredLanguage` changes only through a route on the caller's own account; nothing
      copies the request's language onto it.
- [ ] Every request-DTO validator declares its message key: a generic one a `common.validation.*`
      key, a field- or limit-specific one a key in its operation's object; none interpolates.
- [ ] Every notification this application renders has its copy in one nested object of its
      feature's file.
- [ ] Every domain error has a key in every locale, added with the class.
- [ ] Every value union this application renders — in an email, a document, a notification — has a
      label for every member. One that only travels in a JSON response does not.
