import { z } from "zod";

import { LANGUAGE_VALUES } from "@/common/i18n/languages";
import type { LanguageValue } from "@/common/i18n/languages";

import type { TFunction } from "i18next";

// The backend's minimum. Its other limits — the name's length, the password's 72 bytes — are left
// to it: its answer lands on the same fields, in the reader's language.
export const USER_PASSWORD_MIN_LENGTH = 8;

// What the fields hold. Every one is declared and none is optional, so no control ever starts
// uncontrolled: text is a string, and a select with nothing chosen is `null`, as Base UI expects.
export type CreateUserFormInput = {
  name: string;
  email: string;
  password: string;
  preferredLanguage: LanguageValue | null;
};

// What the backend receives: no choice is no property, and the account gets the backend's default.
export type CreateUserValues = {
  name: string;
  email: string;
  password: string;
  preferredLanguage: LanguageValue | undefined;
};

export const CREATE_USER_DEFAULT_VALUES: CreateUserFormInput = {
  name: "",
  email: "",
  password: "",
  preferredLanguage: null,
};

export const CREATE_USER_FIELDS = ["name", "email", "password", "preferredLanguage"] as const satisfies readonly (keyof CreateUserFormInput)[];

// The conversion from what a field holds to what the backend takes happens here, never in a component.
export function buildCreateUserSchema(t: TFunction<"users">): z.ZodType<CreateUserValues, CreateUserFormInput> {
  return z.object({
    name: z.string().trim().min(1, { error: t("form.errors.name_required") }),
    email: z.email({ error: t("form.errors.email_invalid") }),
    password: z.string().min(USER_PASSWORD_MIN_LENGTH, { error: t("form.errors.password_too_short", { min: USER_PASSWORD_MIN_LENGTH }) }),
    preferredLanguage: z.enum(LANGUAGE_VALUES).nullable().transform((language: LanguageValue | null): LanguageValue | undefined => language ?? undefined),
  });
}
