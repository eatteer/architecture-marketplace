import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "@tanstack/react-router";
import { useId, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { showErrorToast } from "@/common/components/error-toast";
import { isLanguage, LANGUAGE_LABELS, LANGUAGE_VALUES } from "@/common/i18n/languages";
import type { Language } from "@/common/i18n/languages";
import { applyFieldErrors } from "@/common/lib/field-errors";
import { Button, buttonVariants } from "@/common/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/common/ui/field";
import { Input } from "@/common/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/common/ui/select";
import { useCreateUser } from "@/features/users/api/user-mutations";
import {
  buildCreateUserSchema,
  CREATE_USER_DEFAULT_VALUES,
  CREATE_USER_FIELDS,
} from "@/features/users/schemas/create-user.schema";
import type { CreateUserFormInput, CreateUserValues } from "@/features/users/schemas/create-user.schema";

import type { JSX } from "react";

type CreateUserFormProps = {
  onCreated: (id: string) => void;
};

type LanguageItem = {
  value: Language | null;
  label: string;
};

export function CreateUserForm({ onCreated }: CreateUserFormProps): JSX.Element {
  const { t } = useTranslation("users");

  const createUser = useCreateUser();

  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const languageId = useId();

  // Set on submit and released when the request settles, so a double click sends one request.
  const isSubmitting = useRef(false);

  const { register, control, handleSubmit, setError, formState: { errors } } = useForm<CreateUserFormInput, unknown, CreateUserValues>({
    resolver: zodResolver(buildCreateUserSchema(t)),
    defaultValues: CREATE_USER_DEFAULT_VALUES,
  });

  // Choosing the first item again is how the reader takes a language back.
  const languageItems: LanguageItem[] = [
    { value: null, label: t("form.default_language") },
    ...LANGUAGE_VALUES.map((value: Language): LanguageItem => ({ value, label: LANGUAGE_LABELS[value] })),
  ];

  function submit(values: CreateUserValues): void {
    if (isSubmitting.current) {
      return;
    }

    isSubmitting.current = true;

    createUser.mutate(values, {
      onSuccess: onCreated,
      // A field the backend names gets its message. Anything else (the email already taken, a lost
      // connection) is a toast, since no field would explain it.
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

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void handleSubmit(submit)(event);
      }}
    >
      <FieldGroup>
        <Field data-invalid={errors.name !== undefined}>
          <FieldLabel htmlFor={nameId}>{t("form.name")}</FieldLabel>

          <Input
            id={nameId}
            autoComplete="off"
            aria-invalid={errors.name !== undefined}
            aria-describedby={errors.name ? `${nameId}-error` : undefined}
            {...register("name")}
          />

          <FieldError id={`${nameId}-error`} errors={[errors.name]} />
        </Field>

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

        <Field data-invalid={errors.password !== undefined}>
          <FieldLabel htmlFor={passwordId}>{t("form.password")}</FieldLabel>

          <Input
            id={passwordId}
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.password !== undefined}
            aria-describedby={errors.password ? `${passwordId}-error` : undefined}
            {...register("password")}
          />

          <FieldError id={`${passwordId}-error`} errors={[errors.password]} />
        </Field>

        <Controller
          control={control}
          name="preferredLanguage"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={languageId}>{t("form.language")}</FieldLabel>

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
                  className="w-full"
                  aria-invalid={fieldState.invalid}
                  aria-describedby={fieldState.invalid ? `${languageId}-error` : `${languageId}-description`}
                  onBlur={field.onBlur}
                >
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  {languageItems.map(({ value, label }: LanguageItem): JSX.Element => (
                    <SelectItem key={value ?? "default"} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {fieldState.invalid
                ? <FieldError id={`${languageId}-error`} errors={[fieldState.error]} />
                : <FieldDescription id={`${languageId}-description`}>{t("form.language_description")}</FieldDescription>}
            </Field>
          )}
        />

        <div className="flex gap-2">
          <Button type="submit" disabled={createUser.isPending} focusableWhenDisabled>{t("create.submit")}</Button>
          <Link to="/users" className={buttonVariants({ variant: "outline" })}>{t("create.cancel")}</Link>
        </div>
      </FieldGroup>
    </form>
  );
}
