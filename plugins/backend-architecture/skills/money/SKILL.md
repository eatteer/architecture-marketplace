---
name: money
description: "Monetary amounts end to end — the `Money` value object as a `bigint` of minor units, the ISO 4217 currency that travels with it and its exponent table, explicit `RoundingMode` with half-even as the default, rates in basis points, splitting a total by largest remainder, refusing mixed currencies, the Int64 subdocument in MongoDB, the `amountMinor` string on the wire, and formatting only for a human."
when_to_use: "Trigger on — modeling a price, amount, balance, fee, discount, tax or total, adding a currency field, applying a percentage or rate, rounding a fraction of a cent, splitting a charge or refund into parts, summing amounts in an aggregation, importing `Money`, `Currency` or `RoundingMode`, a `number` or `Decimal128` holding money, a DTO or schema field for an amount, formatting an amount in an email or PDF, or a cent that goes missing, a sum that does not add up, a split whose parts miss the total, an amount off by a factor of ten or a hundred, or `Do not know how to serialize a BigInt`."
---

# Money

An amount of money is an **integer count of the currency's minor unit** — cents, not dollars —
held as a `bigint`, and it never exists without its currency. Everything below follows from those
two rules; each section is where one of them meets a layer.

A binary float cannot hold most decimal fractions (`0.1 + 0.2 === 0.30000000000000004`), so a float
amount needs rounding after every operation and still disagrees with the ledger by a cent
somewhere. An integer is exact: the sum is the sum. That holds in the database, in code and on the
wire — a `number` for money is wrong in all three.

## The value object

`Money` lives in `common/domain` — its rules name no business entity (see the `domain-modeling`
skill for that test). It holds the amount and a `Currency`, and exposes the primitives:

```typescript
const price = Money.create({ amountMinor: "1999", currency: "USD" });

price.amountMinor; // 1999n
price.currency;    // "USD"
```

- **`create()` takes the three shapes an amount arrives in**: a `bigint` (code, the driver), a
  decimal string of minor units (a command), and a `number` only when it is a safe integer. `12.5`
  is refused, not rounded: it is somebody passing dollars where cents were expected, and rounding
  would hide the unit mistake behind an amount a hundred times too small. A number past 2^53 is
  refused because it has already lost digits before reaching the constructor.
- **Negative amounts are valid.** A refund, a credit or an adjustment is a negative amount. Whether
  a particular field may be negative is that entity's invariant, not the value object's.
- **A `bigint` cannot overflow.** The only bound is storage (see below); in memory, a sum of any
  size is exact.

### The currency and its exponent

The currency is an ISO 4217 code, always stored and sent **next to** the amount — `12345` means
nothing until it says of what. The exponent that places the decimal point comes from a **static
table** in the `Currency` value object: JPY 0, USD 2, KWD 3, CLF 4.

Never derive the exponent from `Intl.NumberFormat(...).resolvedOptions()`. Intl answers a display
question from CLDR, which disagrees with ISO for several currencies (it shows no decimals for IQD,
which has three) and changes with the runtime's ICU version. An exponent that moves when Node is
upgraded rescales every stored amount by a power of ten.

Codes with no minor unit — precious metals, SDR, the testing and "no currency" codes — are not in
the table, and `Currency.create()` refuses them.

## Operations

| Operation | Rounds? | Notes |
| --- | --- | --- |
| `Money.zero(currency)` | no | the starting point of a sum |
| `add`, `subtract`, `compareTo` | no | refuses a different currency |
| `equals` | no | same amount and same currency; a different currency is unequal, not refused |
| `isZero`, `isNegative`, `isPositive` | no | getters — the questions an invariant asks |
| `negate` | no | |
| `multiply(quantity)` | no | a whole quantity — three items at 1999 is 5997, exactly |
| `multiplyByRatio(numerator, denominator, mode)` | yes | any fraction, as two integers — a third is a third, not 0.333… |
| `applyBasisPoints(basisPoints, mode)` | yes | a rate as whole basis points: 1525 is 15.25 % |
| `allocate(ratios)` | no | parts always sum to the total — see below |

### Rounding is an argument

`RoundingMode` is an enumerable concept declared in the derived form (see `domain-modeling`), in its
own file in `common/domain` beside `DEFAULT_ROUNDING_MODE`.

**Every operation that can land between two minor units takes a `RoundingMode`, and it has no
default parameter.** The rule is a business decision — a tax authority, a contract or a card network
states it — and an operation that picked one silently would be making that decision for them.

| Mode | 2.5 → | −2.5 → | 2.6 → |
| --- | --- | --- | --- |
| `half_even` | 2 | −2 | 3 |
| `half_up` | 3 | −3 | 3 |
| `half_down` | 2 | −2 | 3 |
| `up` (away from zero) | 3 | −3 | 3 |
| `down` (toward zero) | 2 | −2 | 2 |
| `ceiling` | 3 | −2 | 3 |
| `floor` | 2 | −3 | 2 |

When nothing in the business states a rule, pass the exported `DEFAULT_ROUNDING_MODE`, which is
**`half_even`**. Half-even sends ties to the even neighbor, so across many operations as many ties
round down as up; half-up sends every tie the same way, and a ledger summing thousands of them
drifts upwards by the count. Passing the constant rather than the literal is what makes "nobody
decided" greppable.

```typescript
const tax = subtotal.applyBasisPoints(TAX_RATE_BASIS_POINTS, DEFAULT_ROUNDING_MODE);
```

**Rates and percentages are integers too** — whole basis points, or a numerator and denominator.
A `0.1525` float rate reintroduces exactly the drift the integer amount removed, one multiplication
later.

Round **once, at the step the business defines** — per line or on the total, which give different
answers and are both legitimate. Rounding every intermediate result compounds the error; deciding
which one applies is a domain question, and the code states the answer where the rounding happens.

### Splitting a total

Dividing a total into parts and rounding each part does not sum back to the total: 100 cents in
three is 33 + 33 + 33 = 99, and the missing cent is a reconciliation ticket. `allocate` uses the
**largest-remainder method** — every part gets its rounded-down share, then the units left over go
one each to the parts that lost most to that rounding, ties to the earlier part so the same split
always lands the same way:

```typescript
const [first, second, third] = Money.create({ amountMinor: 100n, currency: "USD" }).allocate([1, 1, 1]);
// 34, 33, 33 — and the sum is exactly 100
```

Anything that divides a charge — instalments, a refund across items, a fee shared between parties —
goes through `allocate`, never through a division per part.

### Mixing currencies

An operation between two currencies throws `CurrencyMismatchError`. Adding 10 USD to 10 EUR has no
answer without an exchange rate, and a rate is a business decision with a date and a source — so a
conversion is its own explicit step, never a side effect of `add`. The error maps to 400 (see the
`error-handling` skill): it is a value that does not check out, not a state in the way.

## Persistence

A monetary field is a **subdocument**, `{ amountMinor, currency }`, declared once as a shared schema
and embedded wherever an amount is stored:

```typescript
@Schema({ _id: false, versionKey: false })
export class MoneySchema {
  @Prop({ required: true, type: MongooseSchema.Types.BigInt })
  public amountMinor!: bigint;

  @Prop({ required: true })
  public currency!: string;
}

export const MoneySchemaFactory: MongooseSchema<MoneySchema> = SchemaFactory.createForClass(MoneySchema);
```

```typescript
@Prop({ required: true, type: MoneySchemaFactory })
public total!: MoneySchema;
```

- **`Schema.Types.BigInt` stores an Int64.** Not `Number` (a double — the float again) and not
  `Decimal128` (a decimal, which invites fractional minor units and sums into a type nothing in the
  domain speaks).
- **The currency is in the same subdocument**, so no write can change one without the other.
- **The connection sets `useBigInt64: true`.** Without it the driver returns a `number` for a small
  Int64 and a `Long` for a large one, and a `.lean()` read — which skips Mongoose's casting — hands
  the mapper whichever it got. With it, every Int64 comes back as a `bigint`, which is what the
  schema class says.
- **Int64 is the one bound.** An amount past 2^63 − 1 is refused at the write. The request DTO caps
  the string's length so that case answers 400 instead of reaching the database.
- **Aggregations sum the integers.** `$sum` over `amountMinor` returns an Int64; group by
  `currency` as well, because a sum across currencies is meaningless. No `$divide` or `$round` on an
  amount inside a pipeline — the rounding belongs to `Money`, with a stated mode.

The feature's persistence mapper converts each monetary field through a shared money mapper, so the
subdocument's shape is decided once. The persistence mapper itself belongs to the
`persistence-layer` skill.

## The wire

An amount crosses JSON as an object with the amount **as a string**:

```json
{ "amountMinor": "12345", "currency": "USD" }
```

JSON has no integer type, and a client that parses a large amount as a double loses digits past 2^53
without an error. There is also a server-side reason: `JSON.stringify` throws on a `bigint`
(`Do not know how to serialize a BigInt`), so a `bigint` that reaches a response body turns the
endpoint into a 500. The presentation mapper is the one place it becomes a string.

The request DTO is nested with `@ValidateNested()` and `@Type(() => MoneyInputDTO)`:

```typescript
export const AMOUNT_MINOR_MAX_LENGTH: number = 20;

export class MoneyInputDTO {
  @ApiProperty({ type: String, pattern: AMOUNT_MINOR_PATTERN.source, maxLength: AMOUNT_MINOR_MAX_LENGTH, example: "12345" })
  @IsString({ message: i18nValidationMessage("common.validation.string") })
  @Matches(AMOUNT_MINOR_PATTERN, { message: i18nValidationMessage("common.validation.money.amount_minor_invalid") })
  @MaxLength(AMOUNT_MINOR_MAX_LENGTH, { message: i18nValidationMessage("common.validation.money.amount_minor_too_long") })
  public amountMinor!: string;

  @ApiProperty({ example: "USD", description: "ISO 4217 currency code" })
  @IsISO4217CurrencyCode({ message: i18nValidationMessage("common.validation.money.currency_invalid") })
  public currency!: string;
}
```

- **`@Matches(/^-?\d+$/)`, not `@IsNumberString`.** The latter accepts `"12.50"` and `"1e3"` —
  exactly the decimal amounts a minor-unit field exists to refuse. The pattern is exported from the
  value object, so the DTO, the OpenAPI `pattern` and `Money.create()` read one definition.
- **`maxLength` of 20** is a sign plus the nineteen digits of an Int64.
- **The OpenAPI type is `string`** with that pattern. Documented as a number, every generated client
  parses it into a double.
- **`@IsISO4217CurrencyCode` accepts lower case**, so `Currency.create()` upper-cases before looking
  the code up — refusing there what the boundary let through would answer 400 for a value the
  caller was told is valid.

The response DTO has the same two fields with no validators; the command carries the two strings;
the use case builds the `Money`. DTO, command and mapper conventions belong to the
`presentation-layer` and `application-layer` skills.

## Formatting for a human

A formatted amount — `$1,234.50`, `1.234,50 €` — appears **only** where a person reads it: an email,
a PDF, a generated document. The API sends minor units and lets the client format; formatting on
the server for the API would fix one locale's separators into every client.

Format from the exact decimal string, never from a division:

```typescript
function formatMoney(money: Money, locale: string): string {
  const exponent = Currency.create(money.currency).exponent;

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(money.toDecimalString());
}
```

- `toDecimalString()` places the point in the integer's digits (`"123.45"`, `"-0.05"`), and
  `Intl.NumberFormat` formats a numeric string exactly. `Number(amountMinor) / 100` is the float
  again, and the hard-coded 100 is wrong for every currency whose exponent is not two.
- The fraction digits are pinned to the ISO exponent because Intl's own default for the currency is
  CLDR's, which is the disagreement described above.
- The locale is the recipient's, resolved as the `i18n` skill describes.

## What to test

The rules live in the value object, so they are tested there, once (see the `testing` skill for the
general shape):

- **Each rounding mode at its boundaries** — a tie on an even and on an odd neighbor, either side of
  a tie, negative amounts, an exact division left alone.
- **`allocate` with a remainder** — the leftover unit goes to the largest remainder, the parts sum
  to the total, a negative amount splits symmetrically, a zero ratio gets nothing.
- **Currencies with 0 and 3 decimals**, and the ones where Intl disagrees with ISO.
- **Refusals** — a fractional `number`, a decimal string, a mixed-currency operation, an unknown
  currency.
- **No overflow** — a sum past 2^64 is exact.
- **The edges round-trip** — the persistence mapper through the schema (an Int64-sized amount comes
  back as a `bigint`; one past Int64 is refused), and the presentation mapper to a string that keeps
  every digit past 2^53.

## Checklist

- [ ] No amount of money is a `number`, a float or a `Decimal128` — in an entity, a schema, a DTO,
      a command or an aggregation.
- [ ] Every amount is stored and sent together with its ISO 4217 currency.
- [ ] Every exponent comes from the static table, and nothing derives one from `Intl`.
- [ ] Every operation that can produce a fraction passes a `RoundingMode` — `DEFAULT_ROUNDING_MODE`
      where the business states no rule.
- [ ] Every rate or percentage is an integer (basis points) or a numerator and a denominator.
- [ ] Every split of a total goes through `allocate`.
- [ ] Every aggregation that sums amounts also groups by currency.
- [ ] The connection sets `useBigInt64`, and every monetary schema field is `Schema.Types.BigInt`.
- [ ] Every wire amount is a string validated by `@Matches` against the value object's pattern, and
      documented as `type: string`.
- [ ] A formatted amount appears only in human-facing output, built from `toDecimalString()` with
      the fraction digits pinned to the exponent.
