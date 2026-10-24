# Honest Returns: design spec

Date: 2026-10-24. Source: `docs/proposal.md` (approved). Scope: the MVP first, then every full-scope item in the proposal's cut order (1 to 12). This spec is the single source of truth for the test-writer and the driver. Where it changes or narrows the proposal, the change is listed under "Assumptions" with the alternative under "Open questions".

## 1. Goal

A free public web app that computes true SGD returns for a Singapore investor holding US stocks and ETFs, from a broker history. It shows time-weighted return (TWR) and money-weighted return (XIRR) side by side, shows why they differ, and publishes every convention it uses.

Landing view job: show TWR and XIRR for the sample portfolio and make the gap between them understandable without a click.

## 2. Non-goals and anti-goals

Non-goals (never in this plan): accounts, server-side storage of uploads, LLM text, SGX tickers, Irish-domiciled ETFs, currencies other than SGD and USD, margin and short positions, interest on cash, cash-in-lieu on reverse splits, offline caching, native apps, device sync.

Anti-goals (failure even if it "works"):
- A partial result. If any row or ticker is rejected, no numbers are shown.
- Floats in money paths (prices, quantities, cash, values, P&L). See 6.8 for the one float exception.
- Dates handled as UTC timestamps. All dates are `YYYY-MM-DD` strings.
- A demo that breaks when Tiingo is down.

## 3. Architecture

```
Browser (React)                                Cloudflare Worker (Hono), one deploy
---------------------------------------        -------------------------------------------
sample ledger (bundled CSV)  --+               GET  /api/prices   -> D1 (prices, fx, tickers)
user CSV / IBKR file --parse--+                POST /api/ticker-requests (task: queue)
           |                                   static assets (Vite build) for every other path
           v                                   cron hourly 22:00 to 07:00 UTC
  GET /api/prices?tickers=..&from=..            -> Tiingo EOD (<= 45 requests per run)
           v                                    -> Frankfurter (once a night, 22:00 run)
  engine.compute()  (pure TS, decimal.js)
           v
  hero numbers, number line, chart, rows
```

Key decision: **the engine runs in the browser.** The Worker only serves cached market data. Reasons: (a) Workers Free allows about 10 ms CPU per request, and a 6-year daily decimal.js valuation takes tens of milliseconds, so server compute would fail intermittently on the free plan; (b) uploads then never leave the device, which is stronger than "computed in memory, never stored". The engine is pure TypeScript with no I/O, so moving it to the Worker later is a one-file change (needs Workers Paid). This changes the proposal's "computed on the server" wording; see Open question 1.

The Worker returns stored JSON text by string concatenation, without parsing it, to stay inside the CPU limit.

## 4. Repo layout and tooling

Single npm package (no workspaces). Vitest runs `src/engine` and `src/shared` in plain Node. Only `worker/*.test.ts` needs the Workers runtime.

```
package.json           scripts: dev, build, preview, deploy, test, typecheck
tsconfig.json
vite.config.ts         @vitejs/plugin-react + @cloudflare/vite-plugin
vitest.config.ts       two projects: "unit" (node) and "worker" (@cloudflare/vitest-plugin)
wrangler.jsonc
.dev.vars.example      TIINGO_TOKEN=   (real .dev.vars is gitignored)
index.html
public/                manifest + icons (task: manifest)
migrations/            D1 SQL migrations
data/allowlist.txt     one ticker per line
scripts/               fetch-fixture.ts, make-sample.ts, export-pp.ts (run with `node --experimental-strip-types` or tsx)
src/engine/            pure calculation code, no I/O, no React
src/shared/            csv.ts (zod CSV schema), api.ts (zod API schemas), dates.ts
src/importers/         ibkr.ts, tiger.ts, moomoo.ts
src/app/               React UI
src/sample/            sample-ledger.csv
src/verification.json  Portfolio Performance result (task: verification)
worker/                index.ts (Hono app + scheduled), prices.ts, refresh.ts, tiingo.ts, frankfurter.ts, requests.ts
```

Versions (checked on npm 2026-10-24): vite 8, react 19, @vitejs/plugin-react 6, @cloudflare/vite-plugin 1.65, wrangler 4.152, hono 4.13, zod 4, decimal.js 10.6, lightweight-charts 5.2, typescript 7. **Vitest is pinned to 4.1.x**, carried over from the original `@cloudflare/vitest-pool-workers` 0.23 requirement. That package is deprecated; its replacement `@cloudflare/vitest-plugin` 1.4 accepts vitest ^4.1 or ^5. compatibility_date is 2026-10-01.

Commands:
- `npm run dev`: `vite` (Cloudflare plugin runs the Worker and local D1 inside Vite dev).
- `npm run preview`: `vite build && wrangler dev` (production-like, also used to trigger cron locally with `--test-scheduled`).
- `npm test`: `vitest run`. `npm run typecheck`: `tsc --noEmit`.
- `npm run deploy`: `vite build && wrangler deploy`.

`wrangler.jsonc` (key parts):
```jsonc
{
  "name": "honest-returns",
  "main": "worker/index.ts",
  "compatibility_date": "2026-10-01",
  "assets": { "not_found_handling": "single-page-application", "run_worker_first": ["/api/*"] },
  "d1_databases": [{ "binding": "DB", "database_name": "honest-returns", "database_id": "<set at deploy>", "migrations_dir": "migrations" }],
  "triggers": { "crons": ["0 22,23,0-7 * * *"] }
}
```
The Cloudflare Vite plugin fills in the assets directory at build time. Secret: `TIINGO_TOKEN`.

Incidental complexity, accepted: the second vitest project (pool-workers) exists only so D1 SQL is tested against real D1. The Cloudflare Vite plugin exists only so dev is one process.

## 5. Canonical CSV

Header line, exact, case-insensitive, whitespace trimmed: `date,type,ticker,quantity,price,currency,amount,fees`.

Numbers: plain decimals matching `^-?\d+(\.\d+)?$` after trim. No thousands separators, no currency symbols, no exponent. Parsed straight to `Decimal`. Text fields trimmed; `ticker` and `type` and `currency` upper-cased.

| type | ticker | quantity | price | currency | amount | fees | Effect |
|---|---|---|---|---|---|---|---|
| DEPOSIT | empty | empty | empty | SGD | > 0, SGD in | empty or 0 | SGD cash += amount. External flow. |
| WITHDRAW | empty | empty | empty | SGD | > 0, SGD out | empty or 0 | SGD cash -= amount. External flow. |
| FX | currency bought (`USD` or `SGD`) | > 0, amount bought | empty | currency sold | > 0, amount sold | >= 0, in sold currency | cash[currency] -= amount + fees; cash[ticker] += quantity |
| BUY | US ticker | > 0 shares | > 0 USD | USD | > 0, = quantity x price | >= 0 USD | USD cash -= amount + fees; holding += quantity |
| SELL | US ticker | > 0 shares | > 0 USD | USD | > 0, = quantity x price | >= 0 USD | USD cash += amount - fees; holding -= quantity |
| DIVIDEND (full scope 6) | US ticker | optional, shares entitled | optional, gross per share | USD | > 0, gross | >= 0, tax withheld | on the row date: USD cash += amount - fees |

Broker FX rate is implied by the row: SGD per USD = SGD side / USD side. No division is done in the engine except where stated.

### 5.1 Rejection codes and messages

`Rejection = { line: number | null; code: RejectionCode; message: string }`. `line` is the 1-based line in the file, header is line 1. File-level rejections have `line: null`. Messages are exact; `{x}` is substituted. Decimals in messages are printed with `Decimal.toString()`, except `{balance}` which is `toFixed(2)`.

File level (parse stops):
| code | message |
|---|---|
| `empty_file` | `The file has no data rows.` |
| `bad_header` | `The first line must be: date,type,ticker,quantity,price,currency,amount,fees` |
| `too_many_rows` | `The file has more than 10000 rows.` |

Row level (all rows are checked; every failing row gets its first failing check only, checked in this table's order):
| code | message |
|---|---|
| `wrong_column_count` | `Row has {n} columns; expected 8.` |
| `bad_date` | `date must be a real date written as YYYY-MM-DD.` |
| `bad_type` | `type must be one of DEPOSIT, WITHDRAW, FX, BUY, SELL, DIVIDEND.` |
| `bad_currency` | `currency must be SGD or USD.` |
| `bad_number` | `{column} must be a plain number like 1234.56.` |
| `missing_field` | `{column} is required for {type}.` |
| `unexpected_field` | `{column} must be empty for {type}.` |
| `not_positive` | `{column} must be greater than zero.` |
| `negative_fees` | `fees cannot be negative.` |
| `flow_currency` | `DEPOSIT and WITHDRAW must be in SGD.` |
| `trade_currency` | `{type} must be in USD.` |
| `fx_pair` | `FX must convert between SGD and USD: put the currency sold in currency and the currency bought in ticker.` |
| `bad_ticker` | `ticker must be 1 to 10 characters using A to Z, 0 to 9, dot or hyphen.` |
| `amount_mismatch` | `amount {amount} does not equal quantity x price ({quantity} x {price} = {product}).` Tolerance: abs difference <= 0.01. Applies to BUY, SELL, and DIVIDEND when both quantity and price are present. |
| `fees_on_flow` | `fees must be empty or 0 for {type}.` |

Ticker availability (after parse, from `/api/prices`; one rejection listing all, `line: null`, no compute):
| code | message |
|---|---|
| `unsupported_tickers` | `These tickers are not supported yet: {list}.` (list comma-separated, sorted; the Rejections list adds the closing "No results were calculated." line once) |
| `too_many_tickers` | `A file can hold at most 50 different tickers; this one has {n}.` |
| `prices_not_loaded` | `Prices for {list} are not loaded yet. Try again tomorrow.` |

Engine (stateful; the engine stops at the first one to avoid knock-on errors):
| code | message |
|---|---|
| `after_as_of` | `date is after the latest available prices ({asOf}).` |
| `no_market_data` | `No USD/SGD rate on or before {date}.` or `No {ticker} price on or before {date}.` |
| `not_trading_day` | `{ticker} did not trade on {date}.` (BUY or SELL dated on a day with no price bar) |
| `negative_cash` | `{currency} cash would be {balance} at the end of {date}.` |
| `oversell` | `This sells more {ticker} than is held: holding would be {quantity} at the end of {date}.` |
| `dividend_unmatched` (scope 6) | `No {ticker} ex-dividend date in the 90 days up to {date}.` |
| `dividend_duplicate` (scope 6) | `Another DIVIDEND row already matches the {ticker} ex-date {exDate}.` |

`negative_cash` is attached to the last row (in sort order, 6.2) on that date that debits that currency. `oversell` to the last SELL of that ticker on that date.

## 6. Calculation engine

### 6.1 Types (`src/engine/types.ts`)

```ts
import type Decimal from 'decimal.js';
export type Ccy = 'SGD' | 'USD';
export type RowType = 'DEPOSIT' | 'WITHDRAW' | 'FX' | 'BUY' | 'SELL' | 'DIVIDEND';
export type IsoDate = string; // 'YYYY-MM-DD', calendar date, never a timestamp

export interface LedgerRow {
  line: number; date: IsoDate; type: RowType; ticker: string | null;
  quantity: Decimal | null; price: Decimal | null; currency: Ccy;
  amount: Decimal; fees: Decimal; // fees = 0 when empty
}
export interface PriceBar { date: IsoDate; close: Decimal; splitFactor: Decimal; divCash: Decimal } // unadjusted
export type PriceSeries = Record<string, PriceBar[]>; // trading days only, ascending
export interface FxPoint { date: IsoDate; sgdPerUsd: Decimal } // ECB days only, ascending
export type FlowTiming = 'start' | 'end';

export interface ComputeInput {
  ledger: LedgerRow[]; prices: PriceSeries; fx: FxPoint[];
  endDate: IsoDate;              // last valuation date, inclusive
  flowTiming?: FlowTiming;       // default 'start'
}
export interface ValuationPoint {
  date: IsoDate;
  valueSgd: Decimal;             // end-of-day value, SGD
  netFlowSgd: Decimal;           // deposits - withdrawals on this date
  netInvestedSgd: Decimal;       // running sum of netFlowSgd (the "money in" line)
  dailyReturn: Decimal;          // r_d, see 6.6
  fxRate: Decimal; fxDate: IsoDate; // rate used and the ECB date it came from (fxDate < date means carried)
  cash: Record<Ccy, Decimal>; holdings: Record<string, Decimal>; // end of day
}
export interface RateResult { value: Decimal; annualised: boolean; days: number }
export type XirrResult =
  | { kind: 'ok'; value: Decimal; annualised: boolean; multipleRoots: boolean }
  | { kind: 'undefined'; reason: 'no_sign_change' | 'no_root_in_range' | 'period_too_short' };
export interface Rejection { line: number | null; code: RejectionCode; message: string }
export type ComputeResult =
  | { ok: true; series: ValuationPoint[]; twr: RateResult; xirr: XirrResult; warnings: Warning[] }
  | { ok: false; rejected: Rejection[] };
export interface Warning { code: 'fx_carried' | 'twr_negative_base' | 'xirr_multiple_roots' | 'dividend_on_ex_date'; date?: IsoDate; message: string }
```
`RejectionCode` is the union of every code in 5.1. Full-scope tasks add optional fields to the `ok: true` branch (`decomposition`, `dividends`, `explanation`); they never change existing fields.

Decimal config (`src/engine/decimal.ts`): `export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN })`. All engine code uses `D`. The engine never rounds; the UI rounds for display (SGD 2 dp, percentages 1 dp in the hero and sentence, 2 dp elsewhere).

### 6.2 Day loop and event order

Valuation runs over **every calendar day** from the first ledger date to `endDate` inclusive. Calendar days (not trading days) keep SGD deposits on US holidays simple and match XIRR's day count.

For each day `d`:
1. **Split.** For each ticker with non-zero holding, if its series has a bar dated exactly `d` with `splitFactor != 1`, holding *= splitFactor. Past rows are never rewritten. Unadjusted closes on and after the ex-date are already on the new basis.
2. **Ex-dividend** (full scope 6, see 10.6).
3. **Ledger rows dated `d`**, stable-sorted by priority then file line: DEPOSIT 1, DIVIDEND 2, FX 3, BUY 4, SELL 4, WITHDRAW 5. Effects per the table in 5.
4. **End-of-day checks**: any cash balance < 0 gives `negative_cash`; any holding < 0 gives `oversell`. Checking at end of day means intraday order inside step 3 never changes the outcome (sell, convert, withdraw on one day is valid). The sort order only decides which row is blamed.
5. **Value**: `V_d = cash.SGD + (cash.USD + sum over tickers of holding_t x close_t(d)) x fx(d)`.

Before the loop: any row dated after `endDate` gives `after_as_of`; any BUY or SELL with no bar dated exactly on its date gives `not_trading_day`.

### 6.3 Dates

- All dates are exchange-local calendar dates as `YYYY-MM-DD` strings. Tiingo returns `2020-08-31T00:00:00.000Z`; keep the first 10 characters and never pass it to `new Date()` for anything except day arithmetic.
- Day arithmetic (`addDays`, `daysBetween`) in `src/shared/dates.ts` uses `Date.UTC` on the parsed parts only.
- CSV dates are taken as given: trade date for trades, the broker's booking date for cash rows.
- US close (16:00 New York) and ECB fixing (16:00 CET) on the same date are combined. Stated on the methodology page.

### 6.4 Holiday carry-forward

`close_t(d)` = close of the latest bar with date <= d. If none exists and the holding is non-zero, `no_market_data`.

### 6.5 FX gap rule

`fx(d)` = `sgdPerUsd` of the latest FX point with date <= d. `fxDate` records which date was used. If `fxDate != d`, the day is flagged; one `fx_carried` warning is emitted per run with the count of carried days (`Exchange rate carried forward on {n} days without an ECB fixing.`). If no FX point <= d exists, `no_market_data`. FX rates are used for valuation only; conversions use the broker amounts in the FX row.

### 6.6 TWR

`F_d` = sum of DEPOSIT amounts - sum of WITHDRAW amounts dated `d`. `V_{-1} = 0`.
- Start of day (default): `r_d = V_d / (V_{d-1} + F_d) - 1`
- End of day (toggle): `r_d = (V_d - F_d) / V_{d-1} - 1`
- Denominator = 0: `r_d = 0` (no capital at risk). Denominator < 0: `r_d = 0` and warning `twr_negative_base` (`TWR skips {date}: withdrawals exceeded the start-of-day value.`).

Cumulative: `TWR = product(1 + r_d) - 1`, in Decimal.
`days = daysBetween(firstLedgerDate, endDate)`. If `days > 365`: annualised `= (1 + TWR)^(365 / days) - 1` (Decimal `pow`), `annualised: true`. Otherwise report the cumulative value, `annualised: false`.

Exported helpers: `twr(series: ValuationPoint[]): Decimal` (cumulative product over `dailyReturn`), `annualise(cumulative: Decimal, days: number): RateResult`.

### 6.7 XIRR

Flows from the investor's side: DEPOSIT `-amount`, WITHDRAW `+amount`, plus terminal `+V_end` dated `endDate`. Same-date flows are summed. `t_i = daysBetween(start, date_i) / Y`, where `T = daysBetween(start, endDate)` and `Y = 365 if T > 365 else T`. So for periods of a year or less the solved rate is directly the cumulative money-weighted return over the period, and the same bracket applies.

Algorithm (`xirr(flows: {date: IsoDate; amount: Decimal}[], endDate: IsoDate): XirrResult` in `src/engine/xirr.ts`):
1. `T == 0`: `undefined / period_too_short`.
2. Ignoring zero flows, all flows the same sign: `undefined / no_sign_change`.
3. Newton from `r0 = 0.10`: `r <- r - f(r)/f'(r)`, `f(r) = sum a_i (1+r)^(-t_i)`. At most 50 iterations. Converged when `|r_new - r_old| < 1e-12` and `-0.99 <= r <= 10`. Stop and fall back if `f'(r) == 0`, the result is not finite, or `r` leaves `[-0.99, 10]`.
4. Fallback: bisection on `[-0.99, 10]` if `f(-0.99)` and `f(10)` differ in sign; stop when width < 1e-12 or 200 iterations. Else `undefined / no_root_in_range`.
5. Multiple-root check: evaluate `f` at `r_k = (k - 99) / 100` for k = 0..1099 and at 10; count sign changes between consecutive non-zero values. More than one: `multipleRoots: true` and warning `xirr_multiple_roots` (`More than one rate between -99% and 1000% balances these cash flows; showing the one found from a 10% starting guess.`).
6. `annualised = T > 365`.

### 6.8 The float exception

The XIRR solver works in float64: flows are converted with `Number(decimal.toString())` and the result returned as `D(r.toString())`. A root-finder on a rate is not a money path, accuracy is 1e-12 against a display of 0.01 percentage points, and decimal.js `pow` with fractional exponents over 1,100 grid points would take seconds. Everything else stays Decimal. Tests compare XIRR to 1e-9.

### 6.9 compute()

`compute(input: ComputeInput): ComputeResult` in `src/engine/compute.ts`: runs 6.2 to 6.7 and returns the series, TWR, XIRR and warnings, or `{ ok: false, rejected }` on the first engine rejection. CSV parsing and ticker availability are separate steps before it (`parseCsv` in `src/shared/csv.ts`; availability in the client data layer).

## 7. Golden cases

All prices and rates below are synthetic test inputs (not real market data), chosen so a person can check every number in a spreadsheet. Fixtures live in `src/engine/fixtures/golden-*.ts`. Assertions on Decimal values use `toFixed(10)` unless stated.

### Golden A: split, FX change, start/end-of-day, short-period XIRR

Prices AAPL: 2020-08-28 close 500 split 1; 2020-08-31 close 130 split 4; 2020-09-01 close 135 split 1. divCash 0.
FX (SGD per USD): 2020-08-28 1.36; 2020-08-31 1.37; 2020-09-01 1.35. endDate 2020-09-01.
```
date,type,ticker,quantity,price,currency,amount,fees
2020-08-28,DEPOSIT,,,,SGD,1400,0
2020-08-28,FX,USD,1000,,SGD,1360,0
2020-08-28,BUY,AAPL,2,500,USD,1000,0
2020-08-31,DEPOSIT,,,,SGD,600,0
2020-09-01,WITHDRAW,,,,SGD,100,0
```
| date | SGD cash | USD cash | AAPL qty | V (SGD) | F | r start | r end |
|---|---|---|---|---|---|---|---|
| 2020-08-28 | 40 | 0 | 2 | 1400 | 1400 | 0 | 0 (V_prev 0) |
| 08-29, 08-30 | 40 | 0 | 2 | 1400 (carried price and rate, fxDate 08-28) | 0 | 0 | 0 |
| 2020-08-31 | 640 | 0 | 8 | 640 + 8x130x1.37 = 2064.8 | 600 | 0.0324 | 0.0462857142857... |
| 2020-09-01 | 540 | 0 | 8 | 540 + 8x135x1.35 = 1998 | -100 | 0.0168973941368... | 0.0160790391321... |

- TWR start, cumulative (4 days, not annualised): **0.0498448697** (exact: 1.0324 x 1998/1964.8 - 1).
- TWR end, cumulative: **0.0631089832**.
- XIRR: flows -1400 (t=0), -600 (t=3), +2098 (t=4), Y = T = 4: **0.0633663606** (cumulative, `annualised: false`).
- Warning `fx_carried` with count 2.

### Golden B: XIRR closed forms and edge cases (call `xirr` directly)

- B1: -1000 on 2020-01-01, +1210 on 2022-01-01 (731 days). XIRR = 1.21^(365/731) - 1 = **0.0998565877**, annualised. `annualise(D(0.21), 731)` returns the same value.
- B2: -100 on 2021-01-01, +230 on 2022-01-01, -132 on 2023-01-01. Exact roots 0.10 and 0.20. Result **0.1** (Newton from 0.10), `multipleRoots: true`.
- B3: -100 on 2021-01-01, -50 on 2021-06-01, 0 on 2022-01-01: `undefined / no_sign_change`.
- B4: -100 on 2021-01-01, +100 on 2021-01-01 (T = 0): `undefined / period_too_short`.
- B5: -100 on 2020-01-01, +100000 on 2021-01-02 (rate far above 1000%): `undefined / no_root_in_range`.
- B6: -1000 on 2021-01-01, +50 on 2022-01-01 (T = 365, so Y = T): Newton from 0.10 jumps below -0.99, bisection returns **-0.95**, `annualised: false`.

### Golden C: dividends (full scope 6)

VOO bars: 2021-03-25 close 360; 2021-03-26 close 362 divCash 1.50 (ex-date); 2021-03-29 362; 2021-03-30 362; 2021-03-31 365. splitFactor 1. FX 1.30 on every ECB day 03-25 to 03-31. endDate 2021-03-31.
Base rows:
```
2021-03-25,DEPOSIT,,,,SGD,1300,0
2021-03-25,FX,USD,1000,,SGD,1300,0
2021-03-25,BUY,VOO,2,360,USD,720,0
```
Entitlement on 03-26: holding at start of day 2 x 1.50 = 3.00 gross, withholding 0.90, net 2.10.
- C1 (pay-date row present): add `2021-03-31,DIVIDEND,VOO,2,1.50,USD,3.00,0.90`. Values: 03-25 1300; 03-26 to 03-30 1305.2; 03-31 1315.73. No warning.
- C2 (no DIVIDEND row): net 2.10 credited on 03-26. Values: 03-25 1300; 03-26 to 03-30 1307.93; 03-31 1315.73. Warning `dividend_on_ex_date` (`{n} dividends were booked on the ex-date because no pay-date row was found.`).
- Both: TWR cumulative **0.0121**, XIRR (Y = T = 6) **0.0121**. Withholding total 0.90 USD.
- C3: base rows plus `2021-03-24,DIVIDEND,VOO,,,USD,3.00,0.90` gives `dividend_unmatched` on that line.
- C4: C1 plus a second identical DIVIDEND row on 2021-04-01 (with a 2021-04-01 bar close 365, endDate 04-01) gives `dividend_duplicate` on the second row.

### Golden D: decomposition (full scope 5, extended by 6)

VOO bars: 2021-06-01 close 100; 2021-06-02 close 110. FX: 06-01 1.30; 06-02 1.40. endDate 06-02.
```
2021-06-01,DEPOSIT,,,,SGD,1400,0
2021-06-01,FX,USD,1050,,SGD,1400,0
2021-06-01,BUY,VOO,10,100,USD,1000,1
```
D1 (divCash 0): V 06-01 = 1049 x 1.30 = 1363.7; V 06-02 = 1149 x 1.40 = 1608.6.
| component (SGD) | 06-01 | 06-02 | total |
|---|---|---|---|
| conversion | -35 (1050 x 1.30 - 1400) | 0 | -35 |
| FX | 0 | 104.9 (1049 x 0.10) | 104.9 |
| dividends | 0 | 0 | 0 |
| local price (residual) | -1.3 (fee) | 140 | 138.7 |
| total gain | -36.3 | 244.9 | 208.6 |
TWR 0.149.

D2 (task 6 added; 06-02 bar divCash 0.50, ex-date, no DIVIDEND row): net 10 x 0.50 x 0.7 = 3.5 USD on 06-02. V 06-02 = 1152.5 x 1.40 = 1613.5. 06-02: FX 104.9, dividends 4.9, local 140, conversion 0. Totals: local 138.7, FX 104.9, conversion -35, dividends 4.9, sum 213.5 = 1613.5 - 1400. Withholding shown separately: 1.5 USD x 1.40 = 2.1 SGD. TWR 0.1525.

### Golden E: adjusted-close comparison (full scope 9)

VOO bars: 2021-03-24 358; 03-25 360; 03-26 362 divCash 1.50; 03-29 362; 03-30 362; 03-31 365. FX 1.30 throughout. endDate 03-31.
```
2021-03-24,DEPOSIT,,,,SGD,1300,0
2021-03-24,FX,USD,1000,,SGD,1300,0
2021-03-24,BUY,VOO,2,358,USD,716,0
2021-03-25,DEPOSIT,,,,SGD,1300,0
```
Adjusted close (10.9 formula): factor before ex-date = 1 - 1.50/360; 03-24 = 356.508333..., 03-25 = 358.5; from 03-26 equal to close.
- Raw-price TWR: **0.00805** (exact).
- Adjusted-close TWR: **0.0065440791**. Difference -0.1506 percentage points.

### Golden F: benchmark with the same flows (full scope 12)

Benchmark VOO bars: 2021-05-28 100; 2021-06-01 100; 2021-06-02 110. FX 1.30 on all three. endDate 06-02.
User ledger: `2021-06-01,DEPOSIT,,,,SGD,1300,0` and `2021-06-02,WITHDRAW,,,,SGD,143,0` (user holds only cash; irrelevant to the benchmark).
Shadow ledger under start-of-day timing (prices and rate from the last date strictly before the flow date): 06-01 buy 10 VOO at 100 (1000 USD from 1300 SGD at 1.30); 06-02 sell 1.1 VOO at 100 (110 USD, 143 SGD). End value 8.9 x 110 x 1.30 = **1272.7**. Benchmark TWR **0.10**. Benchmark XIRR (Y = T = 1) **0.089**.

## 8. Sample portfolio

Rule (the CSV itself is generated once by `scripts/make-sample.ts` from the committed market fixture, then committed as `src/sample/sample-ledger.csv` and never regenerated silently):
- For each month from 2019-01 to 2025-06 (78 months), the date is the first date in the month that is both a VOO trading day and an ECB fixing day.
- On that date, three rows:
  1. `DEPOSIT` SGD 1000.
  2. `FX` selling SGD 1000, buying USD `floor_to_cent(1000 / brokerRate)`, where `brokerRate = round_half_even(ECB sgdPerUsd x 1.002, 4 dp)`. Fees 0. This creates a small, realistic conversion cost.
  3. `BUY` of `VOO` in odd months (Jan, Mar, ...) and `AAPL` in even months: `quantity = floor((USD cash after the FX row) / close)`, `price = close`, `amount = quantity x close`, fees 0. Leftover USD stays as cash and earns FX return.
- `endDate` for the sample is fixed at **2025-06-30**, so published numbers never drift and match the verification.
- No DIVIDEND rows. Once full scope 6 lands, dividends come from Tiingo `divCash` and are booked on the ex-date with the `dividend_on_ex_date` warning (documented on the methodology page).
- Crosses the AAPL 4:1 split, ex-date 2020-08-31.

Market fixture: `src/engine/fixtures/sample-market.json` = VOO and AAPL bars and USD/SGD points from 2018-01-01 to 2025-06-30, in the API's string format (9.2). Produced by `scripts/fetch-fixture.ts` with Owen's Tiingo key from `.dev.vars`. See Open question 2 about committing it.

Tests on the sample (no hand-worked totals; those come from verification):
- `compute` returns `ok: true` with `daysBetween(firstSampleDate, 2025-06-30) + 1` series points (2,372 if the first date is 2019-01-02).
- AAPL holding at the end of 2020-08-31 equals 4 x the holding at the end of 2020-08-30 (the August buy is on 2020-08-03 and September is a VOO month, so no AAPL trade falls on 08-31).
- Split check without the engine's split code path being trusted: one AAPL share bought 2020-08-03 and held to 2020-09-30 with FX fixed at 1, TWR equals `4 x close(2020-09-30) / close(2020-08-03) - 1` (this is the MVP "adjusted-close comparison test": raw prices plus split factor equal a split-adjusted price return).

## 9. Data layer (Worker + D1)

### 9.1 D1 schema (`migrations/0001_init.sql`)

```sql
CREATE TABLE tickers (            -- the allowlist
  ticker       TEXT PRIMARY KEY,  -- Tiingo symbol, upper case
  priority     INTEGER NOT NULL DEFAULT 0, -- 1 = sample/benchmark tickers, refreshed first
  last_date    TEXT,              -- latest bar stored, NULL = not backfilled yet
  refreshed_on TEXT,              -- UTC date of the last successful refresh
  added_on     TEXT NOT NULL
);
CREATE TABLE prices (             -- one row per ticker per calendar year
  ticker TEXT NOT NULL,
  year   INTEGER NOT NULL,
  rows   TEXT NOT NULL,           -- JSON: [["2020-08-31","129.04","4.0","0.0"], ...] ascending
  PRIMARY KEY (ticker, year)
) WITHOUT ROWID;
CREATE TABLE fx (
  year INTEGER PRIMARY KEY,
  rows TEXT NOT NULL              -- JSON: [["2020-08-31","1.3612"], ...] SGD per USD, ascending
);
```
Why per-year JSON rows and not one row per day: D1 Free allows about 100,000 rows written per day (verify). One row per day means about 2M rows for the backfill, which is 20 days of quota; per-year rows make it about 8,000. Reads per upload drop by the same factor. Required, not incidental.

Numbers are stored as strings. Tiingo and Frankfurter return JSON numbers; `String(n)` of a parsed JSON number gives back the shortest decimal literal, which is the value the provider sent.

`migrations/0002_allowlist.sql`: `INSERT INTO tickers (ticker, priority, added_on)` for every line of `data/allowlist.txt`, with `priority = 1` for `VOO`, `AAPL`, `VT`, `QQQ`. Generated by a small script or by hand; committed.

### 9.2 API

`GET /api/health` -> `200 {"ok":true}` (scaffold smoke test).

`GET /api/prices?tickers=AAPL,VOO&from=2019-01-02`
- zod (`src/shared/api.ts`): `tickers` 0 to 50 comma-separated (an empty list is valid and returns only FX, with `asOf` = the last FX date), each `^[A-Z0-9.\-]{1,10}$` after upper-casing; `from` a real `YYYY-MM-DD`.
- `400 {"error":"bad_request","message":"<zod issue, first only>"}`.
- `200`:
```json
{
  "asOf": "2025-06-30",
  "prices": { "AAPL": [["2018-01-02","172.26","1.0","0.0"]], "VOO": [] },
  "fx": [["2018-01-02","1.3337"]],
  "unavailable": [{ "ticker": "XYZ", "reason": "not_on_allowlist" }, { "ticker": "ABC", "reason": "no_data_yet" }]
}
```
- Returns year rows with `year >= year(from) - 1` for prices and fx (so a 1 January start still has an earlier rate and close). The client trims nothing; the engine ignores extra dates.
- `asOf` = min(`last_date` over available requested tickers, last fx date). `null` if nothing available.
- Body built by string concatenation of stored `rows` (strip the outer brackets, join with commas), not by `JSON.parse`.
- `Cache-Control: public, max-age=3600`.

`POST /api/ticker-requests` (full scope 8), see 10.8.

All other paths: static assets, SPA fallback to `index.html` (so `/methodology` works).

### 9.3 Cron (`worker/refresh.ts`)

Trigger `0 22,23,0-7 * * *` (10 runs a night, all after the US close). `refresh(env, now: Date, fetchFn = fetch)`, the `fetchFn` parameter exists so tests can pass a stub.

1. `today` = UTC date of `now`.
2. If UTC hour is 22: FX refresh. `from` = last fx date + 1 day, or `2005-01-01` if empty. `GET https://api.frankfurter.dev/v1/{from}..{today}?base=USD&symbols=SGD` (check the current Frankfurter path at implementation time; the older host is `api.frankfurter.app` with `from`/`to` parameters). Merge into year rows.
3. Budget = 45 Tiingo requests for this run.
4. (Full scope 8) queued ticker requests first, see 10.8.
5. `SELECT ticker, last_date FROM tickers WHERE refreshed_on IS NULL OR refreshed_on < ? ORDER BY priority DESC, refreshed_on IS NOT NULL, refreshed_on, ticker LIMIT ?` with `today` and the remaining budget.
6. For each, one at a time: `GET https://api.tiingo.com/tiingo/daily/{ticker}/prices?startDate={last_date + 1 day or 2005-01-01}` with header `Authorization: Token ${TIINGO_TOKEN}`. Map each item to `[date.slice(0,10), String(close), String(splitFactor), String(divCash)]`. Group by year, append to existing year rows (only dates > last_date), write with `DB.batch`. Update `last_date`, `refreshed_on = today`.
7. Empty response: set `refreshed_on = today` only. HTTP 404: log and set `refreshed_on = today`. HTTP 429 or 5xx or network error: log and stop the run (remaining tickers keep their old data and are served with an older `asOf`).

Capacity: 10 runs x 45 = 450 requests a night, under 50 an hour, under 1,000 a day. Initial backfill of the allowlist happens through the same cron during the first night; sample tickers go first by priority. Local dev: `npm run preview` then `curl "http://localhost:8787/__scheduled?cron=0+22+*+*+*"`.

### 9.4 Allowlist mechanism

The `tickers` table is the allowlist. The client parses the CSV, collects distinct BUY/SELL/DIVIDEND tickers, calls `/api/prices`; if `unavailable` is non-empty it shows `unsupported_tickers` and/or `prices_not_loaded` and computes nothing. The user's tickers and dates go to the Worker; the ledger never does.

## 10. Client and full-scope features

### 10.1 Landing (MVP)
Bundled `src/sample/sample-ledger.csv` (Vite `?raw` import), `GET /api/prices?tickers=AAPL,VOO&from=2019-01-02`, `compute` with `endDate: 2025-06-30`. Hero: TWR and XIRR, the number line (11.3), the chart (value line, stepped "money in" line from `netInvestedSgd`, small circle markers for FX conversions, arrow markers for withdrawals), the prices "as of" line, the upload button. If `/api/prices` fails, show `Prices could not be loaded. Try again in a minute.` (sample tickers are priority 1, so a cache miss means the Worker or D1 is down).

### 10.2 Upload (MVP)
`<input type="file" accept=".csv,text/csv">` (on phones this opens Files, iCloud, Drive). Flow in `src/app/upload.ts`: `runUpload(text: string, fetchPrices): Promise<UploadOutcome>` = parse -> availability -> `compute` with `endDate = asOf` -> result or rejection list. Rejections render as a list: `Line {line}: {message}` (file-level ones without the prefix), followed by `No results were calculated.` A start/end-of-day toggle recomputes from the same inputs.

### 10.3 Verification (full scope 1)
Manual procedure by Owen in `docs/verification.md`:
1. `node scripts/export-pp.ts` writes `out/pp/` with: `prices-VOO.csv`, `prices-AAPL.csv` (Date, Close; unadjusted), `account-sgd.csv` (deposits, FX debits), `account-usd.csv`, `portfolio.csv` (buys), and `ecb.txt` (the USD/SGD rates used).
2. In Portfolio Performance (record the version): new file, base currency SGD; a deposit account in SGD, one in USD, a securities account; import the CSVs with the documented column mapping; record the AAPL 4:1 split on 2020-08-31 as a split event without adjusting the imported prices (they are unadjusted).
3. Reporting period 2019-01-02 to 2025-06-30. Read TTWROR (annualised, p.a.) and IRR from the Performance view.
4. Write `src/verification.json`: `{ "date": "YYYY-MM-DD", "ppVersion": "x.y.z", "period": ["2019-01-02","2025-06-30"], "pp": { "ttwrorPa": "0.xxxx", "irr": "0.xxxx" }, "flowTiming": "start" | "end", "tolerancePp": "0.01" }`.
5. A vitest test computes the sample and asserts `|ours - pp| <= 0.0001` (0.01 pp) for both numbers, using the `flowTiming` recorded. If PP matches only under end-of-day timing, record that and say so on the methodology page.
UI: the badge `Matches Portfolio Performance {ppVersion} to 0.01 points (checked {date})` under the hero numbers, linking to the methodology section. Shown only if `verification.json` exists and the test passes (the test gates CI). Re-run after dividends land (full scope 6), because the sample numbers change.

### 10.4 Methodology page (full scope 2)
Route `/methodology` chosen by `location.pathname` in `App.tsx` (no router library). Sections, each a heading with short plain text; numbers in the text are generated from constants, not typed:
1. The two numbers: TWR measures the strategy independent of deposit timing; XIRR measures what the investor earned including timing. GIPS 2020 prefers TWR and allows money-weighted returns in some cases (do not write "GIPS requires TWR").
2. Cash flows: only SGD DEPOSIT and WITHDRAW cross the boundary. FX, trades, dividends are internal.
3. Flow timing: start of day by default, both formulas from 6.6, the toggle.
4. Daily valuation formula from 6.2 step 5, calendar days.
5. Dates: exchange-local calendar dates, US close and ECB fixing on the same date.
6. Prices: unadjusted close from Tiingo, splits applied on the ex-date, holiday carry-forward.
7. Exchange rates: ECB reference via Frankfurter; USD/SGD is a cross rate through EUR fixed about 16:00 CET on TARGET business days; carried forward on other days and flagged; conversions use the broker's rate from the file; conversion cost formula (10.5); the cross-rate caveat (the reference rate is itself a computed cross, so the conversion-cost figure is approximate).
8. Dividends (once 6 ships): 10.6 rules, 30% US withholding for Singapore residents, ex-date fallback.
9. Annualising: only for periods over 365 days, 365-day year; shorter periods show the cumulative figure.
10. XIRR method: 6.7 in words.
11. Decomposition definitions (once 5 ships).
12. Why raw prices (once 9 ships).
13. Verification result (once 1 ships).
14. Out of scope list (section 2).
15. Golden tests: links to `src/engine/*.test.ts` on GitHub (repo URL is a constant; see Open question 13).

### 10.5 FX and conversion-cost decomposition (full scope 5)
`decompose(series, ledger, fx): Decomposition` in `src/engine/decompose.ts`, attached to the result as `decomposition`. All amounts in SGD, summed over the period. Per day `d`, with `X_d` = USD cash + sum holding x close at end of day d (USD), `f_d` = fx(d):
- `fx_d = X_{d-1} x (f_d - f_{d-1})` (FX effect on what was held at the start of the day; `X_{-1} = 0`).
- `conversion_d = sum over FX rows on d of (SGD value received - SGD value given)`, valued at `f_d`: SGD to USD row: `quantity x f_d - (amount + fees)`; USD to SGD row: `quantity - (amount + fees) x f_d`. Negative is a cost. Shown as "Conversion cost" with the sign flipped.
- `dividends_d` (after 6) = net USD dividend cash credited on d x `f_d`.
- `local_d = (V_d - V_{d-1} - F_d) - fx_d - conversion_d - dividends_d`. This residual is the local price effect and includes trade fees and the difference between trade price and close.
- Output: `{ local, fx, conversionCost, dividends, withholding, totalGain }` with `totalGain = V_end - sum(F)` and `local + fx - conversionCost + dividends = totalGain` exactly.
Reported in SGD amounts, not percentage points: an exact multi-period percentage attribution needs a linking method, which is complexity this product does not need (Open question 7). The proposal's single-asset identity `(1 + local) x (1 + FX) - 1` is shown on the methodology page as the reason FX and price effects interact.
UI: stacked rows (label left, amount right), not a table.

### 10.6 Dividends with 30% withholding (full scope 6)
- Entitlement: on a bar with `divCash > 0` (the ex-date), for a ticker with holding > 0 at that point of the day (after step 1 splits, before any rows), `gross = holding x divCash`, `withheld = gross x 0.30`, `net = gross - withheld`. `US_WITHHOLDING = D('0.30')` constant.
- Matching (pre-pass before the day loop): process DIVIDEND rows in date order; each matches the latest unmatched entitlement for the same ticker with `exDate <= row.date` and `daysBetween(exDate, row.date) <= 90`. No candidate: `dividend_unmatched`. Candidate already matched by another row: `dividend_duplicate`. Matching needs the entitlements, which need holdings, so the pre-pass runs a holdings-only pass (splits and BUY/SELL rows) first.
- Cash: a matched entitlement credits `amount - fees` from the row on the row date (the broker's real numbers win). An unmatched entitlement credits `net` on the ex-date and adds to the `dividend_on_ex_date` warning count.
- No dividend receivable is carried between ex-date and pay date. The value dips on the ex-date and recovers on the pay date. This matches how Portfolio Performance books dividends (on the date entered) and keeps the engine simple; Open question 6.
- Result field `dividends: { date, ticker, exDate, gross, withheld, net, source: 'row' | 'ex_date' }[]`.

### 10.7 Explanation sentence (full scope 7)
`explainGap(input): string` in `src/engine/explain.ts`. Inputs: TWR, XIRR (both the reported values, so both annualised or both cumulative), `yearReturns: {year, twr}[]` (TWR chained within each calendar year from `dailyReturn`; only years with at least 90 days in the series), deposits `{date, amount}[]`. `gap = xirr - twr` in percentage points. Formatting: shares as whole percent, returns 1 dp, years as numbers. First matching rule wins:
1. XIRR undefined, reason `no_sign_change`: `XIRR cannot be calculated because the cash flows never change sign.`
2. XIRR undefined, reason `no_root_in_range`: `XIRR cannot be calculated because no rate between -99% and 1000% balances the cash flows.`
3. XIRR undefined, reason `period_too_short`: `XIRR needs at least two different dates.`
4. `|gap| < 0.5`: `TWR and XIRR are within 0.5 percentage points, so the timing of your deposits made little difference.`
5. `gap < 0`, worst year W with `twr < 0`, share of deposits dated before 1 January of W >= 50%: `XIRR is lower than TWR because {share}% of your deposits arrived before the {W} fall of {abs(twr)}%.`
6. `gap < 0`, best year B with `twr > 0`, share dated after 31 December of B >= 50%: `XIRR is lower than TWR because {share}% of your deposits arrived after {B}, the strongest year (+{twr}%).`
7. `gap < 0`: `XIRR is lower than TWR because more of your money was invested in the weaker periods than in the stronger ones.`
8. `gap > 0`, best year B with `twr > 0`, share before 1 January of B >= 50%: `XIRR is higher than TWR because {share}% of your deposits arrived before the {B} gain of {twr}%.`
9. `gap > 0`, worst year W with `twr < 0`, share after 31 December of W >= 50%: `XIRR is higher than TWR because {share}% of your deposits arrived after the {W} fall of {abs(twr)}%.`
10. `gap > 0`: `XIRR is higher than TWR because more of your money was invested in the stronger periods than in the weaker ones.`
Share = sum of DEPOSIT amounts in the window / sum of all DEPOSIT amounts; withdrawals ignored. Ties for best/worst year: earliest year.

### 10.8 Ticker request queue (full scope 8)
`migrations/0003_ticker_requests.sql`:
```sql
CREATE TABLE ticker_requests (
  ticker TEXT PRIMARY KEY, requested_on TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','added','not_found')),
  resolved_on TEXT
);
```
`POST /api/ticker-requests` body `{ "tickers": ["XYZ"] }` (1 to 10, same ticker regex). Response `200 { "results": [{ "ticker": "XYZ", "status": "queued" | "already_queued" | "already_available" | "limit_reached" }], "availableFrom": "2026-11-01" | null }`. Monthly cap: `MONTHLY_NEW_TICKERS = 90` requests with status `queued` or `added` and `requested_on` in the current UTC month. When reached: `limit_reached`, `availableFrom` = first day of next month, UI text `Monthly ticker limit reached. Requests open again on {d MMMM yyyy}.` Otherwise UI text `Requested. New tickers usually load overnight.`
Cron step 4: oldest `queued` first, within the budget: fetch prices from `2005-01-01`; 404 -> `not_found`; success -> insert into `tickers` (priority 0), write prices, status `added`.
Why 90 not 100: Tiingo free counts unique symbols per month (about 500, verify); 400 refreshed allowlist tickers plus 90 leaves 10 spare.

### 10.9 "Why raw prices" panel (full scope 9)
`adjustedCloseTwr(input: ComputeInput): Decimal` in `src/engine/adjusted.ts`: builds an adjusted series per ticker, CRSP style, walking backwards: for a bar at date t, `adj_t = close_t x product over later events of (1 / splitFactor_e) and (1 - divCash_e / close_{e-1})` where `close_{e-1}` is the close of the bar before the ex-date. Then runs `compute` with `close = adj`, `splitFactor = 1`, `divCash` unchanged, and each BUY/SELL quantity multiplied by the product of later split factors (today's share basis). Dividends still land in cash. Panel copy: `Valuing your shares with adjusted close would give a TWR of {a} instead of {b}, a difference of {pp} percentage points. Adjusted close rewrites past prices to include later dividends and splits. That is right for one buy-and-hold position, but once money is added over time it values earlier holdings at prices that never traded.` Golden E pins it.

### 10.10 Tiger and moomoo importers (full scope 10)
Same interface as IBKR (10.11). Blocked until Owen supplies a real, anonymised export from each broker. No format is specified here because none is known reliably.

### 10.11 IBKR importer (full scope 3)
`importIbkr(text: string): { rows: string; rejected: Rejection[] }` in `src/importers/ibkr.ts` returns canonical CSV text, which then goes through `parseCsv` like any upload. Detection: first line starts with `Statement,Header,`. Format (from memory of IBKR Activity Statement CSV; **needs a real export from Owen before this task starts**): every line is `Section,Header|Data|SubTotal|Total,...`; a `Header` line names the columns for the `Data` lines that follow in the same section. Sections read:
- `Trades`, rows with `Asset Category = Stocks` and `DataDiscriminator = Order`: `Symbol`, `Date/Time` (`"2020-08-28, 10:15:32"`, take the date part), `Quantity` (negative = SELL), `T. Price`, `Proceeds`, `Comm/Fee`, `Currency`. -> BUY/SELL with `amount = abs(Proceeds)`, `fees = abs(Comm/Fee)`.
- `Trades`, `Asset Category = Forex`, `Symbol = USD.SGD`: `Quantity` (USD, positive = bought USD), `Proceeds` (SGD), `Comm in USD` or similar commission column. -> FX row.
- `Deposits & Withdrawals`: `Currency`, `Settle Date`, `Amount` -> DEPOSIT/WITHDRAW; non-SGD rows rejected with `flow_currency`.
- `Dividends` and `Withholding Tax`: matched by date and the symbol at the start of `Description` -> DIVIDEND (amount = gross, fees = abs(withholding)).
- `Corporate Actions`: ignored (splits come from Tiingo).
Ignored: all other sections, `SubTotal` and `Total` lines. Open questions: time zone of `Date/Time`, the forex commission column name, and whether FX conversions appear in `Trades` for Owen's account type.

### 10.12 Device-saved ledger (full scope 4)
After a successful upload, store `{ version: 1, csv: string, fileName: string, savedAt: IsoDate }` in `localStorage` under `honest-returns:ledger:v1`, and show `Saved on this device only. Clearing browser data removes it.` with a `Remove saved file` button. On load, if present and valid, run `runUpload` on it with fresh prices and show `Your saved file ({fileName})` above the sample. Helpers take a `Storage`-shaped argument so tests can pass a fake.

### 10.13 Web manifest (full scope 11)
`public/manifest.webmanifest`: `name` "Honest Returns", `short_name` "Honest Returns", `start_url` "/", `display` "standalone", `background_color` = Paper, `theme_color` = Graphite, icons 192 and 512 PNG. Linked from `index.html`. No service worker.

### 10.14 Benchmark with the same cash flows (full scope 12)
`benchmark(input: ComputeInput, ticker: string): ComputeResult` in `src/engine/benchmark.ts`. Builds a shadow ledger: for each DEPOSIT, convert at the reference rate with no cost and buy fractional shares of `ticker`; for each WITHDRAW, sell enough shares and convert back. Under start-of-day timing, the shadow uses the close and rate from the last date strictly before the flow date; under end-of-day timing, from the flow date (carry-forward if none). Quantities are exact Decimal divisions. Dividends apply as in 10.6 (ex-date path). If a withdrawal exceeds the shadow value, the benchmark is not shown: `The benchmark ran out of money on {date}.` Choices: VOO (default), VT, QQQ, all priority 1. UI: a select and the benchmark's TWR, XIRR and value line on the chart. Golden F pins it.

## 11. Design plan (frontend-design, two passes)

Subject: performance reporting for Singapore retail investors with US holdings. Audience: those investors, and finance-tech hiring managers checking rigour in two minutes. Primary job: TWR and XIRR for the sample, and the gap between them understood without a click. This is its own product; it does not reuse Owen's portfolio site (mocha, cream, caramel, Fraunces, IBM Plex).

### 11.1 Pass 1 (first draft)
- Concept: "the checked working paper": a calculation set out so it can be audited, like an accountant's pencil-marked statement.
- Colour: white paper, blue-black ink, blue pencil for TWR, red pencil for XIRR, yellow highlighter for the gap.
- Type: a grotesk for everything plus a monospace for figures.
- Layout: hero with two big numbers and small labels, thin rules between sections, cards for flows.

### 11.2 Review against generic defaults, and revisions
- Red pencil for XIRR: red reads as a loss in finance. Changed to ledger green.
- Monospace for figures matches default 5 (monospace data labels). Changed to tabular lining figures in the grotesk.
- "Two big numbers with small labels" is the default hero treatment. Kept the two numbers (the brief requires them) but the bold element is the **number line** that plots both on one scale and highlights the gap. The numbers sit on the line, not in tiles.
- Thin rules between sections drift toward the broadsheet default (3). Removed; sections are separated by space only. Rules appear only inside the chart grid.
- Cards for flows match the SaaS-card kit (4). Changed to plain stacked rows with no border, shadow or radius. The proposal's "flows as cards" is met by stacking, not by boxes.
- Blue-black ink near `#111` would match default 5 (tinted near-black). Changed to a named graphite with a visible green-grey cast, chosen to sit on the ruled-pad paper.
- Plain white paper is generic. Changed to the pale green-grey of an accountant's columnar pad, which is cool (not the warm cream of default 1) and specific to bookkeeping.
- Checked and kept: no ALL-CAPS eyebrows, no middle-dot meta strings, no "→" on buttons, no gradients, no numbered section markers (sections are not a sequence).

### 11.3 Final tokens

Superseded by 11b for colour, scale and layout. Kept as the record of the first light theme.

| Token | Hex | Role |
|---|---|---|
| Paper | `#EEF2EC` | page background (columnar-pad green-grey) |
| Graphite | `#1E2A2F` | text, value line on the chart |
| Ruling | `#BFCBC2` | chart grid and the number-line axis only (1.5:1, decorative; input borders use Graphite) |
| Pencil blue | `#2457A6` | TWR: number, marker, label |
| Ledger green | `#1D6B50` | XIRR: number, marker, label |
| Highlighter | `#F2DC4E` | the gap band on the number line and nowhere else |

Contrast on Paper (computed): Graphite 13.0:1, Pencil blue 6.2:1, Ledger green 5.7:1, all pass AA for text; Graphite on Highlighter 10.6:1. Colour is never the only signal: TWR and XIRR are always labelled in words next to their marks; negative numbers carry a minus sign and the word "loss" in sentences.

Typefaces (Google Fonts, self-hosted woff2, `font-display: swap`):
- **Archivo** (variable, width 62 to 125, weight 100 to 900): all UI text, headings, and all figures with `font-variant-numeric: tabular-nums lining-nums`. Hero numbers in Archivo width 75, weight 700, so two numbers fit side by side at 360 px. Headings at width 100, weight 600.
- **Source Serif 4** (variable, optical size): long-form text only, i.e. the methodology page body and the explanation sentence. Line height 1.6 for serif, 1.45 for sans.
- Scale (modular, ratio 1.25, base 16 px mobile / 17 px desktop): 13, 16, 20, 25, 31, 39, and hero 56 mobile / 72 desktop. Line length under 70 characters for prose.

### 11.4 Layout

Mobile, 360 px, one column, 16 px side margins, everything left-aligned:
```
+----------------------------------+
| Honest Returns       Methodology |
|                                  |
| A Singapore investor put SGD     |
| 1,000 a month into VOO and AAPL, |
| January 2019 to June 2025.       |
|                                  |
| TWR (a)          XIRR (b)        |
| +14.2%           +11.8%          |   Archivo 56/75 wdth; blue / green
| a year           a year          |
|                                  |
| 0%     5%     10%  [XIRR####TWR] |   number line, gap band in highlighter
|                    2.4 points    |
|                                  |
| XIRR is lower than TWR because   |   Source Serif 4, explanation (scope 7)
| 85% of your deposits arrived     |
| after 2019, the strongest year.  |
|                                  |
| Matches Portfolio Performance... |   badge (scope 1)
|                                  |
| [ chart: value line (graphite),  |   lightweight-charts, touch crosshair
|   money-in steps (dashed),       |   readout above the chart on touch
|   FX dots, withdrawal arrows ]   |
| Prices as of 30 Jun 2025 (c)     |
|                                  |
| Where the gain came from         |   scope 5: stacked rows
| Price               +SGD 21,410  |
| Exchange rate        -SGD 1,204  |
| Conversion cost        -SGD 312  |
| Dividends after tax  +SGD 2,101  |
|                                  |
| [ Check your own broker file ]   |   file input styled as a button
| (a) (b) (c) conventions, linked  |
+----------------------------------+
```
Desktop (>= 960 px), max content width 1120 px, two columns 5/7, left-aligned:
```
+------------------------------------------------------------------------+
| Honest Returns                                            Methodology  |
|                                                                        |
| A Singapore investor put SGD 1,000 a     [ chart, 7 columns wide,      |
| month into VOO and AAPL, Jan 2019 to       value line, money-in steps, |
| Jun 2025.                                  markers, crosshair readout ]|
|                                                                        |
| TWR (a)            XIRR (b)               Prices as of 30 Jun 2025 (c) |
| +14.2% a year      +11.8% a year                                       |
| [0% ---- number line ---- XIRR####TWR]   Where the gain came from      |
|                      2.4 points          Price ............ +SGD 21,410|
|                                          Exchange rate ..... -SGD 1,204|
| XIRR is lower than TWR because ...       ...                           |
| Matches Portfolio Performance ...                                      |
| [ Check your own broker file ]           Benchmark: [VOO v]  (scope 12)|
+------------------------------------------------------------------------+
```
Alignment: everything left-aligned; figures in rows right-aligned on tabular numerals so decimal points line up. Nothing centred except the number-line labels over their marks.

Number line: tick step is the smallest of 5, 10, 20, 25, 50, 100 percentage points that keeps the line to at most 7 ticks, so the labels stay apart at 360 px (ranges up to 30 points keep a step of 5); scale from `floor(min(0, twr, xirr) / step) x step` to `ceil(max(0, twr, xirr) / step) x step`, ticks every step. TWR and XIRR marks as 2 px vertical strokes in their colours with their labels; the highlighter band between them; the gap labelled `{n} points` below.

### 11.5 Principles
1. The gap is the hero. The number line is the one bold element; everything else is graphite on paper.
2. Every figure cites its convention. Small superscript letters on the hero numbers and the "as of" line link to the methodology section that defines them. These are references, not a sequence.
3. Plain words. "a year", "your deposits", "Check your own broker file". First use of each acronym is spelled out on the methodology page.
4. One motion moment: on first load the highlighter band grows from the TWR mark to the XIRR mark over 400 ms. Off under `prefers-reduced-motion`. No other entrance animation.
5. Quality floor: works at 360 px, visible focus ring (2 px Pencil blue outline, 2 px offset), tap targets at least 44 px, the chart has an `aria-label` summarising start value, end value and money in.

Copy rules: sentence case, no em dashes, buttons say what happens (`Check your own broker file`, `Remove saved file`, `Request these tickers`), errors say what is wrong and how to fix it, no apologies.

## 11b Design pass (2026-10-24)

Brief from Owen: the light page is too plain. Take the feel of a dark fintech template (dark, confident, high contrast, bold type, layered) without its tropes (3D coins, phones, stock illustrations, gradient blobs, identical card grids). Revision from Owen during the pass: no near-black ground with an acid-green or neon accent, because that pairing is the most common fintech template look. The page must still read as credible performance reporting.

### 11b.1 Research (what to borrow, one line each)
- Bloomberg Terminal: a warm accent (amber) on a dark ground has read as "serious market data" for 40 years; borrow a warm metal accent for the one thing that matters, not a neon.
- Robinhood 2024 identity: a neutral base with one purposeful accent, plus an accessible-colour setting; borrow "one accent, used in one place" and never colour as the only signal.
- Stripe dark sections: dark bands in a tinted navy, not black, with a lighter surface layered on top; borrow a tinted ground and a single raised surface one step lighter.
- Datawrapper on chart backgrounds (FT pink as the example): a tinted, desaturated chart ground becomes a recognisable identity; borrow a tinted panel for the chart.
- EU data visualisation guide on dark charts: reverse everything, brighter text, darker grid; borrow a grid only just above the ground.
- Linear product page: the product's own visuals carry the page, no illustrations; borrow "the number line and the chart are the imagery".

### 11b.2 Three directions
| | Ground | Raised | Text | Muted | Accent | Source and why it is not a default |
|---|---|---|---|---|---|---|
| A. Ledger ink (chosen) | `#16131D` | `#221D2B` | `#EEE6D3` | `#ACA291` | `#D9AE52` brass | A bound account ledger: aubergine-black ink, aged ledger paper, brass corner fittings. Fintech templates use neutral black or navy with a cold neon; a warm purple-black with brass is not one of them. |
| B. Passbook | `#0F2621` | `#173630` | `#F2EAD8` | `#A9B8AC` | `#F08F6E` copper-coral | A bank passbook cover in bottle green with cream pages and a copper stamp. Distinct, but XIRR loses its green on a green ground and would need a new hue. |
| C. Night terminal | `#121A21` | `#1B2731` | `#E6ECEF` | `#93A3AE` | `#F2A541` amber | A terminal readout at night (the Bloomberg lineage). Credible, but slate plus amber is the second most common "serious finance" look after black plus green. |

Series hues for A and C: TWR `#8FB4FF` (blue pencil, lifted for dark), XIRR `#7CC9A0` (ledger green, lifted for dark). B would keep TWR `#A9C7FF` and need a non-green XIRR.

Why A: it is the most specific to the subject (a statement of account, written in a ledger), it keeps TWR blue and XIRR green from 11.3 so the meaning carries over, and its accent is the least like the fintech defaults Owen rejected.

### 11b.3 Tokens (direction A)
| Token | Hex | Role |
|---|---|---|
| Ink | `#16131D` | page ground |
| Binding | `#221D2B` | the one raised surface: the chart panel |
| Ledger paper | `#EEE6D3` | text, value line and its area fill |
| Faded | `#ACA291` | secondary text, axis labels, money-in line |
| Brass | `#D9AE52` | the gap band, the gap figure, the primary button, focus rings |
| Pencil blue | `#8FB4FF` | TWR: number, mark, label |
| Ledger green | `#7CC9A0` | XIRR: number, mark, label |
| Rule | `#332C3D` | chart grid and number-line axis only (decorative, not text) |

Contrast (computed, WCAG 2): Ledger paper on Ink 14.8:1, on Binding 13.2:1. Faded 7.3:1 and 6.5:1 (lightened from `#A79D8C` so the chart library draws black, 8.4:1, not white, 2.6:1, on the "Money in" axis label). Brass 8.8:1 and 7.9:1. Pencil blue 8.9:1 and 7.9:1. Ledger green 9.4:1 and 8.4:1. Ink on Brass (button text) 8.8:1. All pass AA, most pass AAA.

Type: keep self-hosted Archivo and Source Serif 4. The opening line is set as a display line in Archivo weight 800, width 100, tight leading (1.05) and -0.02em tracking, as one block (no single accented word). Hero numbers Archivo weight 800 at width 75. Explanation stays in Source Serif 4. Scale: 13, 16, 20, 25, 31, 39, 49; opening line 31 at 360 px, 49 at desktop; hero numbers 56 at 360 px, 96 at desktop.

### 11b.4 Desktop composition (>= 960 px, content 1120 px)
```
+------------------------------------------------------------------------+
| Honest Returns                                            Methodology  |
|                                                                        |
| A Singapore investor put SGD 1,000 a month into VOO                    |  display line, 49 px / 800
| and AAPL, January 2019 to June 2025.                                   |
|                                                                        |
| TWR a                XIRR b                 | XIRR is lower than TWR   |  numbers 96 px; serif aside
| +20.8%               +14.0%                 | because 85% of your ...  |
| a year               a year                 | [Check your own broker]  |
|                                                                        |
| 0%      5%      10%    XIRR [======brass======] TWR      25%           |  full-width number line, 44 px band
|                              6.8 points                                |  brass, 25 px bold
+========================================================================+
|##### Binding panel, full bleed ########################################|
|# 30 Jun 2025: value SGD 123,550.17, money in SGD 78,000.00            #|
|# [ chart 440 px: value as area (paper line, fill fading to Binding),  #|
|#   money in as dashed Faded steps with a small "Money in" label on the line, #|
|#   FX dots, withdrawal arrows, TradingView logo ]                     #|
|# Prices as of 30 Jun 2025 c                                          #|
|# (row reserved for "Where the gain came from", filled by scope 5)    #|
+========================================================================+
```
Layered depth comes from two surface steps (Ink, then Binding) and scale contrast, not shadows or borders. The decomposition row is a grid row inside the Binding panel under the chart; the next phase adds its content there. Nothing is rendered for it now.

### 11b.5 360 px stack
Header; display line (31 px); TWR and XIRR side by side at 56 px; number line full width; explanation (serif); timing toggle and button; then the Binding panel full bleed with readout, chart (300 px) and the as-of line. 16 px gutters, no horizontal scroll.

### 11b.6 Motion
One moment: on load the brass band grows from the TWR mark to the XIRR mark (700 ms, ease-out, 150 ms delay), then the gap figure fades in (250 ms) as it lands. Nothing else animates on load. Under `prefers-reduced-motion: reduce` both are off and shown in their final state.

### 11b.7 Generic defaults checked, and what changed
- Near-black with one acid-green accent (default 2): rejected by Owen; changed to aubergine Ink with Brass.
- Tinted near-black standing in for black (default 5): Ink has a visible purple hue and a name, chosen from the ledger subject, not `#0B0B0B`.
- Big number, small label, gradient accent hero: the two numbers stay (the product requires them), but the signature is the full-width number line; no gradient anywhere except the chart's area fill, which encodes value.
- SaaS card grid with one shadow on everything (default 4): no cards and no shadows; one raised surface, used once, for the chart.
- Fade-and-slide entrance on every section: none; only the gap band moves.
- ALL-CAPS eyebrows, middle-dot meta strings, arrows on buttons, monospace data labels: none. TWR and XIRR are acronyms, not eyebrows.
- One accented word in the headline: not used; the whole opening line gets the display treatment.
- Broadsheet hairlines (default 3): none outside the chart grid and the number-line axis.
- Gradient blobs, 3D coins, phones, stock illustrations: none; the number line and the chart are the only imagery.

## 12. Assumptions
1. The engine runs in the browser; the Worker serves cached data only (section 3).
2. Calendar-day valuation series; non-trading days carry price and rate.
3. Balance and holding checks happen at the end of each day; first engine rejection stops the engine.
4. FX rows: `currency` = sold, `ticker` = bought, `quantity` = amount bought, fees in the sold currency.
5. CSV dates are `YYYY-MM-DD` only; other formats are rejected rather than guessed.
6. The XIRR solver uses float64 (6.8).
7. For periods of 365 days or less, XIRR is solved directly as a cumulative rate (`Y = T`).
8. Sample portfolio: SGD 1,000 a month, broker rate = ECB x 1.002, whole shares, VOO in odd months and AAPL in even months, fixed end date 2025-06-30.
9. Dividends: broker DIVIDEND rows win when present; no receivable between ex-date and pay date.
10. Decomposition is reported in SGD amounts.
11. Backfill starts at 2005-01-01 for prices and FX.
12. Deployment needs Owen's Cloudflare login, so the deploy task is a checklist Owen runs; the driver prepares everything else.
13. The device-saved ledger saves automatically after a successful upload, with a visible notice and a remove button.
14. `npm run dev` uses Vite with the Cloudflare plugin; `wrangler dev` is used for `preview` and cron testing.

## 13. Open questions (for Owen)
1. Compute in the browser (this spec) or on the server as the proposal says? Server compute on Workers Free risks the 10 ms CPU limit; Workers Paid is USD 5 a month.
2. May Tiingo-derived prices be committed to a public repo as test fixtures? Alternative: gitignore the sample fixture and skip the sample tests when it is missing (weaker CI).
3. Confirm the sample rule in Assumption 8, especially the 1.002 broker spread and the fixed end date.
4. Who supplies the 400-ticker allowlist? Default: the driver commits a list built from S&P 100 plus Nasdaq-100 plus the largest US ETFs, and Owen reviews it.
5. Monthly new-ticker cap 90 (spec) or 100 (proposal)?
6. Dividends: no receivable (matches Portfolio Performance) or accrue a receivable from ex-date to pay date (smoother daily series)?
7. Decomposition in SGD amounts (spec) or percentage points (needs a linking method)?
8. The explanation sentence is cut item 7, but it is the clearest way to meet the landing job. Move it into the MVP? The MVP already shows the gap on the number line and the money-in line.
9. Is the end-of-day toggle acceptable as the published convention if Portfolio Performance only matches under it?
10. Benchmark choices VOO, VT, QQQ with VOO as default?
11. IBKR, Tiger and moomoo exports: please supply real, anonymised files.
12. Ticker request abuse: no accounts means anyone can use up the monthly cap. Accept, or add a Cloudflare rate-limit rule?
13. Public GitHub repo URL for the methodology links.
14. Device-saved ledger: automatic save (spec) or opt-in checkbox?

## 14. Risks
- Free-tier numbers (Tiingo 50/hour, 1,000/day, 500 symbols/month; D1 100k rows written/day; Workers 10 ms CPU) are from memory and must be checked against current docs before the cron and schema tasks.
- Tiingo terms (internal use, no persistent storage): accepted by Owen; if the key is revoked the app serves cached data with an old "as of" date.
- Backfill of a 20-year history inside one cron invocation may approach the CPU limit; if so, backfill in year-sized `startDate`/`endDate` windows across runs.
- Matching Portfolio Performance may take days, and its flow-timing convention may differ.
- The ECB cross rate makes the conversion-cost figure approximate.
- `@cloudflare/vitest-plugin` bundles a beta miniflare build; if worker tests fail without a code change, check the plugin version first. Vitest stays on 4.1.x; moving to 5 is allowed but not needed.
- Device storage is lost when browser data is cleared; the page says so.
- Broker export formats change; importers need fixture tests from real exports.

## Checkpoint 1 decisions (2026-10-24, Owen and orchestrator)

Owen decided:
1. The calculation engine runs in the browser. The Worker serves the build, prices, FX and ticker requests only.
11. Owen will supply one real anonymised IBKR activity statement. Tiger and moomoo importers are deferred until exports exist.
13. Public repo is github.com/OwenNyo/honest-returns.

Orchestrator defaults (routine, change only if Owen objects):
2. Commit only synthetic hand-made golden fixtures. Tests that use real Tiingo prices read from a gitignored local fixture generated from the D1 cache and skip when it is absent.
3. Sample rule accepted as written: SGD 1,000 a month, broker rate = ECB x 1.002, whole shares, VOO in odd months, AAPL in even months, end date 2025-06-30.
4. Driver builds the 400-ticker allowlist from the S&P 100, Nasdaq-100 and largest US ETFs; Owen reviews it at the next checkpoint.
5. Monthly new-ticker cap is 90.
6. No dividend receivable between ex-date and pay date, matching Portfolio Performance.
7. Decomposition shown in SGD amounts.
8. The explanation sentence moves into the MVP.
9. Publish the end-of-day convention only if Portfolio Performance matches only under it; decide at the verification task.
10. Benchmarks are VOO (default), VT and QQQ.
12. Ticker requests are capped per client per day with a hashed-IP counter in D1. No Cloudflare rate-limit rule.
14. Device-saved ledger saves automatically, with a one-line notice and a clear button.

Operational notes:
- `.dev.vars` exists with a verified TIINGO_TOKEN and is gitignored.
- Deployment (plan task 12) is a checklist Owen runs; the driver does a dry run only.

Checkpoint 1 addendum (orchestrator): `src/sample/sample-ledger.csv` (about 80 trade rows whose prices come from Tiingo closes) is committed, because it is a ledger of trades, not a price feed, and the landing page needs it. `src/engine/fixtures/sample-market.json` (the full price and FX series) stays gitignored; tests that need it skip when it is absent.

## Task 15 addendum: the real IBKR Activity Statement format (2026-10-24)

Owen supplied a real IBKR Singapore Activity Statement CSV (a year-to-date period statement). It is personal financial data, so it is never committed: the driver copies it to `src/importers/fixtures/ibkr-real.csv` (gitignored) and tests that read it skip when it is absent. The committed fixture `src/importers/fixtures/ibkr-sample.csv` is synthetic, written by the driver with the same sections, quoting and quirks, round numbers and a few tickers. The format written from memory in 10.11 is replaced by the following.

- Every line starts with `<Section>,<Header|Data>,...`. Sections that matter: `Statement` (Period, BaseCurrency), `Trades`, `Deposits & Withdrawals`, `Dividends`, `Withholding Tax`, `Cash Report`, `Mark-to-Market Performance Summary`, `Financial Instrument Information`. `Total` and `SubTotal` data rows are skipped. Fields with commas are double-quoted, for example `"2026-06-23, 12:40:16"`. A section's Header line can appear more than once with different columns (Financial Instrument Information has one header for stocks and another for options); read the header that precedes each data block.
- `Trades,Data,Order,<Asset Category>,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,...`
  - `Stocks`: Quantity positive is a BUY, negative a SELL. `amount` = |Proceeds|, `fees` = |Comm/Fee|, `price` = T. Price, `date` = the date part of Date/Time. Fractional quantities are possible.
  - `Forex` with Symbol `USD.SGD`: an FX row. Quantity is the USD leg (negative means USD sold for SGD), T. Price is SGD per USD, Proceeds is the SGD leg. Map to the canonical FX row (ticker = currency received, quantity = amount received, currency = currency paid, amount = amount paid).
  - `Equity and Index Options`: out of scope. Skip and emit one notice `Options trades were skipped: {n} rows. Results are approximate because option premiums also moved your cash.`
- `Deposits & Withdrawals,Data,Currency,Settle Date,Description,Amount`: SGD positive is DEPOSIT, negative is WITHDRAW. Non-SGD flows are rejected with `flow_currency` as 10.11 says.
- `Dividends,Data,Currency,Date,Description,Amount` and `Withholding Tax,Data,Currency,Date,Description,Amount`: the Description starts with the symbol and ISIN, for example `MSFT(US5949181045) Cash Dividend USD 0.91 per Share (Ordinary Dividend)`. Join dividend and tax rows by symbol and date. Emit DIVIDEND rows with `amount` = gross dividend and `fees` = |withholding|, so the engine uses the broker's actual tax. Task 18 must prefer `fees` on a DIVIDEND row over the 30% assumption when present.
- **Period statements have opening balances.** `Change in NAV` has a Starting Value. Opening positions come from `Mark-to-Market Performance Summary,Data,Stocks,Symbol,Prior Quantity,Current Quantity,Prior Price,...`; opening cash per currency from `Cash Report,Data,Starting Cash,<Currency>,...`. New canonical row type `OPENING`, dated the period start: either `ticker` + `quantity` + `price` (= Prior Price) + `currency` for a position, or `currency` + `amount` for cash. The engine treats the total opening value in SGD as an external inflow on the start date, so TWR and XIRR describe the statement period. Spec 5.1 gains this row type, the parser accepts it, and the engine applies it before any other row that day.
- Symbols on non-US listings (for example an Irish-domiciled ETF listed on LSE in USD) are usually absent from Tiingo and come back as unsupported tickers. Say so on the methodology page.
- The importer reports, per section, how many rows were converted, skipped and rejected, so the user can reconcile against the statement.

## Checkpoint 3 decisions (2026-10-24, Owen)

- Owen's real IBKR statement stays local only (gitignored fixture). The committed importer fixture is synthetic.
- **No storage of user data anywhere.** Uploaded files are parsed and computed in memory in the browser, never uploaded to the server, never written to localStorage, sessionStorage, IndexedDB or caches, and are gone on reload. The only request an upload triggers is `/api/prices` with the ticker list and start date. Plan Task 16 (device-saved ledger) is cancelled; checkpoint 1 decision 14 is void. The upload screen and the methodology page state this rule in one sentence each.
- **Device-saved ledger: still open with Owen** (addendum, 2026-10-24, second round). The plan marks Task 16 cancelled, and the rule above stands until Owen decides otherwise. The share card (15.2) and the PDF statement (15.3) read only the in-memory result. They must work the same whether or not Task 16 comes back, and neither may write to any browser storage. If Task 16 comes back after multi-file combining (15.4), the saved form must hold the whole file set (`{ name, text }[]`), not one file.

## 15. Second-round additions (2026-10-24)

State of the code when this was written: tasks 1 to 12 and 19 are built and deployed. Tasks 13, 14, 15, 17, 18, 20, 21, 23 and 24 are not built. In particular `/methodology` does not exist yet (the SPA fallback renders the landing), `src/importers/ibkr.ts` does not exist, and the `OPENING` row type from the Task 15 addendum is not in `src/engine/types.ts` or `src/shared/csv.ts`.

Existing pieces these additions reuse (paths are real):
- `src/app/data.ts`: `loadSample(fetchFn)` returning `Loaded = ComputeResult & { asOf; ledger }`, `fetchPrices`, `firstDate`.
- `src/app/upload.ts`: `runUpload(text, fetchFn, timing)` returning `UploadOutcome`.
- `src/app/Hero.tsx` (`Hero`), `src/app/NumberLineFigure.tsx` (`NumberLine`), `src/app/numberline.ts` (`numberLineScale`), `src/app/ValueChart.tsx` (`ValueChart`, and the local `cssVar` helper), `src/app/format.ts` (`formatPct`, `formatSgd`, `formatDate`), `src/app/Rejections.tsx`, `src/app/TimingToggle.tsx`, `src/app/UploadButton.tsx` (`Upload`).
- Engine (`src/engine/index.ts`): `compute`, `valueDaily`, `yearlyTwr`, `explainGap`; types `ComputeResult`, `ValuationPoint` (has `cash`, `holdings`, `fxRate`, `netInvestedSgd`), `YearReturn`, `Rejection`, `RejectionCode`.
- Tokens: section 11b.3, implemented as CSS custom properties in `src/app/styles.css` (`--ink`, `--binding`, `--paper`, `--faded`, `--brass`, `--pencil-blue`, `--ledger-green`, `--rule`, `--sans`, `--serif`, the `--step-*` scale).

### 15.1 Information architecture: routes, navbar, the story on Home, the Analyse page

Replaces the single-page layout of 10.1 and 11b.4. The Hero stays as is and becomes the opening scene of Home and the Returns section of Analyse.

#### 15.1.1 Routes

| Path | Page | Content |
|---|---|---|
| `/` | Home | The story of the sample portfolio (15.1.4) |
| `/analyse` | Analyse | Upload, the `Sample` / `Your file` tabs, the full result in sections (15.1.5) |
| `/methodology` | Methodology | Task 14. Until Task 14 ships, this route shows the footnotes a to c (15.3.3) under their anchors `#flow-timing`, `#xirr`, `#prices`, so the superscript links in `Hero` work. |
| anything else | Not found | One line, `This page does not exist.`, and a link `Go to the home page`. |

Routing: a hand-rolled path switch in `src/app/router.ts`, not React Router. Reason: three fixed paths with no parameters fit in about 25 lines, and the plan already chose "no router library" in Task 14. Contents:
- `usePath(): string` reads `location.pathname` and re-renders on `popstate` and on a custom `navigate` event.
- `navigate(to: string)`: `history.pushState`, dispatch the event, scroll to the element named by the hash if there is one, else to the top.
- `Link` component: a plain `<a href>` whose `onClick` calls `navigate` for same-origin paths, unless a modifier key or a non-primary button is used (so open-in-new-tab still works).
- `App.tsx` switches on the path. The Worker already serves `index.html` for every non-API path (`wrangler.jsonc` `not_found_handling: single-page-application`), so a direct load of `/analyse` works with no Worker change.

State: `App` keeps the sample load and the file state above the switch, so moving between Home and Analyse keeps the result in memory. A reload clears it (Checkpoint 3: no storage). The sample is fetched once per page load, whatever the route.

#### 15.1.2 Navbar (`src/app/Navbar.tsx`, replaces `.site-header` in `App.tsx`)

Items, in order: brand `Honest Returns` (a `Link` to `/`), then `Home`, `Analyse`, `Methodology`, `GitHub`. `GitHub` is a plain `<a href="https://github.com/OwenNyo/honest-returns">` with visually hidden text ` (on GitHub)` after it; no icon, no arrow (11.5 copy rules).

Tokens (11b.3): ground Ink, no border, no shadow. Brand in Paper, Archivo 800, `--step-1`. Items in Archivo 600, `--step-0`, colour Faded. Active item: colour Paper, a 2 px Brass underline 6 px below the baseline (`text-decoration: underline 2px; text-underline-offset: 6px; text-decoration-color: var(--brass)`), and `aria-current="page"`. Hover: Paper. Focus: the existing 2 px Brass `:focus-visible` ring. Every item is at least 44 px tall. The navbar is not sticky (the Analyse page has its own sticky section list; two sticky bars would take too much of a 640 px tall phone screen).

Desktop (>= 960 px): one row, 64 px tall, brand left, items right with 32 px gaps.

360 px: two rows, no menu button. Row 1: brand. Row 2: the four items, left-aligned, 20 px gaps. Reason: the four labels measure about 300 px at 16 px Archivo, which fits the 328 px content width, and a menu button would hide four short links behind a tap and need focus handling for an open and closed state.

```
360 px                                 1280 px (content 1120)
+----------------------------------+   +------------------------------------------------------------------------+
| Honest Returns                   |   | Honest Returns              Home   Analyse   Methodology   GitHub     |
| Home  Analyse  Methodology  GitHub|  |                             ----                                       |
| ----                             |   +------------------------------------------------------------------------+
+----------------------------------+    (---- = brass underline under the active item)
```

#### 15.1.3 Loading and empty states (Home and Analyse)

Loading skeleton (`src/app/Skeleton.tsx`), shown while `loadSample` is pending, on both pages in place of the Hero:
- Blocks in the Hero's shape: one display-line block (2 lines at 360 px, 1 line at desktop, 70% width), two number blocks side by side (the `--hero` height), one 44 px number-line bar full width, then the full-bleed Binding panel with a 300 px (mobile) / 440 px (desktop) empty chart area.
- Block colour Binding on Ink; inside the Binding panel, Rule. No shimmer or pulse (11b.6 allows one motion moment, the gap band).
- The container has `aria-busy="true"` and holds visually hidden text `Loading prices.`

Empty state (`src/app/EmptyState.tsx`), shown when `/api/prices` answers with `asOf: null`:
- Heading (Archivo 800, `--display`): `Prices are not loaded yet`
- Body (Source Serif 4, `--step-1`): `Prices load every night after the US market closes, between 6 am and 3 pm Singapore time. Come back after 3 pm Singapore time to see the numbers.` (The cron runs 22:00 to 07:00 UTC, spec 9.3, which is 06:00 to 15:00 SGT.)
- No upload button on this state: an upload would fail with `prices_not_loaded`.
- Interface change: `loadSample` returns `{ kind: 'empty' }` when `body.asOf === null` instead of throwing on `unavailable`. `runUpload` returns `{ kind: 'empty' }` on `asOf === null` instead of throwing (today `src/app/upload.ts` line 41 throws). Network or HTTP failures keep the existing text `Prices could not be loaded. Try again in a minute.`

#### 15.1.4 Home: the story of the sample

A page that reads top to bottom, built only from the sample's `Loaded` result and its ledger. Every number in the copy is generated from the data (no typed figures), formatted with `formatPct`, `formatSgd`, `formatDate`. Scenes are separated by space (`calc(var(--space) * 3)`), not rules or cards. Each scene after the first has an `h2` in Archivo 800 at `--step-4` (desktop) / `--step-3` (360 px) and body copy in Source Serif 4 at `--step-1`, line length under 70 characters. Figures in rows use the stacked-row style of 10.5 (label left, amount right, tabular numerals). No scroll-triggered animation.

Copy direction for every scene: sentence case, plain words, second person only in the call to action, no adjectives about the product, no em dashes. A scene states one fact and why it matters, in at most three sentences.

| # | Scene (h2) | What it says | Data it reads | Visual |
|---|---|---|---|---|
| 1 | (Hero, no h2) | Who the investor is and the two numbers. | `SAMPLE_TITLE`, `twr`, `xirr`, `explanation`, `series` | Existing `Hero` unchanged, including the number line and the chart. Its action is a `Link` button `Check your own broker file` to `/analyse`. |
| 2 | `What they did` | Every month, SGD into the broker, converted to USD, whole shares bought, alternating funds. | count of DEPOSIT rows; total deposited = last `netInvestedSgd`; count of FX rows; BUY count per ticker; first and last ledger date | Stacked rows: `Deposits`, `Money in`, `Conversions to USD`, one row per ticker `Shares bought: VOO`. |
| 3 | `Two numbers, two questions` | TWR answers how the investments did, whatever the timing of deposits. XIRR answers how the investor's money did, including the timing. | `twr`, `xirr` | Two short paragraphs, the first in Pencil blue for the term `TWR`, the second in Ledger green for `XIRR`; the terms only, not the paragraphs. |
| 4 | `Why they differ` | Money arrived steadily, but returns came unevenly by year; the sentence from 10.7 says which way it tipped. | `yearReturns` (`days >= 90`), DEPOSIT sums per calendar year from the ledger, `explanation` | Stacked rows per year: year, TWR that year (`formatPct`, 1 dp), deposits that year (`formatSgd`). The best and worst years carry the words `strongest year` and `weakest year`, not colour alone. Then the `explanation` sentence. |
| 5 | `What the exchange rate did` | Holdings are in USD but the result is in SGD, so the USD/SGD rate moves the result. | `series[0].fxRate`, `series.at(-1).fxRate`, their `fxDate`s; after Task 17, `decomposition` | Before Task 17: one sentence, `USD/SGD went from {a} to {b} over the period.` (4 dp). After Task 17: the decomposition rows from 10.5 (`Price`, `Exchange rate`, `Conversion cost`). |
| 6 | `What dividends added` | Only after Task 18: dividends after the 30% US tax. | `dividends`, `decomposition.dividends`, `decomposition.withholding` | Two rows `Dividends after tax`, `US tax withheld`. The scene is not rendered while `dividends` is absent. |
| 7 | `Why the method matters` | Raw prices with splits applied on the day, and the flow-timing convention, are what make the numbers checkable. | AAPL holding at the end of 2020-08-30 and 2020-08-31 from `series[].holdings`; after Task 21, the adjusted-close TWR | Before Task 21: `On 31 Aug 2020 AAPL split 4 for 1: the holding went from {x} to {y} shares and the price fell by the same factor, so the value did not jump.` plus a `Link` `Read the methodology` to `/methodology`. After Task 21: the 10.9 panel copy. |
| 8 | `Check your own file` | The file is read in this browser and never uploaded. | none | One sentence `Your file is read in this browser and never uploaded or stored.` and a Brass `Link` button `Check your own broker file` to `/analyse`. |

Scenes 5, 6 and 7 change when Tasks 17, 18 and 21 ship; those tasks update the scene in the same commit. Scene text that names VOO, AAPL or the 2020 split is about the sample only; Home never shows a user's file.

#### 15.1.5 Analyse page

Order: page heading `Analyse` (visually hidden; the tabs are the visible start), tabs, file list (15.4, once Task 28 ships), the sections.

Tabs (`src/app/ResultTabs.tsx`): `Sample` and `Your file`, a `role="tablist"` of two `<button role="tab">` with `aria-selected` and `aria-controls`, Left and Right arrow keys move between enabled tabs. `Your file` has `disabled` until a file has been chosen (file state is not `none`); choosing a file selects it. The `Show the sample again` button in `App.tsx` is removed. Selected tab: Paper text with the Brass underline used by the navbar; unselected: Faded. The upload button (`Check your own broker file`) sits in the Returns section actions on both tabs, as now.

Sections, stacked in this order, each a `<section id>` with an `h2`:

| id | h2 | Filled by |
|---|---|---|
| `returns` | `Returns` | Hero (numbers, number line, sentence, chart), timing toggle (file only), upload, share and PDF buttons (Tasks 26, 27) |
| `decomposition` | `Where the gain came from` | Task 17 |
| `dividends` | `Dividends` | Task 18 |
| `benchmark` | `Against a single fund` | Task 24 |
| `raw-prices` | `Why raw prices` | Task 21 |

A section is rendered only when its data exists; no empty headings, no "coming soon". The list of sections is one array in `src/app/sections.ts` (`{ id, title }[]`), and each later task adds its entry, so the order lives in one place. While only `returns` exists, the section list below is not rendered.

Section list (`src/app/SectionList.tsx`), rendered when two or more sections are present:
- Desktop: a sticky bar (`position: sticky; top: 0`), 48 px, on Ink, holding the tabs at the left and the section links at the right, so both stay in reach while scrolling.
- 360 px: tabs are a normal row; below them a sticky 44 px row of section links that scrolls sideways (`overflow-x: auto`, no visible scrollbar on touch), Faded text, Archivo 600 `--step--1`.
- Links are plain `#id` anchors with `scroll-margin-top` on the sections equal to the bar height. No scroll-spy (skipped; add when a section list longer than five makes position hard to tell).

Wireframes, Analyse, with all sections present (later tasks):

```
360 px
+----------------------------------+
| Honest Returns                   |
| Home  Analyse  Methodology  GitHub|
|       -------                    |
| [Sample] [Your file]             |  tabs, Your file greyed until a file is loaded
| Returns  Where the gain  Divid.. |  sticky, scrolls sideways
|                                  |
| A Singapore investor put SGD     |  Hero as in 11b.5
| 1,000 a month into VOO and AAPL..|
| TWR a          XIRR b            |
| +20.8%         +14.0%            |
| [==== number line, brass band ==]|
| XIRR is lower than TWR because.. |
| [Check your own broker file]     |
| [Download image] [Square image]  |  Task 26
| [ ] Include SGD values           |
| [Print or save as PDF]           |  Task 27
|##################################|
|# readout, chart 300 px, as-of c #|
|##################################|
| Where the gain came from         |  h2, Task 17 rows
| Price             +SGD 21,410.00 |
| ...                              |
| Dividends / Against a single     |
| fund / Why raw prices            |
+----------------------------------+

1280 px (content 1120)
+------------------------------------------------------------------------+
| Honest Returns              Home   Analyse   Methodology   GitHub     |
|                                    -------                             |
| [Sample] [Your file]        Returns  Where the gain came from  ...     |  sticky bar
|                                                                        |
| A Singapore investor put SGD 1,000 a month into VOO                    |
| and AAPL, January 2019 to June 2025.                                   |
| TWR a                XIRR b                 | XIRR is lower than TWR   |
| +20.8%               +14.0%                 | because ...              |
|                                             | [Check your own file]    |
|                                             | [Download image] [Square]|
|                                             | [ ] Include SGD values   |
|                                             | [Print or save as PDF]   |
| 0%      5%      10%    XIRR [======brass======] TWR      25%           |
|########################################################################|
|# readout, chart 440 px, Prices as of 30 Jun 2025 c                    #|
|########################################################################|
| Where the gain came from                                               |
| Price ................................................... +SGD 21,410  |
| Dividends ...  Against a single fund ...  Why raw prices ...           |
+------------------------------------------------------------------------+
```

Wireframes, Home:

```
360 px                                  1280 px
+----------------------------------+    +------------------------------------------------------------------------+
| Honest Returns                   |    | Honest Returns           Home   Analyse   Methodology   GitHub        |
| Home  Analyse  Methodology  GitHub|   |                          ----                                          |
| ----                             |    | [Hero exactly as 11b.4, chart panel full bleed]                        |
| [Hero as 11b.5]                  |    |                                                                        |
| [Check your own broker file]     |    | What they did                                                          |
|                                  |    | Every month for six and a half years ...      Deposits ........... 78 |
| What they did                    |    |                                                Money in .. SGD 78,000.00 |
| Every month ...                  |    |                                                Shares bought: VOO ... 41 |
| Deposits                      78 |    |                                                                        |
| Money in           SGD 78,000.00 |    | Two numbers, two questions                                             |
|                                  |    | TWR ... / XIRR ...                                                     |
| Two numbers, two questions       |    |                                                                        |
| ...                              |    | Why they differ                                                        |
| Why they differ                  |    | prose (5 cols)                          2019  +31.2%  SGD 12,000.00   |
| 2019   +31.2%    SGD 12,000.00   |    |                                         2020  ...                      |
| ...                              |    | What the exchange rate did / What dividends added /                    |
| What the exchange rate did       |    | Why the method matters                                                 |
| What dividends added             |    |                                                                        |
| Why the method matters           |    | Check your own file                                                    |
| Check your own file              |    | Your file is read in this browser ...  [Check your own broker file]   |
| [Check your own broker file]     |    +------------------------------------------------------------------------+
+----------------------------------+
```
Desktop scenes 2 to 7 use the 5/7 two-column grid of 11.4 (prose left, rows right); at 360 px they stack.

Incidental complexity: none beyond `router.ts`. Scroll-spy, a menu button and route transitions are deliberately left out.

### 15.2 Shareable result card (PNG, client-side)

Purpose: a picture of the result that can be posted, with nothing private in it by default.

Sizes: 1200 x 630 (link preview shape) and 1080 x 1080 (square). Two buttons in the Returns section actions: `Download image` (1200 x 630) and `Download square image`. One checkbox above them: `Include SGD values` (off by default, not remembered across reloads; no storage).

Contents, always:
- `Honest Returns` (Archivo 800).
- The period: `{formatDate(first series date)} to {formatDate(last series date)}`.
- TWR and XIRR: label, value via `formatPct(…, 1)`, unit `a year` or `in total`, in Pencil blue and Ledger green. If XIRR is undefined: `Cannot be calculated` and no gap band (as `Hero` does).
- The number line: axis in Rule, ticks from `numberLineScale`, the gap band in Brass between the two marks, the marks in their colours, the gap label `{n} points` in Brass.
- The explanation sentence (`result.explanation`) in Source Serif 4, wrapped by `measureText`, at most 3 lines (at the sizes below every rule in 10.7 fits in 3 lines; if a future sentence does not, the font steps down 2 px until it does).
- `honest-returns.owennyowy.workers.dev` in Faded at the bottom.

Contents with `Include SGD values` on: one more line, `Value {formatSgd(last.valueSgd)}, money in {formatSgd(last.netInvestedSgd)}`.

Never included, whatever the toggle: the ticker list or any ticker, any SGD amount unless opted in, the uploaded file name (the download is always named `honest-returns-1200x630.png` or `honest-returns-1080x1080.png`), the sample title or any ledger row. The card is drawn from `{ twr, xirr, explanation, series[0].date, last series point }` only; the drawing function does not receive the ledger.

Drawing: Canvas 2D in `src/app/shareCard.ts`.
- `cardData(result, includeSgd): CardData` (pure) picks the fields above.
- `drawCard(ctx: CanvasRenderingContext2D, data: CardData, size: '1200x630' | '1080x1080', tokens: Tokens): void` draws synchronously.
- `downloadCard(result, size, includeSgd)`: reads the tokens with `cssVar` (moved from `ValueChart.tsx` to `src/app/css.ts`, used by both), waits for fonts, creates an off-DOM `<canvas>` at the exact pixel size (no devicePixelRatio scaling: the output size is the file size), draws, `canvas.toBlob('image/png')`, downloads through a temporary `<a download>` and `URL.createObjectURL`, then revokes the URL.
- Font-loading requirement: canvas text does not redraw when a web font arrives, and `font-display: swap` plus lazy loading means Source Serif 4 is usually not loaded when the button is pressed. `downloadCard` must `await Promise.all([document.fonts.load('800 96px Archivo'), document.fonts.load('600 24px Archivo'), document.fonts.load('400 30px "Source Serif 4"')])` and then check `document.fonts.check(...)` for each. If any is false, nothing is downloaded and the line `The image could not be drawn because the fonts did not load. Try again.` appears under the buttons. A card in a fallback font is never produced.
- Width 75 for the numbers: set `ctx.fontStretch = 'condensed'` where the property exists. Where it does not (older Firefox), the numbers draw at normal width; `drawCard` measures each number and steps the size down until both fit their half of the card, so the layout never overflows.
- Background: the whole card is Ink; the bottom 72 px band (URL and optional SGD line) is Binding. No gradients, no shadows.

Layout (px, 64 margin):
```
1200 x 630                                         1080 x 1080
+----------------------------------------------+   +--------------------------------------+
| Honest Returns            2 Jan 2019 to      |   | Honest Returns                       |
|                           30 Jun 2025        |   | 2 Jan 2019 to 30 Jun 2025            |
| TWR                 XIRR                     |   |                                      |
| +20.8%              +14.0%     (120 px, 800) |   | TWR              XIRR                |
| a year              a year                   |   | +20.8%           +14.0%   (150 px)   |
| 0%   5%   10%  XIRR[=====brass=====]TWR 25%  |   | a year           a year              |
|                    6.8 points                |   | [====== number line, brass ======]   |
| XIRR is lower than TWR because 85% of your   |   |              6.8 points              |
| deposits arrived after 2019, ... (serif 30)  |   | XIRR is lower than TWR because 85%   |
|##############################################|   | of your deposits ... (serif 36)      |
|# honest-returns.owennyowy.workers.dev       #|   |                                      |
|##############################################|   |######################################|
+----------------------------------------------+   |# honest-returns.owennyowy.workers.dev#|
                                                   +--------------------------------------+
```

Testing: `drawCard` is tested in Node with a fake context object that records `fillText` calls and stubs `measureText` (width = 0.5 x font size x characters). No canvas package is added.

Incidental complexity: the fake context in the test, and the font-size step-down loop (needed only because `ctx.fontStretch` is not universal).

### 15.3 One-page PDF statement (client-side, print stylesheet)

#### 15.3.1 Choice

| Option | Size | Real PDF | Text selectable | Fonts | Blocker |
|---|---|---|---|---|---|
| `window.print()` with a print stylesheet and `@page` | 0 KB | yes, through the browser's "Save as PDF" destination | yes | the page's own web fonts | none for desktop Chrome, Safari, Firefox and iOS Safari. In-app browsers (LinkedIn, Instagram) may ignore `window.print()`; accepted, see Risks. |
| jsPDF | about 350 KB minified | yes, direct download | yes | needs the fonts embedded as base64 TTF (Archivo and Source Serif 4 would add about 1 MB) | size; a second layout system |
| pdf-lib | about 500 KB minified | yes, direct download | yes | needs `@pdf-lib/fontkit` to embed fonts | size; every line positioned by hand |

Recommendation: print stylesheet. It needs no dependency and reuses the existing components and fonts. Its cost is that the user picks "Save as PDF" in the print dialog instead of getting a file directly.

#### 15.3.2 Contents (one A4 page, `@page { size: A4; margin: 14mm }`)

In order:
1. `Honest Returns statement`, then `Sample portfolio` or `Your file` (never the file name).
2. Period: `{first series date} to {last series date}`.
3. Headline numbers: TWR and XIRR with units and superscripts a and b, and `Gap: {n} points`.
4. The explanation sentence.
5. The value chart as an image (15.3.4), with the line `Prices as of {formatDate(last series date)}` and superscript c.
6. Conventions: `Deposits and withdrawals counted at the start of the day.` or `... at the end of the day.`, from the current `FlowTiming`.
7. Footnotes a to c, full text (15.3.3).
8. `Generated on {formatDate(today)}` where today is built from the local calendar date parts (`getFullYear`, `getMonth`, `getDate`), not from `toISOString`.
9. `Nothing was stored. Your file was read in this browser and was not uploaded.` For the sample: `Nothing was stored. This statement was built in your browser.`

No ticker list, no ledger rows, no decomposition (until a later task asks for it). SGD amounts appear only on the chart axis and readout, which is the user's own document.

#### 15.3.3 Footnotes a to c (`src/app/footnotes.ts`, exact text)

These constants are the single source for the PDF, the interim `/methodology` route (15.1.1) and, later, the opening sentences of Task 14's sections.

- a (`#flow-timing`): `TWR, time-weighted return. Each day's return is the change in value with that day's deposits and withdrawals taken out, and the daily returns are chained over the period. Deposits and withdrawals count at the {start|end} of the day. Periods over 365 days are annualised with a 365-day year; shorter periods show the total.`
- b (`#xirr`): `XIRR, money-weighted return. The one yearly rate at which your deposits, your withdrawals and the final value balance to zero, using a 365-day year. Solved by Newton's method from 10%, with a bisection fallback between -99% and 1000%. For periods of 365 days or less it is the total return over the period.`
- c (`#prices`): `Prices are unadjusted daily closes from Tiingo, with splits applied on the split date. The USD/SGD rate is the ECB reference rate from Frankfurter. On days without a close or a rate, the last one is carried forward. Values are in SGD at the end of each calendar day.`

#### 15.3.4 Mechanism

- `src/app/PrintStatement.tsx` renders the contents above inside `<section class="print-statement">`. It is in the DOM whenever a result is shown and hidden on screen (`@media screen { .print-statement { display: none } }`). In `@media print`, everything else in `#root` is hidden and only the statement shows.
- Colours in print: section 11.3 light tokens, because dark grounds waste ink and browsers drop backgrounds by default. White page, Graphite `#1E2A2F` text, Pencil blue `#2457A6` TWR, Ledger green `#1D6B50` XIRR, Highlighter `#F2DC4E` gap band, gap figure in Graphite. The statement reuses `NumberLine` by redefining the custom properties inside `.print-statement` under `@media print`.
- Chart image: lightweight-charts draws to canvas in the dark theme. Refactor the chart setup in `ValueChart.tsx` into `buildChart(el: HTMLElement, series, ledger, colors)` (used by `ValueChart` unchanged on screen). The print button builds a second chart in a fixed 1000 x 400 px container placed off screen (`position: fixed; left: -10000px`, not `display: none`, which gives zero size) with the 11.3 light colours, waits one animation frame, calls `chart.takeScreenshot()` (lightweight-charts 5.2 API), stores `canvas.toDataURL('image/png')`, removes the chart.
- Button `Print or save as PDF` (Returns section actions): build the snapshot, render it into the statement's `<img>`, `await img.decode()`, set `document.title` to `Honest Returns statement {today}` (the default PDF file name), call `window.print()`, restore the title on `afterprint`.
- Printing with Ctrl+P without the button prints the same statement; the chart image is there only if the button has made a snapshot for the current result. Accepted.
- Fit on one page: the chart image is 170 mm wide x 68 mm tall; footnotes at 8.5 pt; `break-inside: avoid` on the statement. Verified by print preview in Chrome and Safari.

Incidental complexity: the off-screen second chart (needed because the screen chart is dark), and the `buildChart` refactor that it requires.

### 15.4 Combining several statements

#### 15.4.1 Input

- `UploadButton.tsx`: `<input type="file" multiple>`. `Check your own broker file` replaces the current file set. A second control, `Add another file`, shown on the `Your file` tab once a set exists, appends to it. No per-file remove (skipped; replacing the set is the way out of a wrong choice; add a remove button if users ask).
- File state in `App.tsx` holds `files: { name: string; text: string }[]` instead of one `name` and `text`. The `Your file` tab lists the files under the tabs with their periods, earliest first: `{name}: {from} to {to}`. The Returns heading for more than one file is `Your files ({n})`.
- `runUpload(files: { name: string; text: string }[], fetchFn, timing)` replaces `runUpload(text, …)`. One file behaves exactly as today, including rejection text without a file prefix.

#### 15.4.2 Rules (`src/app/combine.ts`)

Per file, before any merging:
1. Convert: canonical text through `parseCsv`; IBKR text (after Task 15) through `importIbkr`, then `parseCsv`. Any rejection in any file stops the run. With more than one file, each rejection carries the file name.
2. Period: IBKR uses the `Statement,Data,Period` field (format `January 1, 2026 - October 23, 2026`, from the real export). A canonical file uses its first and last row dates.

Across files, files sorted by period start:
3. Overlap: two files overlap when their periods share at least one day. Every pair is checked (O(n²), n is small). The first overlap found rejects the set: code `overlapping_files`, `line: null`, message `{a} and {b} both cover {from} to {to}. Remove one of them.` with `{a}` the earlier-starting file, `{from}` = later start, `{to}` = earlier end.
4. Gap: for IBKR files only (a stated period), when the next file starts more than one day after the previous one ends, the set is allowed and a notice is shown above the result: `No statement covers {from} to {to}, between {a} and {b}. The opening balances of {b} were checked against the earlier files.` Canonical files are not checked for gaps, because their row dates do not say what period they cover (monthly deposits always leave gaps).
5. Merge: rows of all files concatenated in sorted-file order, each row's `line` renumbered to one counter across the set, with `origin: { file: string; line: number }[]` indexed by the new line. `valueDaily` already sorts by date, then row priority, then `line` (`src/engine/valuation.ts`), so same-day order is deterministic. Engine rejections are mapped back through `origin` before display. The engine is not changed.
6. OPENING rows (Task 15 addendum): kept only from the earliest file. Every later file's OPENING rows are removed from the ledger and used only for step 7.
7. Reconciliation, for each later file `f` that had OPENING rows, after `/api/prices` answers and before `compute`: run `valueDaily({ ledger: merged rows dated before f.start, prices, fx, endDate: addDays(f.start, -1), flowTiming })` and read the last `ValuationPoint` (`holdings` already include splits; `cash` per currency).
   - Positions: for every symbol held in either the point or `f`'s OPENING rows, `|ledger - opening| <= 0.0001` shares, else code `reconcile_position`, message `{f} opens with {opening} {symbol}, but the earlier files end with {ledger} {symbol} on {date}.`
   - Cash: for SGD and USD, `|ledger - opening| <= 1.00`, else code `reconcile_cash`, message `{f} opens with {currency} {opening} in cash, but the earlier files end with {currency} {ledger} on {date}.` Figures with `toFixed(2)`, quantities with `toString()`.
   - The first failing check rejects the set. A rejection here wins over any engine rejection, because the engine has not run yet.
   - Tolerances are constants in `combine.ts`: `POSITION_TOLERANCE = D('0.0001')`, `CASH_TOLERANCE = D('1.00')`.

New `RejectionCode` members in `src/engine/types.ts`: `overlapping_files`, `reconcile_position`, `reconcile_cash`. `Rejection` gains an optional `file?: string` (the engine never sets it). `Rejections.tsx` prints `{file}, line {line}: {message}` or `{file}: {message}` when `file` is set.

The 50-ticker limit applies to the merged set. The 10,000-row limit stays per file.

Incidental complexity: the repeated `valueDaily` passes in step 7, one per later IBKR file over the prefix of the ledger. Ceiling: files x days of valuation; about 3x a single pass for six yearly statements. Upgrade path if it gets slow: one `valueDaily` pass that records the points on each boundary date.

### 15.5 Assumptions (second round)

1. Home is about the sample only; a user's file is shown only on Analyse.
2. Home scenes 5, 6 and 7 show a simpler, data-backed version until Tasks 17, 18 and 21 ship.
3. Until Task 14 ships, `/methodology` shows footnotes a to c only.
4. Analyse sections are not rendered until they have data; "placeholders" means reserved entries in `sections.ts`, not visible empty sections.
5. The share card draws in the dark 11b tokens; the PDF prints in the light 11.3 tokens.
6. Canonical files are checked for overlap by row-date range and not checked for gaps.
7. Cash reconciliation tolerance is 1.00 in the currency; positions 0.0001 shares.
8. The PDF never names the file; the card never names the file, tickers or SGD amounts unless the toggle is on.

### 15.6 Open questions (second round)

1. Device-saved ledger: reinstate Task 16 or keep it cancelled? Share card and PDF work either way.
2. IBKR cash reconciliation: the engine does not model interest, data fees or options (Task 15 skips option trades), so a real later statement's starting cash will often differ from the running ledger by more than 1.00. Options: (a) a wider tolerance, (b) reject as specified and tell the user why, (c) book the difference as a labelled adjustment row. Spec takes (b).
3. Canonical gaps: never flagged (spec), or flag gaps over 31 days?
4. Should Home also offer the share card for the sample? Spec: Analyse only.
5. Navbar `Home` item: keep it alongside the brand link (spec), or let the brand be the only home link?
6. PDF: is "Save as PDF in the print dialog" acceptable, or does Owen want a direct download (jsPDF, about 1.3 MB with fonts)?
7. Task 14 should run straight after Task 25, since the navbar links to `/methodology` from every page. Agree?

### 15.7 Risks (second round)

- `window.print()` is ignored or unsupported in some in-app browsers (LinkedIn, Instagram webviews). The button then does nothing visible. Accepted: there is no reliable way to detect it (`afterprint` only fires when the dialog closes). Check on a phone; if it matters, add the line `To save a PDF, open this page in Safari or Chrome.` under the button.
- `ctx.fontStretch` support differs across browsers; the step-down loop keeps the layout correct but the numbers may draw wider.
- `chart.takeScreenshot()` on an off-screen container: confirm the canvas is non-empty in Safari before relying on it.
- Reconciliation depends on the Task 15 importer producing exact Prior Quantity values and Starting Cash per currency.
- The explanation sentence counts only DEPOSIT rows (`compute.ts` line 31); once OPENING rows exist (Task 15), the opening value should count as a deposit for the share figures. Owned by Task 15; flagged here because combined statements make it common.
