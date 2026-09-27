---
name: formatting
description: "Dates, numbers and money on screen — `Intl` bound to the language on screen through one hook, ISO 8601 dates from the backend kept as strings and shown in the reader's time zone, date and date-time styles, numbers with the locale's separators, amounts in minor units as strings formatted exactly with their currency's decimals, the pure formatters the hook binds, and a value that may be absent guarded rather than formatted as a placeholder."
when_to_use: "Trigger on — showing a date, a time, a number, a price or an amount, `toLocaleString`, `toLocaleDateString`, `new Date()` in a component, `Intl.DateTimeFormat` or `Intl.NumberFormat`, a date library like date-fns, dayjs or moment, `useFormatters`, `formatDate`, `formatMoney`, `amountMinor`, dividing by 100, `toFixed`, `parseFloat` on an amount, a currency with no decimals or three, a date shown in UTC instead of the reader's time, a date or number that does not change with the language, or a formatter that returns an empty string or a dash for a missing value."
---

# Formatting

Values reach the screen in the reader's conventions — their language's separators and month names,
their time zone — through `Intl`, which the browser already ships. There is no formatting library,
and no component formats a value itself.

## One hook, bound to the language on screen

```typescript
export function useFormatters(): Formatters {
  const { i18n } = useTranslation();

  const { language } = i18n;

  return {
    date: (isoDate: string, options?: Intl.DateTimeFormatOptions): string => formatDate(isoDate, language, options),
    dateTime: (isoDate: string): string => formatDateTime(isoDate, language),
    number: (value: number, options?: Intl.NumberFormatOptions): string => formatNumber(value, language, options),
    money: (money: Money): string => formatMoney(money, language),
  };
}
```

```tsx
const format = useFormatters();

<TableCell>{format.date(user.createdAt)}</TableCell>
```

- **The hook reads the language from the translations**, so a language switch re-renders every
  formatted value with the text around it.
- **Each formatter is also a pure function that takes the language** — `formatDate(isoDate,
  language)` — for the code that is not a component and for the tests, which assert on a literal (see
  `code-conventions` for pure functions).
- **The pure functions live in `common/lib/format.ts` and the hook in
  `common/hooks/use-formatters.ts`**, like every shared hook (see `project-bootstrap` for the tree):
  the hook imports the functions, never the other way round.
- **The styles are named, not patterns**: `dateStyle: "medium"`, `timeStyle: "short"`. A pattern like
  `dd/MM/yyyy` is one country's order written into every language.

## Dates

**A date from the backend stays the ISO 8601 string it arrived as** — the model keeps it that way
(see `api-client` for the mapper) — and becomes a `Date` only inside the formatter, or where the
application computes with it.

```typescript
export function formatDate(isoDate: string, language: string, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  return new Intl.DateTimeFormat(language, options).format(new Date(isoDate));
}
```

- **The backend sends UTC; the reader sees their own time zone.** `Intl` converts with no time zone
  option, which is what the reader expects of a timestamp.
- **`new Date()` for the current time never appears in a component**: a value the screen shows was
  computed by the backend or passed in, so the render is a function of its inputs.

## Numbers

`format.number(value)` for a count or a quantity, with the options `Intl.NumberFormat` takes for a
percentage or a unit. A number interpolated into a sentence is formatted before it is interpolated
(see `i18n`), so `1234` reads `1,234` in English and `1.234` in Spanish.

## Money

An amount arrives in the backend's wire shape — minor units as a string, and the currency:

```typescript
export type Money = {
  amountMinor: string;
  currency: string;
};
```

**It never passes through a float.** The currency decides how many decimals it has — none for JPY,
two for USD, three for KWD — and the formatter asks `Intl` for that number, places the decimal point
in the string, and hands `Intl` the decimal string, which it formats without rounding:

```typescript
export function formatMoney({ amountMinor, currency }: Money, language: string): string {
  const formatter = new Intl.NumberFormat(language, { style: "currency", currency });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
  const sign = amountMinor.startsWith(NEGATIVE_SIGN) ? NEGATIVE_SIGN : "";
  const digits = amountMinor.slice(sign.length).padStart(fractionDigits + 1, "0");
  const pointAt = digits.length - fractionDigits;

  const decimal = fractionDigits > 0
    ? `${sign}${digits.slice(0, pointAt)}${DECIMAL_SEPARATOR}${digits.slice(pointAt)}`
    : `${sign}${digits}`;

  if (!isNumericLiteral(decimal)) {
    throw new Error(`Not an amount in minor units: "${amountMinor}"`);
  }

  return formatter.format(decimal);
}
```

- **No `/ 100`, no `parseFloat`, no `toFixed`.** Each assumes two decimals or loses precision past
  2⁵³, and both are wrong for some currency the backend already accepts.
- **An amount that is not minor units throws**, naming it: a formatter that printed `NaN` would put a
  wrong price on screen without anyone noticing.
- Arithmetic on money — totals, splits — is the backend's; the screen shows what it computed.

## A value that may be absent

A formatter takes a real value and returns a string: `(isoDate: string) => string`, never widened to
accept `undefined` and return `""` or `"—"`. **An absent value is a render decision**, made where the
value is resolved: the row, the label or the whole element appears only when the value exists, and a
pair that only means something together — an amount and its currency — is guarded together (see
`data-fetching-states`).

```tsx
{order.shippedAt !== undefined && <DetailRow label={t("detail.shipped_at")}>{format.dateTime(order.shippedAt)}</DetailRow>}
```

## Checklist

- [ ] Every date, number and amount on screen goes through `useFormatters` or its pure functions.
- [ ] No date library, no `toLocale*String`, and no hard-coded date pattern.
- [ ] Every date in the model is the backend's ISO string, and no component calls `new Date()` for
      the current time.
- [ ] Every amount is `Money` in minor units and is formatted without a float, a division or
      `toFixed`.
- [ ] No formatter accepts `undefined`; absent values are guarded where they render.
