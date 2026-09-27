---
name: forms
description: "Forms with React Hook Form and Zod — the schema file (what the fields hold, what is sent, the default values, the list of fields, a schema built with the translator), the form as the boundary of controlled values (every field declared, `null` for nothing selected, conversions in the schema and never in a component), an edit form that mounts already filled from a pure `to…FormInput`, text fields through `register` and library controls through `Controller`, wiring a field's label, description and error, the backend's field errors placed on fields, the submit latch, what the submit and cancel buttons do while a write is in flight, and confirming an irreversible write."
when_to_use: "Trigger on — writing a `*-form.tsx` or a `*.schema.ts` for a form, `useForm`, `zodResolver`, `defaultValues`, `register` or `Controller`, the warning 'A component is changing an uncontrolled input to be controlled', a field that starts `undefined`, `?? \"\"` on a field's value, a select with no selection, going back to 'none' in a select, a number field, `reset()` in an effect to fill an edit form, `setError`, a 400 whose `errors[]` should land on fields, a field error that never shows, a double submit, a submit button that stays enabled, a cancel button disabled during a save, `aria-invalid` or `aria-describedby` on a field, `noValidate`, a Zod message that stays in the old language, `z.input` and `z.output`, or a confirm dialog before a destructive action."
---

# Forms

```text
build<Form>Schema(t)  →  <Form>FormInput / <Form>Values  →  useForm  →  submit  →  the mutation
```

A form is a component in the feature's `components/`, and everything about its values lives in one
`.schema.ts` beside the other schemas: the types, the default values, the list of fields and the
schema builder. The mutation it submits to is the feature's (see `server-state`).

For the whole shape in one place, read [examples/create-user.schema.ts](examples/create-user.schema.ts)
and [examples/create-user-form.tsx](examples/create-user-form.tsx) before writing a form: a create
form with text fields, a select that can go back to "nothing chosen", the backend's field errors and
the latch.

## The form is the boundary of controlled values

React warns *"A component is changing an uncontrolled input to be controlled"* when a field's value
starts `undefined` and later becomes a string: a `defaultValues` that leaves the field out, a `?.`
over data that has not arrived, a partial `reset()`. The test setup fails on that warning (see
`testing`), and the rule that prevents it has one owner — this form's value types:

- **`<Form>FormInput` declares every field, and none is optional.** Text and numbers are `string`; a
  select or a combobox with nothing selected is `null`, which is what the UI library expects; a
  checkbox is `boolean`.
- **`defaultValues` states every field**, so the first render already has a value for each control.
- **`<Form>Values` is what the backend receives**, and it differs where the backend's shape differs:
  a language nobody chose is no property at all (`undefined`), a number field is a `number`.
- **The schema converts one into the other**, and it is the only place that does. A component never
  writes `?? ""`, `Number(…)` or `?? undefined` on a field.

```typescript
export type CreateUserFormInput = {
  name: string;
  email: string;
  password: string;
  preferredLanguage: Language | null;
};

export type CreateUserValues = {
  name: string;
  email: string;
  password: string;
  preferredLanguage: Language | undefined;
};

export const CREATE_USER_DEFAULT_VALUES: CreateUserFormInput = {
  name: "",
  email: "",
  password: "",
  preferredLanguage: null,
};
```

The two types are written out rather than inferred with `z.input` and `z.output`: they are the
form's contract, which the component, the default values and the mutation all read, and the schema
is checked against them by its return type.

## The schema

```typescript
export function buildCreateUserSchema(t: TFunction<"users">): z.ZodType<CreateUserValues, CreateUserFormInput> {
  return z.object({
    name: z.string().trim().min(1, { error: t("form.errors.name_required") }),
    email: z.email({ error: t("form.errors.email_invalid") }),
    password: z.string().min(USER_PASSWORD_MIN_LENGTH, { error: t("form.errors.password_too_short", { min: USER_PASSWORD_MIN_LENGTH }) }),
    preferredLanguage: z.enum(LANGUAGE_VALUES).nullable().transform((language: Language | null): Language | undefined => language ?? undefined),
  });
}
```

- **Built by a function that takes the translator**, and called while the component renders, so its
  messages follow a language change instead of keeping the one the module loaded with.
- **`z.ZodType<Values, FormInput>` as its return type** — output first, input second — so a schema
  that stops producing what the backend takes, or stops accepting what the fields hold, is a compile
  error.
- **Zod's own vocabulary**: `{ error }` for a message, `z.email()` for an address, `z.enum(VALUES)`
  over the catalog's array (see `code-conventions`), `.transform` for a conversion.
- **Validate on the client what gives better feedback before a request**: a required field, an
  address's shape, a minimum the reader should know before typing more. A limit the backend
  enforces more precisely than the client can — a byte length, a uniqueness — is left to it: its
  answer lands on the same field, in the reader's language (below).
- **A form with modes passes the mode to the builder**, and the schema describes only the fields that
  mode uses. A field the active mode does not use is never filled with a placeholder to get past a
  rule written for the other one.

## `useForm`

```typescript
const { register, control, handleSubmit, setError, formState: { errors } } = useForm<CreateUserFormInput, unknown, CreateUserValues>({
  resolver: zodResolver(buildCreateUserSchema(t)),
  defaultValues: CREATE_USER_DEFAULT_VALUES,
});
```

All three type arguments, so the form knows both what it stores and what `handleSubmit` hands the
submit function.

## An edit form mounts already filled

An edit form never renders empty and then fills itself. It mounts **after** the entity has loaded —
its route loads it, and the page reads it with a suspense query (see `data-fetching-states`) — and
its starting values come from a pure function of the entity:

```typescript
export function toEditUserFormInput(user: User): EditUserFormInput {
  return { email: user.email };
}
```

```typescript
const { register, handleSubmit, setError, formState: { errors, isDirty } } = useForm<EditUserFormInput, unknown, EditUserValues>({
  resolver: zodResolver(buildEditUserSchema(t)),
  defaultValues: toEditUserFormInput(user),
});
```

No `useEffect` that calls `reset` when the data arrives: that is a render with the fields empty, an
uncontrolled-to-controlled switch, and a reset that throws away whatever the reader typed in the
meantime. The component receives the entity as a non-optional prop, so there is nothing to wait for.
Its submit button stays disabled while `!isDirty` — nothing changed is nothing to send.

## Fields

- **A native text input takes `register`**, spread last: `<Input id={emailId} type="email"
  {...register("email")} />`. It is an uncontrolled input the form reads on submit, which is the
  cheapest correct form for text.
- **A library control — a select, a combobox, a checkbox, a date picker — goes through
  `Controller`**, bound to its value and its change handler, with the control's ref for focus:

  ```tsx
  <Controller
    control={control}
    name="preferredLanguage"
    render={({ field, fieldState }) => (
      <Select
        items={languageItems}
        value={field.value}
        inputRef={field.ref}
        onValueChange={(value) => {
          field.onChange(typeof value === "string" && isLanguage(value) ? value : null);
        }}
      >
        <SelectTrigger
          id={languageId}
          aria-invalid={fieldState.invalid}
          aria-describedby={fieldState.invalid ? `${languageId}-error` : `${languageId}-description`}
          onBlur={field.onBlur}
        >
          <SelectValue />
        </SelectTrigger>
      </Select>
    )}
  />
  ```

  A control that keeps its own value instead of driving `field.onChange` validates against a stale
  value on submit.
- **A select that can be left empty offers "nothing" as an item** — `{ value: null, label: t(…) }`
  first in its items — so the reader can take a choice back, and the field returns to `null`.
- **The options come from the catalog's array**, mapped, never written out one by one.

### Wiring a field

Every field renders the same parts, connected by ids, so a screen reader announces the label, the
state and the message together:

```tsx
<Field data-invalid={errors.email !== undefined}>
  <FieldLabel htmlFor={emailId}>{t("form.email")}</FieldLabel>

  <Input
    id={emailId}
    type="email"
    autoComplete="off"
    aria-invalid={errors.email !== undefined}
    aria-describedby={errors.email ? `${emailId}-error` : undefined}
    {...register("email")}
  />

  <FieldError id={`${emailId}-error`} errors={[errors.email]} />
</Field>
```

- **One `useId` per field**, and every other id derived from it (`-error`, `-description`), so two
  forms on one page never collide.
- **`aria-describedby` points at the error while there is one**, and at the field's description
  otherwise; a field with a description shows one or the other.
- **`<form noValidate>`**: the browser's own validation would show its messages, in the browser's
  language, before the schema runs.
- **The first invalid field takes focus** — the form library does it for the schema's errors, and
  the helper below for the backend's — so a keyboard or screen-reader user lands on it.

What makes a name accessible, and focus in general, are `accessibility`'s.

## The backend's field errors

A `400` carries one `{ field, message }` per invalid field, the field a dotted path that matches the
form's own (see `api-client`). The form places each on its field and says whether every one found a
field:

```typescript
function isFieldOf<T extends FieldValues>(field: string, fields: readonly Path<T>[]): field is Path<T> {
  return (fields as readonly string[]).includes(field);
}

export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): boolean {
  if (!(error instanceof APIError)) {
    return false;
  }

  let placed = 0;

  for (const { field, message } of error.fieldErrors) {
    if (isFieldOf(field, fields)) {
      setError(field, { type: "server", message }, { shouldFocus: placed === 0 });
      placed += 1;
    }
  }

  return placed > 0 && placed === error.fieldErrors.length;
}
```

The fields it may place errors on are the schema file's list, `as const satisfies readonly (keyof
<Form>FormInput)[]`, so a field the form does not have is never targeted. It takes `unknown` because
not every failure is an `APIError` — a bug in the mutation function (a mapper that reads a field
the response lacks) reaches the form as whatever it threw. When it returns
`false`, the form shows the rest itself, which is why its mutation sets `meta.errorToast: false`;
whether that is a toast or an alert inside the form is `error-handling`'s.

## Submitting

```typescript
const isSubmitting = useRef(false);

function submit(values: CreateUserValues): void {
  if (isSubmitting.current) {
    return;
  }

  isSubmitting.current = true;

  createUser.mutate(values, {
    onSuccess: onCreated,
    onError: (error: unknown): void => {
      if (!applyFieldErrors(error, setError, CREATE_USER_FIELDS)) {
        showErrorToast(error);
      }
    },
    onSettled: (): void => {
      isSubmitting.current = false;
    },
  });
}
```

- **A ref latches the submit synchronously.** `isPending` reaches the button only on the next render,
  so two clicks in the same frame, or a held Enter, both reach `mutate` before anything is disabled.
  The latch is released in `onSettled`, so a failure can be corrected and sent again.
- **The latch is not the guarantee against a duplicate**, only against the client adding one. A
  request that reached the server and lost its response is retried by the reader and arrives twice;
  an endpoint that creates something irreversible needs an idempotency key of its own.
- **The submit button is disabled while the mutation is pending** — and, on an edit form, while
  nothing changed — with `focusableWhenDisabled`, so the reader who pressed it keeps their place
  (see `accessibility`).
- **Every form has a way back, and it is a link to where the reader came from, never a disabled
  button.** While the write is in flight the fullscreen loader covers the screen, the link
  included: leaving a half-finished write is exactly what the loader prevents (see
  `error-handling`). Before and after it, backing out always works.
- **The values go to the mutation as the schema produced them**, when they already match the request
  body (see `api-client`).
- **A form reports success upward** (`onCreated(id)`, `onSaved()`), and its page decides where to go.
  A page that leaves a form after a create navigates with `replace`, so Back does not return to a
  form for something that now exists.

## Confirming an irreversible write

A write the reader cannot undo from the screen — deleting, sending, charging — asks first, in an
alert dialog; a reversible one does not, because a dialog on every save is friction the reader learns
to click through. The submit stores the validated values, the dialog's confirm sends them, and
closing it forgets them:

```tsx
const [pendingValues, setPendingValues] = useState<DeleteOrderValues>();

<AlertDialog
  open={pendingValues !== undefined}
  onOpenChange={(open) => {
    if (!open) {
      setPendingValues(undefined);
    }
  }}
/>
```

The dialog's confirm button runs the same latched submit as above and is disabled while the mutation
is pending; its cancel button closes the dialog and is never disabled.

## Checklist

- [ ] The schema file holds the form's input and output types, its default values (or its
      `to…FormInput`), its list of fields and its builder.
- [ ] Every field is declared in `<Form>FormInput` and in `defaultValues`; nothing selected is `null`.
- [ ] Every conversion between a field and the request is in the schema; no component writes
      `?? ""`, `Number(…)` or `?? undefined` on a field.
- [ ] The builder takes the translator and returns `z.ZodType<Values, FormInput>`.
- [ ] An edit form receives its entity resolved and starts from `to…FormInput(entity)`, with no
      `reset` in an effect.
- [ ] Text inputs use `register`; library controls use `Controller` with the field's ref.
- [ ] Every field connects its label, control, description and error by ids from one `useId`, and
      the form has `noValidate`.
- [ ] The mutation's `onError` places the backend's field errors and shows the rest.
- [ ] The submit is latched by a ref released in `onSettled`, the submit button is disabled while
      pending and stays focusable, and the way back is a link, never a disabled button.
- [ ] Every irreversible write is confirmed in an alert dialog; no reversible one is.
