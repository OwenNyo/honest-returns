# Honest Returns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Honest Returns: MVP first (tasks 1 to 12, a working app ready to deploy), then the full-scope items in the proposal's cut order (tasks 13 to 24), then the second-round additions (tasks 25 to 30, spec section 15). Every task leaves a working app, so work can stop after any task.

**Architecture:** Single npm package. A pure TypeScript engine (`src/engine`, decimal.js, no I/O) runs in the browser. One Cloudflare Worker (Hono) serves the Vite build as static assets, `/api/*` from D1, and an hourly night cron that refreshes Tiingo prices and Frankfurter rates.

**Tech Stack:** React 19, Vite 8, TypeScript, Hono 4, Cloudflare Workers + D1, wrangler 4, @cloudflare/vite-plugin, decimal.js 10, zod 4, vitest 4.1.x, @cloudflare/vitest-plugin 1.4, lightweight-charts 5.

**Spec:** `docs/superpowers/specs/2026-10-24-honest-returns.md` (section numbers below refer to it). Read sections 5 to 7 before any engine task and section 11 before any UI task.

## Global Constraints

- No floats in money paths. All engine money maths uses `D` from `src/engine/decimal.ts` (precision 40, ROUND_HALF_EVEN). Only the XIRR solver uses float64 (spec 6.8).
- Dates are `YYYY-MM-DD` strings everywhere. Day arithmetic only through `src/shared/dates.ts`.
- `src/engine` imports nothing from `src/app`, `worker`, the network, or storage.
- Never a partial result: any rejection means no numbers on screen.
- Vitest stays at `~4.1`. Do not upgrade to 5 without a reason.
- `.dev.vars`, `.wrangler/`, `dist/`, `node_modules/`, `out/` are gitignored. Never commit the Tiingo key or print it.
- Copy: sentence case, no em dashes, exact strings from the spec where the spec gives them.
- Commits: one line, repo style `feat: ...` / `test: ...` / `chore: ...`; stage files by name; branch `feat/mvp`.
- After each task: `npm test`, `npm run typecheck`, and (from task 10) `npm run build` must pass.

## Review Focus

Inputs the spec implies that are most likely to bite a real user; each has a test in the owning task:
1. A broker CSV with Windows line endings, a UTF-8 BOM, or a trailing blank line: must parse like a clean file (Task 2).
2. A sell, then FX to SGD, then a withdrawal on the same day: valid, because checks are end-of-day (Task 3).
3. A deposit on a US holiday or weekend (no price bar, no ECB rate that day): valued with carried price and rate, no rejection (Task 3).
4. A ledger whose dates go past the latest cached prices: `after_as_of` with the as-of date, not a crash (Task 3, Task 11).
5. A ticker in lower case or with spaces (`" voo "`): normalised to `VOO`, not reported as unsupported (Task 2).

---

## MVP

### Task 1: Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `wrangler.jsonc`, `.gitignore`, `.dev.vars.example`, `index.html`, `src/app/main.tsx`, `src/app/App.tsx`, `worker/index.ts`, `src/engine/decimal.ts`
- Test: `src/engine/smoke.test.ts`, `worker/health.test.ts`

**Interfaces:**
- Produces: `D` (Decimal clone) from `src/engine/decimal.ts`; Hono `app` default export from `worker/index.ts` with `fetch` and `scheduled` (scheduled is a no-op for now); `Env` type `{ DB: D1Database; TIINGO_TOKEN: string }`.

- [ ] **Step 1:** Create `package.json` with scripts `dev: vite`, `build: vite build`, `preview: vite build && wrangler dev`, `deploy: vite build && wrangler deploy`, `test: vitest run`, `typecheck: tsc --noEmit`. Install deps from the Tech Stack line (vitest `~4.1`).
- [ ] **Step 2:** `wrangler.jsonc` exactly as spec section 4 (database_id placeholder `"00000000-0000-0000-0000-000000000000"` for local). `vitest.config.ts` with two projects: `unit` (environment node, include `src/**/*.test.ts`) and `worker` (pool-workers per its v0.23 README, wrangler config `./wrangler.jsonc`, include `worker/**/*.test.ts`, apply D1 migrations in setup with `applyD1Migrations`).
- [ ] **Step 3: Write the smoke tests.**
  - `smoke.test.ts`: `expect(D('0.1').plus('0.2').toString()).toBe('0.3')`.
  - `health.test.ts`: `SELF.fetch('http://x/api/health')` returns 200 and `{ ok: true }`.
- [ ] **Step 4:** Implement `GET /api/health` in `worker/index.ts`; `App.tsx` renders the heading `Honest Returns`.
- [ ] **Step 5: Verify.** Run `npm test && npm run typecheck && npm run build`. Expected: 2 tests pass, no type errors, `dist/` contains client and worker output. Run `npm run dev` and open `/` and `/api/health` once.
- [ ] **Step 6: Commit** `chore: scaffold vite, worker, vitest`.

### Task 2: Types, dates and CSV parsing

**Files:**
- Create: `src/engine/types.ts`, `src/shared/dates.ts`, `src/shared/csv.ts`
- Test: `src/shared/dates.test.ts`, `src/shared/csv.test.ts`

**Interfaces:**
- Produces: all types in spec 6.1; `RejectionCode` union of every code in spec 5.1; `isIsoDate(s): boolean`, `addDays(d: IsoDate, n: number): IsoDate`, `daysBetween(a: IsoDate, b: IsoDate): number`; `parseCsv(text: string): { rows: LedgerRow[]; rejected: Rejection[] }`; `ledgerTickers(rows): string[]` (sorted distinct tickers of BUY/SELL/DIVIDEND).

- [ ] **Step 1: Write failing tests.**
  - dates: `daysBetween('2020-01-01','2022-01-01') === 731`; `addDays('2020-02-28', 1) === '2020-02-29'`; `isIsoDate('2021-02-30') === false`; `isIsoDate('02/03/2021') === false`.
  - csv: Golden A text (spec 7) parses to 5 rows, row 2 is `{type:'FX', currency:'SGD', ticker:'USD', quantity: D(1000), amount: D(1360)}`, `line` values 2..6.
  - One test per code in the file-level and row-level tables of spec 5.1, asserting `code`, `line`, and the exact `message` (e.g. `amount 999 does not equal quantity x price (2 x 500 = 1000).`).
  - Row with two failures reports only the first in table order.
  - Review Focus 1: same Golden A text with `\r\n`, a leading BOM and a trailing blank line parses to the same 5 rows.
  - Review Focus 5: ticker `" voo "` parses to `VOO`; type `buy` parses to `BUY`.
- [ ] **Step 2:** Run `npx vitest run --project unit src/shared`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement. zod schema per row on the trimmed string fields; numbers via regex `^-?\d+(\.\d+)?$` then `D(s)`. Split lines on `/\r?\n/`, strip BOM, drop trailing empty lines. No quoted-field support is needed for the canonical format (fields never contain commas); a quoted field fails `wrong_column_count` or `bad_number`. ponytail: add a CSV library only if an importer needs quoted fields (IBKR does, task 15).
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: canonical csv parsing with rejection reasons`.

### Task 3: Daily valuation

**Files:**
- Create: `src/engine/valuation.ts`, `src/engine/fixtures/golden-a.ts`
- Test: `src/engine/valuation.test.ts`

**Interfaces:**
- Consumes: types, `D`, dates helpers.
- Produces: `valueDaily(input: ComputeInput): { ok: true; series: ValuationPoint[]; warnings: Warning[] } | { ok: false; rejected: Rejection[] }`, with `dailyReturn` left as `D(0)` (filled by task 4). `golden-a.ts` exports `{ csv, prices, fx, endDate }`.

- [ ] **Step 1: Write failing tests** (spec 6.2 to 6.5, Golden A table):
  - Series has 5 points 2020-08-28..2020-09-01; `valueSgd.toFixed(10)` = 1400, 1400, 1400, 2064.8, 1998; holdings AAPL 2,2,2,8,8; cash SGD 40,40,40,640,540; `netInvestedSgd` 1400,1400,1400,2000,1900.
  - 08-29 point has `fxDate: '2020-08-28'`; warnings contain one `fx_carried` with message `Exchange rate carried forward on 2 days without an ECB fixing.`
  - Rejections, each from a small inline ledger: `not_trading_day` (BUY on 2020-08-29), `after_as_of` (row dated after endDate), `negative_cash` (FX selling 1500 SGD after a 1400 deposit; message `SGD cash would be -100.00 at the end of 2020-08-28.`, line of the FX row), `oversell` (SELL 3 AAPL holding 2), `no_market_data` (FX series starting after the first row).
  - Engine stops at the first rejection: a ledger with two independent overdrafts on different days returns exactly one rejection.
  - Review Focus 2: on 2020-09-01, SELL 8 AAPL at 135 (amount 1080), FX selling 1080 USD buying 1458 SGD, WITHDRAW 1998 SGD: `ok: true`, end SGD cash 0.
  - Review Focus 3: DEPOSIT dated 2020-08-29 (Saturday): `ok: true`, value on 08-29 uses close 500 and rate 1.36.
- [ ] **Step 2:** Run `npx vitest run --project unit src/engine/valuation.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the day loop exactly as spec 6.2 (split, rows in priority order, end-of-day checks, value). Pre-checks for `after_as_of` and `not_trading_day` before the loop. Look up bars and rates with a moving index (series are ascending), not a search per day.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** `feat: daily SGD valuation with splits and carry-forward`.

### Task 4: TWR

**Files:**
- Create: `src/engine/twr.ts`
- Test: `src/engine/twr.test.ts`

**Interfaces:**
- Produces: `dailyReturns(series: ValuationPoint[], timing: FlowTiming): { series: ValuationPoint[]; warnings: Warning[] }` (fills `dailyReturn`); `twr(series): Decimal`; `annualise(cumulative: Decimal, days: number): RateResult`.

- [ ] **Step 1: Write failing tests:**
  - Golden A start: daily returns 0, 0, 0, 0.0324, 1998/1964.8 - 1; `twr(...).toFixed(10) === '0.0498448697'`.
  - Golden A end: `twr(...).toFixed(10) === '0.0631089832'`.
  - `annualise(D('0.21'), 731).value.toFixed(10) === '0.0998565877'`, `annualised: true`; `annualise(D('0.05'), 365)` returns 0.05 with `annualised: false`.
  - Zero denominator: series values 0 with no flows gives `dailyReturn` 0, no warning.
  - Negative denominator: hand-built series with V_prev 100 and F -150 gives `dailyReturn` 0 and one `twr_negative_base` warning naming the date.
- [ ] **Step 2:** Run `npx vitest run --project unit src/engine/twr.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement per spec 6.6. `pow` via `D.pow(base, D(365).div(days))`.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** `feat: time-weighted return with start and end-of-day timing`.

### Task 5: XIRR

**Files:**
- Create: `src/engine/xirr.ts`
- Test: `src/engine/xirr.test.ts`

**Interfaces:**
- Produces: `xirr(flows: { date: IsoDate; amount: Decimal }[], endDate: IsoDate): XirrResult`.

- [ ] **Step 1: Write failing tests** (spec 6.7, Golden B, Golden A):
  - Golden A flows: `kind 'ok'`, `abs(value - 0.0633663606) < 1e-9`, `annualised: false`.
  - B1 0.0998565877 annualised; B2 value 0.1 with `multipleRoots: true`; B3 `no_sign_change`; B4 `period_too_short`; B5 `no_root_in_range`.
  - B6 bisection path: -1000 on 2021-01-01, +50 on 2022-01-01 (T = 365, so Y = T): Newton from 0.10 jumps below -0.99, bisection returns -0.95 within 1e-9, `annualised: false`.
- [ ] **Step 2:** Run `npx vitest run --project unit src/engine/xirr.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement per spec 6.7 and 6.8. Sum same-date flows first.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** `feat: xirr with newton, bisection fallback and root check`.

### Task 6: compute()

**Files:**
- Create: `src/engine/compute.ts`, `src/engine/index.ts` (re-exports the public engine API)
- Test: `src/engine/compute.test.ts`

**Interfaces:**
- Consumes: `valueDaily`, `dailyReturns`, `twr`, `annualise`, `xirr`.
- Produces: `compute(input: ComputeInput): ComputeResult` (spec 6.9). `xirr_multiple_roots` is added to `warnings` when set.

- [ ] **Step 1: Write failing tests:** Golden A end to end: `twr.value` 0.0498448697 (`annualised: false`, `days: 4`), `xirr.value` 0.0633663606, `flowTiming: 'end'` gives TWR 0.0631089832 and the same XIRR; a rejected ledger returns `{ ok: false }` with the rejection from task 3.
- [ ] **Step 2:** Run `npx vitest run --project unit src/engine/compute.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as a straight pipeline.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** `feat: compute pipeline`.

### Task 7: Sample portfolio and market fixture

Needs Owen's Tiingo key in `.dev.vars` and an answer to Open question 2 (committing price data). If either is missing, stop and report; tasks 8 to 11 can proceed with Golden A data meanwhile.

**Files:**
- Create: `scripts/fetch-fixture.ts`, `scripts/make-sample.ts`, `src/engine/fixtures/sample-market.json`, `src/sample/sample-ledger.csv`, `src/sample/index.ts`, `src/engine/load-market.ts` (string tuples to `PriceSeries` / `FxPoint[]`, shared with the client in task 10)
- Test: `src/engine/sample.test.ts`

**Interfaces:**
- Produces: `toPriceSeries(raw: Record<string, [string,string,string,string][]>): PriceSeries`, `toFx(raw: [string,string][]): FxPoint[]` in `src/engine/load-market.ts` (the client uses it too). `SAMPLE_END = '2025-06-30'` in `src/sample/index.ts`.

- [ ] **Step 1:** `fetch-fixture.ts` reads `TIINGO_TOKEN` from `.dev.vars`, fetches VOO and AAPL 2018-01-01..2025-06-30 and Frankfurter USD/SGD for the same range, writes the API tuple format (spec 9.2). Never logs the key.
- [ ] **Step 2:** `make-sample.ts` writes `sample-ledger.csv` by the rule in spec 8. Review the CSV by eye: 234 data rows, 78 dates, first date in January 2019.
- [ ] **Step 3: Write tests** (spec 8): `compute` on the sample is `ok: true`; series length `daysBetween(first, SAMPLE_END) + 1`; AAPL holding at end of 2020-08-31 = 4 x end of 2020-08-30; buy-and-hold split check equals `4 x close(2020-09-30) / close(2020-08-03) - 1` to 10 dp.
- [ ] **Step 4:** Run `npx vitest run --project unit src/engine/sample.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: sample portfolio ledger and market fixture`.

### Task 8: D1 schema and /api/prices

**Files:**
- Create: `migrations/0001_init.sql`, `migrations/0002_allowlist.sql`, `data/allowlist.txt`, `src/shared/api.ts`, `worker/prices.ts`
- Modify: `worker/index.ts`
- Test: `worker/prices.test.ts`

**Interfaces:**
- Produces: zod `PricesQuery` and `PricesResponse` plus inferred types in `src/shared/api.ts`; `GET /api/prices` exactly as spec 9.2.

- [ ] **Step 1: Write failing tests** (seed `tickers`, `prices`, `fx` rows in the test; migrations applied by setup):
  - Two available tickers spanning two years: response `prices.X` is the concatenation of both year rows in order; `fx` likewise; `asOf` = min of ticker `last_date` and the last fx date.
  - `from=2020-03-01` excludes year rows before 2019.
  - Unknown ticker gives `unavailable: [{ticker, reason: 'not_on_allowlist'}]`; ticker row with `last_date NULL` gives `no_data_yet`; both omitted from `prices`.
  - Lower-case `tickers=voo` works. 51 tickers, missing `from`, or `from=2020-13-01` give 400 `bad_request`.
  - Response header `Cache-Control: public, max-age=3600`; body parses with `PricesResponse`.
- [ ] **Step 2:** Run `npx vitest run --project worker worker/prices.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. One `SELECT ticker, year, rows FROM prices WHERE ticker IN (...) AND year >= ? ORDER BY ticker, year`; build the body by joining `rows` strings with their outer brackets stripped. Allowlist: write `data/allowlist.txt` (Open question 4 default) and generate `0002_allowlist.sql` from it; priority 1 for VOO, AAPL, VT, QQQ.
- [ ] **Step 4:** Run again, then `npx wrangler d1 migrations apply honest-returns --local`. Expected: PASS; migrations apply.
- [ ] **Step 5: Commit** `feat: d1 price cache and prices endpoint`.

### Task 9: Nightly refresh cron

**Files:**
- Create: `worker/refresh.ts`, `worker/tiingo.ts`, `worker/frankfurter.ts`
- Modify: `worker/index.ts` (`scheduled` calls `refresh(env, new Date(event.scheduledTime))`)
- Test: `worker/refresh.test.ts`

**Interfaces:**
- Produces: `refresh(env: Env, now: Date, fetchFn?: typeof fetch): Promise<{ fetched: string[]; fxUpdated: boolean; stoppedOn?: string }>`; `appendYearRows(existing: string | null, newRows: unknown[][]): string`.

- [ ] **Step 1: Write failing tests** with a stub `fetchFn` (spec 9.3):
  - Tiingo item `{date:'2020-08-31T00:00:00.000Z', close:129.04, splitFactor:4, divCash:0}` stored as `["2020-08-31","129.04","4","0"]` in year 2020; `last_date` and `refreshed_on` updated.
  - Rows spanning a year boundary go to two year rows; existing rows are kept, duplicates (date <= last_date) are not appended.
  - Request carries `Authorization: Token <key>` and `startDate` = last_date + 1; for a new ticker `startDate=2005-01-01`.
  - Order: priority 1 first, then never-refreshed, then oldest `refreshed_on`; tickers refreshed today are skipped; at most 45 Tiingo calls per run.
  - FX fetched only when `now` UTC hour is 22.
  - A 429 stops the run: later tickers untouched, `stoppedOn` set. A 404 marks `refreshed_on` and continues.
- [ ] **Step 2:** Run `npx vitest run --project worker worker/refresh.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement per spec 9.3. Sequential fetches.
- [ ] **Step 4:** Run again. Then manual check with the real key: `npm run preview`, `curl "http://localhost:8787/__scheduled?cron=0+22+*+*+*"`, then `curl "http://localhost:8787/api/prices?tickers=VOO,AAPL&from=2019-01-02" | head -c 300`. Expected: tests PASS; VOO and AAPL data present (priority 1 first).
- [ ] **Step 5: Commit** `feat: nightly tiingo and frankfurter refresh`.

### Task 10: Landing page

**Files:**
- Create: `src/app/styles.css` (tokens from spec 11.3 as CSS custom properties), `src/app/fonts/` (Archivo and Source Serif 4 woff2), `src/app/data.ts`, `src/app/format.ts`, `src/app/Hero.tsx`, `src/app/NumberLine.tsx`, `src/app/ValueChart.tsx`
- Modify: `src/app/App.tsx`, `index.html`
- Test: `src/app/format.test.ts`, `src/app/data.test.ts`, `src/app/numberline.test.ts`

**Interfaces:**
- Produces: `fetchPrices(tickers: string[], from: IsoDate, fetchFn?): Promise<PricesResponse>`; `loadSample(fetchFn?): Promise<ComputeResult & { asOf }>`; `formatPct(d: Decimal, dp: 1 | 2): string` (`+14.2%`, `-3.0%`); `formatSgd(d): string` (`SGD 1,234.56`, `-SGD 312.00`); `numberLineScale(twr: number, xirr: number): { min: number; max: number; ticks: number[] }`.

- [ ] **Step 1: Write failing tests:** `formatPct(D('0.142349'),1) === '+14.2%'`, `formatPct(D('-0.03'),1) === '-3.0%'`, `formatSgd(D('-312')) === '-SGD 312.00'`; `numberLineScale(14.2, 11.8)` gives min 0, max 15, ticks [0,5,10,15]; `numberLineScale(-7, 3)` gives min -10, max 5; `loadSample` with a stub fetch returning Golden A data computes `ok: true` and calls `/api/prices?tickers=AAPL,VOO&from=...` once.
- [ ] **Step 2:** Run `npx vitest run --project unit src/app`. Expected: FAIL.
- [ ] **Step 3:** Implement the landing per spec 10.1 and 11.3 to 11.5: hero copy, TWR and XIRR in their colours, number line with highlighter band and `{n} points` label, the chart (lightweight-charts v5 `addSeries(LineSeries)` for value, a stepped dashed series for `netInvestedSgd`, `createSeriesMarkers` for FX dots and withdrawal arrows), `Prices as of {d MMM yyyy}`, the error line from spec 10.1. One motion moment only (spec 11.5 principle 4).
- [ ] **Step 4:** Run tests, then `npm run dev` and screenshot `/` at 360 px and 1280 px wide. Check against the wireframes and the spec 11.2 list (no caps eyebrows, no cards, no mono, no gradients); check keyboard focus and `prefers-reduced-motion`. Expected: tests PASS; screenshots match.
- [ ] **Step 5: Commit** `feat: landing page with sample twr, xirr and chart`.

### Task 11: Upload

**Files:**
- Create: `src/app/upload.ts`, `src/app/Upload.tsx`, `src/app/Rejections.tsx`, `src/app/TimingToggle.tsx`
- Modify: `src/app/App.tsx`
- Test: `src/app/upload.test.ts`

**Interfaces:**
- Produces: `runUpload(text: string, fetchFn?, timing?: FlowTiming): Promise<{ kind: 'result'; result: ComputeResult & { ok: true }; asOf: IsoDate; tickers: string[] } | { kind: 'rejected'; rejected: Rejection[] }>`.

- [ ] **Step 1: Write failing tests** (stub fetch): parse rejections come back without calling fetch; `unavailable` with both reasons produces `unsupported_tickers` and `prices_not_loaded` with exact messages (sorted lists); Review Focus 4: a row dated after `asOf` gives `after_as_of` naming `asOf`; a clean Golden A upload returns `kind: 'result'` with `endDate = asOf`.
- [ ] **Step 2:** Run `npx vitest run --project unit src/app/upload.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `runUpload` and the UI (spec 10.2). Results replace the sample in the same layout with the heading `Your file ({fileName})`; `Show the sample again` returns.
- [ ] **Step 4:** Run tests; then in `npm run dev` upload the Golden A CSV and one broken CSV on a 360 px viewport. Expected: PASS; numbers 5.0% / 6.3% (cumulative), rejection list readable.
- [ ] **Step 5: Commit** `feat: csv upload with rejected-row reasons`.

### Task 12: Deploy (checklist; Owen runs the account steps)

**Files:**
- Create: `docs/deploy.md`

- [ ] **Step 1:** Write `docs/deploy.md`: `npx wrangler login`; `npx wrangler d1 create honest-returns` and put the id in `wrangler.jsonc`; `npx wrangler d1 migrations apply honest-returns --remote`; `npx wrangler secret put TIINGO_TOKEN`; `npm run deploy`; trigger the first cron from the dashboard or wait for 22:00 UTC; check `/api/prices?tickers=VOO,AAPL&from=2019-01-02` and the landing on a phone.
- [ ] **Step 2:** Driver verifies locally that `npm run build` then `npx wrangler deploy --dry-run` succeed. Expected: dry run lists the assets and the D1 binding.
- [ ] **Step 3: Commit** `docs: deploy checklist`. Hand to Owen.

---

## Full scope (cut order 1 to 12)

### Task 13: Verification against Portfolio Performance (scope 1) - dropped 2026-10-24

Dropped by Owen on 2026-10-24. The badge, the verification file and the Methodology section are removed; the export script and procedure were never built.

**Files:**
- Create: `scripts/export-pp.ts`, `docs/verification.md`, `src/verification.json` (written by Owen), `src/app/VerifiedBadge.tsx`
- Test: `src/engine/verification.test.ts`

**Interfaces:**
- Consumes: `compute`, sample ledger and fixture.
- Produces: `out/pp/*` per spec 10.3; `VerifiedBadge` reads `src/verification.json`.

- [ ] **Step 1:** `export-pp.ts` writes the files in spec 10.3 step 1. `docs/verification.md` holds steps 2 to 5 with the column mappings.
- [ ] **Step 2: Write the test:** skipped (`it.skipIf`) when `src/verification.json` is absent; otherwise asserts `|our TWR - pp.ttwrorPa| <= 0.0001` and `|our XIRR - pp.irr| <= 0.0001` with `flowTiming` from the file.
- [ ] **Step 3:** Badge copy `Matches Portfolio Performance {ppVersion} to 0.01 points (checked {date})`, shown only when the file exists.
- [ ] **Step 4:** Run `npx vitest run --project unit src/engine/verification.test.ts`. Expected: SKIP until Owen adds the file, then PASS. Owen runs the manual procedure.
- [ ] **Step 5: Commit** `feat: portfolio performance verification procedure and badge`.

### Task 14: Methodology page (scope 2)

**Files:**
- Create: `src/app/Methodology.tsx`, `src/engine/constants.ts` (`US_WITHHOLDING`, `XIRR_GUESS = 0.1`, `XIRR_RANGE = [-0.99, 10]`, `DAYS_PER_YEAR = 365`, `MONTHLY_NEW_TICKERS = 90`, `REPO_URL`)
- Modify: `src/app/App.tsx` (route on `location.pathname === '/methodology'`), engine files to import constants instead of literals

After Task 25: the route already exists in `src/app/router.ts` and shows the footnotes from `src/app/footnotes.ts`; this task replaces that interim page and opens sections 3, 10 and 6 with those footnote strings.
- Test: `src/app/methodology.test.ts`

- [ ] **Step 1: Test:** the rendered methodology text (via `react-dom/server` `renderToString`) contains the strings built from constants (`365-day year`, `-99%`, `1000%`, `10%`) and does not contain `GIPS requires`.
- [ ] **Step 2:** Implement sections 1 to 7, 9, 10, 14, 15 of spec 10.4 now; sections 8, 11, 12, 13 are added by their own tasks. Each section has an `id` matching the superscript links on the landing (`#flow-timing`, `#xirr`, `#prices`).
- [ ] **Step 3:** Run `npx vitest run --project unit src/app/methodology.test.ts` and check `/methodology` loads directly in `npm run preview` (SPA fallback). Expected: PASS; page loads.
- [ ] **Step 4: Commit** `feat: methodology page`.

### Task 15: IBKR importer (scope 3)

Blocked until Owen provides a real, anonymised IBKR Activity Statement CSV. Commit it as `src/importers/fixtures/ibkr-sample.csv`.

**Files:**
- Create: `src/importers/ibkr.ts`, `src/importers/detect.ts`
- Modify: `src/app/upload.ts` (detect and convert before `parseCsv`)
- Test: `src/importers/ibkr.test.ts`

**Interfaces:**
- Produces: `importIbkr(text: string): { csv: string; rejected: Rejection[] }`; `detectFormat(text): 'canonical' | 'ibkr' | 'unknown'`.

- [ ] **Step 1: Write tests from the real fixture:** expected canonical CSV for that file written by hand and committed next to it; stock buy, stock sell, USD.SGD conversion, SGD deposit, dividend with withholding each map per spec 10.11; a USD deposit is rejected with `flow_currency`; quoted `Date/Time` fields with commas parse.
- [ ] **Step 2:** Run `npx vitest run --project unit src/importers`. Expected: FAIL.
- [ ] **Step 3:** Implement. Needs a quoted-CSV splitter; write a small one (about 20 lines) or add `papaparse` if the fixture has edge cases it handles; choose the smaller.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** `feat: ibkr activity statement importer`.

### Task 16: Device-saved ledger (scope 4) - reinstated 2026-10-24

Reinstated by Owen on 2026-10-24. Built as `src/app/saved.ts` with the whole file set, broker and timing saved; see the phase 2 decisions file.

### Task 17: FX and conversion-cost decomposition (scope 5)

**Files:**
- Create: `src/engine/decompose.ts`, `src/engine/fixtures/golden-d.ts`, `src/app/Decomposition.tsx`
- Modify: `src/engine/compute.ts` (attach `decomposition`), `src/engine/types.ts`, `src/app/Methodology.tsx` (section 11)
- Test: `src/engine/decompose.test.ts`

**Interfaces:**
- Produces: `Decomposition = { local: Decimal; fx: Decimal; conversionCost: Decimal; dividends: Decimal; withholding: Decimal; totalGain: Decimal }`; `decompose(series: ValuationPoint[], ledger: LedgerRow[], fx: FxPoint[]): Decomposition`.

- [ ] **Step 1: Tests** (Golden D1, spec 7): local 138.7, fx 104.9, conversionCost 35, dividends 0, totalGain 208.6, and `local + fx - conversionCost + dividends == totalGain` exactly. A USD-to-SGD FX row variant: sell 100 USD for 135 SGD with ref 1.40 gives conversionCost 5. On the sample: the identity holds exactly.
- [ ] **Step 2:** Run `npx vitest run --project unit src/engine/decompose.test.ts`. Expected: FAIL, then implement per spec 10.5, then PASS.
- [ ] **Step 3:** UI: stacked rows `Price`, `Exchange rate`, `Conversion cost`, `Dividends after tax` (hidden until task 18), right-aligned tabular figures.
- [ ] **After Task 25:** add `{ id: 'decomposition', title: 'Where the gain came from' }` to `src/app/sections.ts`, render the rows in that Analyse section, and switch Home scene 5 to the decomposition rows (spec 15.1.4).
- [ ] **Step 4: Commit** `feat: price, fx and conversion cost decomposition`.

### Task 18: Dividends with 30% withholding (scope 6)

**Files:**
- Create: `src/engine/dividends.ts`, `src/engine/fixtures/golden-c.ts`
- Modify: `src/engine/valuation.ts` (step 2 of the day loop), `src/engine/compute.ts`, `src/engine/decompose.ts`, `src/shared/csv.ts` (DIVIDEND row rules if not already active), `src/app/Decomposition.tsx`, `src/app/Methodology.tsx` (section 8)
- Test: `src/engine/dividends.test.ts`, extend `decompose.test.ts`

**Interfaces:**
- Produces: `entitlements(ledger, prices): Entitlement[]`; `matchDividendRows(rows, ents): { matched; rejected }`; result field `dividends` (spec 10.6).

- [ ] **Step 1: Tests:** Golden C1 and C2 daily values and TWR 0.0121, XIRR 0.0121, withholding 0.90; C2 warning `1 dividends were booked on the ex-date because no pay-date row was found.`; C3 `dividend_unmatched`; C4 `dividend_duplicate`; entitlement on a same-day split and ex-date uses the post-split holding; Golden D2 decomposition totals (dividends 4.9, sum 213.5, withholding 2.1).
- [ ] **Step 2:** Run `npx vitest run --project unit src/engine`. Expected: new tests FAIL, then implement per spec 10.6, then all PASS (Golden A unchanged since divCash is 0).
- [ ] **Step 3:** Re-run task 7's sample tests and task 13's verification test. The sample numbers change; tell Owen the verification must be redone (spec 10.3).
- [ ] **After Task 25:** add `{ id: 'dividends', title: 'Dividends' }` to `src/app/sections.ts` and render Home scene 6 (spec 15.1.4).
- [ ] **Step 4: Commit** `feat: dividends with us withholding`.

### Task 19: Explanation sentence (scope 7)

**Files:**
- Create: `src/engine/explain.ts`
- Modify: `src/engine/compute.ts` (attach `explanation` and `yearReturns`), `src/app/Hero.tsx`
- Test: `src/engine/explain.test.ts`

**Interfaces:**
- Produces: `yearlyTwr(series): { year: number; twr: Decimal; days: number }[]`; `explainGap(input: { twr: RateResult; xirr: XirrResult; yearReturns; deposits: { date: IsoDate; amount: Decimal }[] }): string`.

- [ ] **Step 1: Tests:** one per rule 1 to 10 in spec 10.7 with the exact sentence, e.g. rule 6 with years 2019 +31.2%, 2022 -18.1%, 85% of deposits after 2019 gives `XIRR is lower than TWR because 85% of your deposits arrived after 2019, the strongest year (+31.2%).`; tie on best year picks the earlier year; years with fewer than 90 days are excluded.
- [ ] **Step 2:** Run `npx vitest run --project unit src/engine/explain.test.ts`. Expected: FAIL, then implement, then PASS.
- [ ] **Step 3:** Show the sentence under the number line in Source Serif 4.
- [ ] **Step 4: Commit** `feat: rule-based twr and xirr gap sentence`.

### Task 20: Ticker request queue (scope 8)

**Files:**
- Create: `migrations/0003_ticker_requests.sql`, `worker/requests.ts`, `src/app/RequestTickers.tsx`
- Modify: `worker/index.ts`, `worker/refresh.ts` (step 4), `src/shared/api.ts`
- Test: `worker/requests.test.ts`, extend `worker/refresh.test.ts`

- [ ] **Step 1: Tests:** POST returns `queued`, then `already_queued` on repeat; an allowlisted ticker returns `already_available`; with 90 rows this month the next returns `limit_reached` and `availableFrom` = first of next month; bad body gives 400. Cron: queued tickers are fetched before refreshes and within the 45 budget; 404 sets `not_found`; success inserts into `tickers` and sets `added`.
- [ ] **Step 2:** Run `npx vitest run --project worker`. Expected: FAIL, then implement per spec 10.8, then PASS.
- [ ] **Step 3:** UI: `Request these tickers` button under an `unsupported_tickers` rejection, with the two result texts from spec 10.8.
- [ ] **Step 4: Commit** `feat: ticker request queue`.

### Task 21: "Why raw prices" panel (scope 9)

**Files:**
- Create: `src/engine/adjusted.ts`, `src/engine/fixtures/golden-e.ts`, `src/app/RawPricesPanel.tsx`
- Modify: `src/app/Methodology.tsx` (section 12)
- Test: `src/engine/adjusted.test.ts`

**Interfaces:**
- Produces: `adjustedSeries(bars: PriceBar[]): PriceBar[]`; `adjustedCloseTwr(input: ComputeInput): Decimal`.

- [ ] **Step 1: Tests:** Golden E: adjusted closes 356.5083333333 and 358.5 before the ex-date and equal to close after; raw TWR 0.00805; adjusted TWR 0.0065440791. With no dividends, no splits and one flow, adjusted TWR equals raw TWR.
- [ ] **Step 2:** Run `npx vitest run --project unit src/engine/adjusted.test.ts`. Expected: FAIL, then implement per spec 10.9, then PASS.
- [ ] **Step 3:** Panel on the landing for the sample only, with the copy in spec 10.9.
- [ ] **After Task 25:** the panel goes in the Analyse section `raw-prices` (`src/app/sections.ts` entry `Why raw prices`) and replaces the split sentence in Home scene 7 (spec 15.1.4).
- [ ] **Step 4: Commit** `feat: adjusted close comparison panel`.

### Task 22: Tiger and moomoo importers (scope 10)

Blocked until Owen supplies a real, anonymised export from each broker. Then follow task 15's shape: `src/importers/tiger.ts`, `src/importers/moomoo.ts`, fixtures, hand-written expected canonical CSV, `detectFormat` cases. Commit `feat: tiger importer` and `feat: moomoo importer` separately.

### Task 23: Web manifest (scope 11)

**Files:**
- Create: `public/manifest.webmanifest`, `public/icon-192.png`, `public/icon-512.png`
- Modify: `index.html`

- [ ] **Step 1:** Write the manifest per spec 10.13; link it with `<link rel="manifest">` and `<meta name="theme-color" content="#1E2A2F">`.
- [ ] **Step 2: Verify** `npm run build && grep -l manifest.webmanifest dist/client/index.html` (path per plugin output) and Chrome DevTools Application panel shows the manifest with no errors.
- [ ] **Step 3: Commit** `feat: web manifest`.

### Task 24: Benchmark with the same cash flows (scope 12)

**Files:**
- Create: `src/engine/benchmark.ts`, `src/engine/fixtures/golden-f.ts`, `src/app/BenchmarkSelect.tsx`
- Modify: `src/app/data.ts` (fetch the benchmark ticker with the ledger tickers), `src/app/ValueChart.tsx`
- Test: `src/engine/benchmark.test.ts`

**Interfaces:**
- Produces: `shadowLedger(input: ComputeInput, ticker: string): LedgerRow[] | { error: string }`; `benchmark(input, ticker): ComputeResult`.

- [ ] **Step 1: Tests:** Golden F: end value 1272.7, TWR 0.10, XIRR 0.089 (start timing); end timing uses same-day close 110 for the withdrawal (sell 1 share, end value 9 x 110 x 1.30 = 1287, TWR 0.10); a withdrawal larger than the shadow value returns `The benchmark ran out of money on {date}.`
- [ ] **Step 2:** Run `npx vitest run --project unit src/engine/benchmark.test.ts`. Expected: FAIL, then implement per spec 10.14, then PASS.
- [ ] **Step 3:** UI: select (VOO default, VT, QQQ), benchmark TWR and XIRR in a row under the hero, a third line on the chart in Graphite, 1 px dotted, labelled with the ticker.
- [ ] **After Task 25:** the select and benchmark rows go in the Analyse section `benchmark` (`src/app/sections.ts` entry `Against a single fund`).
- [ ] **Step 4: Commit** `feat: benchmark with identical cash flows`.

---

## Second round (spec section 15)

Execution order: Tasks 25 and 26 run before any of Tasks 14, 17, 18, 21 and 24, because those tasks fill the Analyse sections and Home scenes that Tasks 25 and 26 create (each has an "After Task 25" step). Then 27, 28 and 29 in any order. Task 30 needs Task 15. Recommended: 25, 26, 14, 27, 28, 29, 17, 18, 21, 24, 15, 30.

Branch for these tasks: a feature branch off `dev`, merged back into `dev`. `master` deploys (`.github/workflows/deploy.yml`) and is not touched. The global constraints above apply; `npm test`, `npm run typecheck` and `npm run build` must pass after each task.

### Task 25: Routes, navbar, Analyse page, loading and empty states (spec 15.1.1 to 15.1.3, 15.1.5, 15.3.3)

**Files:**
- Create: `src/app/router.ts`, `src/app/Navbar.tsx`, `src/app/Analyse.tsx`, `src/app/ResultTabs.tsx`, `src/app/sections.ts`, `src/app/SectionList.tsx`, `src/app/Skeleton.tsx`, `src/app/EmptyState.tsx`, `src/app/footnotes.ts`, `src/app/Methodology.tsx` (interim: footnotes a to c only)
- Modify: `src/app/App.tsx` (path switch; sample and file state stay here; remove `Show the sample again`), `src/app/data.ts` (`loadSample` returns `{ kind: 'empty' }` on `asOf: null`), `src/app/upload.ts` (same, instead of the throw on line 41), `src/app/styles.css`
- Test: `src/app/router.test.ts`, extend `src/app/data.test.ts` and `src/app/upload.test.ts`, `src/app/analyse.test.ts`

**Interfaces:**
- Produces: `usePath(): string`, `navigate(to: string): void`, `Link` in `router.ts`; `SECTIONS: { id: string; title: string }[]` in `sections.ts` (only `returns` for now); `FOOTNOTES: { a(timing: FlowTiming): string; b: string; c: string }` in `footnotes.ts`; `loadSample(): Promise<Loaded | { kind: 'empty' }>`; `UploadOutcome` gains `{ kind: 'empty' }`.

- [ ] **Step 1: Write failing tests.**
  - `data.test.ts`: a stub fetch answering `asOf: null` with both sample tickers in `unavailable` as `no_data_yet` makes `loadSample` resolve `{ kind: 'empty' }`, not throw. An HTTP 500 still rejects.
  - `upload.test.ts`: a stub answering `asOf: null` with no `unavailable` gives `{ kind: 'empty' }`.
  - `router.test.ts` (Node, a minimal fake `window` with `history` and `location`): `navigate('/analyse')` calls `pushState` with `/analyse`; a click with `metaKey` on `Link` is not intercepted.
  - `analyse.test.ts` with `react-dom/server` `renderToString`: the Analyse page with no file renders a `Your file` tab with `disabled` and `aria-selected="false"`, and does not contain `Show the sample again`; with only `returns` in `SECTIONS` it renders no section list.
  - `footnotes.test.ts` (or inside `analyse.test.ts`): `FOOTNOTES.a('end')` contains `at the end of the day`; none of the three strings contains an em dash.
- [ ] **Step 2:** Run `npx vitest run --project unit src/app`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement per spec 15.1. Navbar per 15.1.2 (two rows at 360 px, one at 960 px and up, Brass underline and `aria-current` on the active item). Skeleton and empty state per 15.1.3 on both `/` and `/analyse`. Until Task 26, `/` renders the existing `Hero` with a `Link` button to `/analyse`.
- [ ] **Step 4: Verify.** `npx vitest run --project unit src/app` PASS; `npm run typecheck && npm run build`. Then `npm run dev` and check at 360 px and 1280 px: direct loads of `/`, `/analyse`, `/methodology#xirr` (scrolls to b), `/nope` (not-found line); back and forward buttons; tab keyboard arrows; `Your file` disabled before an upload and selected after one; the skeleton (throttle the network in DevTools); the empty state (point the dev D1 at an empty local database, or stub `/api/prices` to `{"asOf":null,...}`). Screenshot both widths and compare with the 15.1.2 and 15.1.5 wireframes.
- [ ] **Step 5: Commit** `feat: routes, navbar and analyse page with loading and empty states`.

### Task 26: Home story (spec 15.1.4)

**Files:**
- Create: `src/app/Home.tsx`, `src/app/story.ts` (pure: builds each scene's figures from `Loaded`)
- Modify: `src/app/App.tsx` (`/` renders `Home`), `src/app/styles.css`
- Test: `src/app/story.test.ts`

**Interfaces:**
- Consumes: `Loaded` from `data.ts`, `formatPct`, `formatSgd`, `formatDate`, `Hero`.
- Produces: `storyFacts(loaded): { deposits: number; moneyIn: Decimal; conversions: number; buysByTicker: Record<string, number>; years: { year: number; twr: Decimal; deposited: Decimal }[]; best: number; worst: number; fxFrom: { rate: Decimal; date: IsoDate }; fxTo: { rate: Decimal; date: IsoDate }; split?: { ticker: string; date: IsoDate; before: Decimal; after: Decimal } }`. `split` is the first day on which a holding changes with no BUY or SELL row for that ticker on that day (`Loaded` carries no price bars).

- [ ] **Step 1: Write failing tests** on Golden A data (`src/engine/fixtures/golden-a.ts`, computed with `compute`): deposits 2, moneyIn 1900, conversions 1, `buysByTicker` `{ AAPL: 1 }`, `fxFrom` 1.36 on 2020-08-28, `fxTo` 1.35 on 2020-09-01, `split` `{ ticker: 'AAPL', date: '2020-08-31', before: 2, after: 8 }`. Years with fewer than 90 days are excluded (Golden A has none, so `years` is empty). A `years` case from a hand-built series of two full years picks `best` and `worst`, ties to the earlier year.
- [ ] **Step 2:** Run `npx vitest run --project unit src/app/story.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `storyFacts` and the eight scenes of spec 15.1.4. Scenes 5 and 7 use the before-Task-17 and before-Task-21 versions; scene 6 is not rendered while `dividends` is absent. No scroll animation.
- [ ] **Step 4: Verify.** Tests PASS; typecheck and build pass. `npm run dev`, read `/` top to bottom at 360 px and 1280 px against the copy rules (sentence case, no em dashes, no typed figures: change `SAMPLE_END` locally and see every figure change). Check heading order with the browser accessibility tree.
- [ ] **Step 5: Commit** `feat: home page story of the sample portfolio`.

### Task 27: Shareable result card (spec 15.2)

**Files:**
- Create: `src/app/shareCard.ts`, `src/app/ShareButtons.tsx`, `src/app/css.ts` (`cssVar` moved out of `ValueChart.tsx`)
- Modify: `src/app/ValueChart.tsx` (import `cssVar`), `src/app/Analyse.tsx` (buttons in the Returns section actions; before Task 25 this is `App.tsx`)
- Test: `src/app/shareCard.test.ts`

**Interfaces:**
- Produces: `cardData(result, includeSgd): CardData`; `drawCard(ctx, data, size: '1200x630' | '1080x1080', tokens): void`; `downloadCard(result, size, includeSgd): Promise<void>`.

- [ ] **Step 1: Write failing tests** with a fake context that records `fillText` strings and `fillStyle` at each call, and stubs `measureText`:
  - Golden A result with `includeSgd: false`: the recorded text contains `+5.0%`, `+6.3%`, `in total`, the explanation, `28 Aug 2020 to 1 Sep 2020`, `honest-returns.owennyowy.workers.dev`; and no string contains `AAPL`, `SGD`, or a file name.
  - `includeSgd: true`: contains `Value SGD 1,998.00, money in SGD 1,900.00`.
  - XIRR undefined: contains `Cannot be calculated`; no band is drawn (no `fillRect` in Brass).
  - `cardData` has no ledger or ticker field (a type-level check: `// @ts-expect-error` on `cardData(...).ledger`).
- [ ] **Step 2:** Run `npx vitest run --project unit src/app/shareCard.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement per spec 15.2, including the font-loading wait and the failure line, and the font-size step-down when `ctx.fontStretch` is missing.
- [ ] **Step 4: Verify.** Tests PASS; typecheck and build pass. In `npm run dev` download both sizes for the sample and for an uploaded Golden A file in Chrome, Safari and Firefox; open each PNG and check: exact pixel size, Archivo and Source Serif 4 (not a fallback), no tickers or file name, SGD line only with the toggle on, file name `honest-returns-1200x630.png`. Use a hard reload with the cache disabled for the first download, to exercise the font wait.
- [ ] **Step 5: Commit** `feat: downloadable result card image`.

### Task 28: One-page PDF statement through print (spec 15.3)

**Files:**
- Create: `src/app/PrintStatement.tsx`, `src/app/printChart.ts`
- Modify: `src/app/ValueChart.tsx` (extract `buildChart(el, series, ledger, colors)`), `src/app/Analyse.tsx` (button and statement), `src/app/styles.css` (`@media print`, `@page`), `src/app/footnotes.ts` (consumed, not changed)
- Test: `src/app/printStatement.test.ts`

**Interfaces:**
- Produces: `buildChart(el: HTMLElement, series: ValuationPoint[], ledger: LedgerRow[], colors: ChartColors): IChartApi`; `chartSnapshot(series, ledger): Promise<string>` (data URL); `PrintStatement({ result, timing, isSample, chartImage, today })`.

- [ ] **Step 1: Write failing tests** with `renderToString(PrintStatement(...))` on the Golden A result: contains `Honest Returns statement`, `+5.0%`, `+6.3%`, `Gap: 1.4 points`, the explanation, all three footnote strings from `footnotes.ts` with the timing text matching `timing`, `Prices as of 1 Sep 2020`, `Generated on {today}`, and the right nothing-stored line for sample and for file. It never contains the file name passed to the page or `AAPL`.
- [ ] **Step 2:** Run `npx vitest run --project unit src/app/printStatement.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement per spec 15.3.4: `buildChart` refactor (on-screen chart unchanged), off-screen light chart and `takeScreenshot`, `img.decode()`, `document.title` swap and restore on `afterprint`, print stylesheet with the 11.3 light tokens.
- [ ] **Step 4: Verify.** Tests PASS; typecheck and build pass. Print preview in Chrome, Safari and Firefox for the sample and an uploaded file: one A4 page, chart image present and light, footnotes legible, Save as PDF produces a file named `Honest Returns statement {date}.pdf`, text selectable. Compare the on-screen chart before and after: unchanged. Try iOS Safari share-to-print once.
- [ ] **Step 5: Commit** `feat: one-page pdf statement through print stylesheet`.

### Task 29: Combine several canonical CSV files (spec 15.4, canonical rules only)

**Files:**
- Create: `src/app/combine.ts`, `src/app/FileList.tsx`
- Modify: `src/app/UploadButton.tsx` (`multiple`, and an `Add another file` mode), `src/app/upload.ts` (`runUpload(files, fetchFn, timing)`), `src/app/App.tsx` (file state holds `files`), `src/app/Analyse.tsx`, `src/app/Rejections.tsx` (file prefix), `src/engine/types.ts` (`overlapping_files` in `RejectionCode`; optional `file` on `Rejection`)
- Test: `src/app/combine.test.ts`, update `src/app/upload.test.ts` call sites to the array form

**Interfaces:**
- Produces: `combineFiles(files: { name: string; text: string }[]): { rows: LedgerRow[]; origin: { file: string; line: number }[]; periods: { name: string; from: IsoDate; to: IsoDate }[]; notices: string[] } | { rejected: Rejection[] }`; `runUpload(files, fetchFn?, timing?)`.

- [ ] **Step 1: Write failing tests.**
  - Golden A split into two files (rows up to 2020-08-28, and the rest) gives the same TWR and XIRR through `runUpload` as the single file.
  - Order of selection does not matter: `[b, a]` gives the same result as `[a, b]`.
  - Two files sharing 2020-08-31 reject with `overlapping_files` and message `a.csv and b.csv both cover 2020-08-31 to 2020-08-31. Remove one of them.`; the same file twice rejects the same way.
  - A parse error in the second file comes back as `{ file: 'b.csv', line: 3, ... }` and renders `b.csv, line 3: ...`.
  - An engine rejection in the merged ledger (an oversell in the second file) is mapped back to that file and its own line number.
  - One file: rejection text has no file prefix (the existing upload tests pass unchanged apart from the array call).
  - No gap notice for canonical files.
- [ ] **Step 2:** Run `npx vitest run --project unit src/app/combine.test.ts src/app/upload.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement steps 1, 2, 3 and 5 of spec 15.4.2 for canonical files; the file list and `Your files ({n})` heading of 15.4.1.
- [ ] **Step 4: Verify.** Tests PASS; typecheck and build pass. In `npm run dev`, select two Golden A halves at once, then one and `Add another file` for the other; then add an overlapping file and read the rejection at 360 px.
- [ ] **Step 5: Commit** `feat: combine several csv files into one ledger`.

### Task 30: Combine IBKR period statements with reconciliation (spec 15.4.2 steps 2, 4, 6, 7)

Blocked until Task 15 (IBKR importer with `OPENING` rows) is merged.

**Files:**
- Modify: `src/app/combine.ts`, `src/app/upload.ts` (reconcile after `fetchPrices`, before `compute`), `src/importers/ibkr.ts` (return the statement period if Task 15 did not), `src/engine/types.ts` (`reconcile_position`, `reconcile_cash`)
- Test: extend `src/app/combine.test.ts`; fixtures `src/importers/fixtures/ibkr-sample-h1.csv`, `ibkr-sample-h2.csv` (synthetic, two consecutive periods of the committed synthetic statement)

**Interfaces:**
- Produces: `reconcile(rows, laterFiles, prices, fx, timing): Rejection | null`; constants `POSITION_TOLERANCE`, `CASH_TOLERANCE`.

- [ ] **Step 1: Write failing tests.**
  - Two consecutive synthetic statements: OPENING rows kept only from the first; the result equals a single statement over the whole period.
  - Second statement's opening VOO 10 while the first ends with 12: `reconcile_position`, message `h2.csv opens with 10 VOO, but the earlier files end with 12 VOO on {date}.`
  - Opening USD cash off by 5.00: `reconcile_cash`; off by 0.50: accepted.
  - A split between the two periods (Golden A AAPL bars): opening 8 after the split reconciles against 2 bought before it.
  - A gap of 10 days between periods: accepted, with the exact gap notice.
  - Overlapping statement periods, using the `Period` field: `overlapping_files`.
  - A reconciliation failure is reported even when the merged ledger would also fail in the engine.
  - Tests that read the gitignored real export skip when it is absent.
- [ ] **Step 2:** Run `npx vitest run --project unit src/app/combine.test.ts src/importers`. Expected: FAIL.
- [ ] **Step 3:** Implement per spec 15.4.2. Repeated `valueDaily` passes are accepted (spec 15.4.2 incidental complexity note).
- [ ] **Step 4: Verify.** Tests PASS; typecheck and build pass. Owen runs two of his own consecutive IBKR statements locally (never committed) and reports whether cash reconciles within 1.00 (spec 15.6 question 2).
- [ ] **Step 5: Commit** `feat: combine ibkr statements with opening balance reconciliation`.

### Task 31: Engine `excludeTickers` and USD flow rows (spec 16.2 to 16.4)

**Files:**
- Create: `src/engine/exclude.ts`
- Modify: `src/engine/valuation.ts` (`cashDeltas` for DEPOSIT and WITHDRAW use `r.currency`; USD DEPOSIT and WITHDRAW added to the USD amount converted at the day's rate, today `openingUsd`, with its comment updated), `src/engine/compute.ts` (explanation deposits: SGD DEPOSIT rows only; opening-day residual subtracts USD flow rows at the point's `fxRate`), `src/engine/types.ts` (comment: USD DEPOSIT and WITHDRAW come only from `excludeTickers`) (no `index.ts` change: `upload.ts` imports engine modules directly)
- Test: `src/engine/exclude.test.ts`

**Interfaces:**
- Produces: `excludeTickers(ledger: LedgerRow[], tickers: string[]): LedgerRow[]`; `excludedShare(ledger: LedgerRow[], tickers: string[], fx: FxPoint[]): Decimal`. The rate for day `d` is `fx.findLast((p) => p.date <= d)!.sgdPerUsd`, the same lookup valuation uses. Not read from the series: an excluded opening position can be dated before the reduced ledger's first day (review finding).

- [ ] **Step 1: Write failing tests** on the spec 16.4 ledger, inline in the test file (CSV through `parseCsv`, AAPL bars 2024-01-02 close 200 and 2024-03-28 close 220, fx 2024-01-02 1.35 and 2024-03-01 1.34, endDate 2024-03-31):
  - `excludeTickers(rows, ['ZZZ'])` returns lines 2 to 4 unchanged and the three synthetic rows of 16.4 exactly (type, currency USD, amount 1002, 438 and 8.5, `ticker`, `quantity`, `price` null, `fees` 0, same `line`).
  - `excludeTickers(rows, ['NOPE'])` returns the rows unchanged; an OPENING `ZZZ` position row is dropped and an OPENING USD cash row is kept.
  - `compute` on the reduced ledger: end-of-day USD cash 38 on 2024-01-02, 476 on 2024-03-01, 484.5 on 2024-03-31; SGD cash 0 on every day; no rejection; `netFlowSgd` 1401.30, 586.92, 11.39 on the three dates; last `netInvestedSgd` 1999.61; last `valueSgd` 2123.23; holdings `{ AAPL: 5 }`; first `dailyReturn` 0; `dividends` empty; `decomposition.dividends` 0.
  - `shadowLedger({ ...reducedInput, flowTiming: 'end' }, 'AAPL')`: its SGD DEPOSIT rows are 1401.30, 586.92 and 11.39 on the three dates (the benchmark sees the reduced flows).
  - `excludedShare(rows, ['ZZZ'], fx).toFixed(10)` is `0.5004995005`; with an OPENING ZZZ position row (10 at 100 USD) and an OPENING SGD cash row added on the first date, numerator and denominator both include `1000 x 1.35` and the cash row changes neither.
  - A file row `DEPOSIT` in USD is still rejected by `parseCsv` with `flow_currency` (existing test, re-run).
- [ ] **Step 2:** Run `npx vitest run --project unit src/engine/exclude.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `exclude.ts` per spec 16.2 and 16.3, and the three engine changes listed in 16.2. No new row type.
- [ ] **Step 4: Verify.** `npx vitest run --project unit src/engine` PASS (golden A to F unchanged), `npm run typecheck` and `npm run build` pass.
- [ ] **Step 5: Commit** `feat: exclude tickers as cash flows in the engine`.

### Task 32: `runUpload` exclusion and the saved choice (spec 16.5, 16.7)

**Files:**
- Modify: `src/app/upload.ts` (`exclude` parameter, filtered availability, `tickers` on availability rejections, exclusion before `reconcile`, `excluded` on the result), `src/engine/types.ts` (`Rejection` gains optional `tickers?: string[]`), `src/app/saved.ts` (`exclude` field), `src/app/RequestTickers.tsx` (remove `unsupportedTickers`, the message parser its ponytail comment named for replacement), `src/app/Rejections.tsx` (pass `r.tickers!` to `RequestTickers`)
- Test: `src/app/upload.test.ts` (update the expectation of the existing "unavailable tickers" test to include `tickers: ['XYZ', 'ZZZ']` and `tickers: ['ABC', 'QRS']`; add tests), `src/app/saved.test.ts`

**Interfaces:**
- Produces: `runUpload(input, fetchFn?, timing?, exclude: string[] = [])`; result outcome `excluded: { tickers: string[]; share: Decimal } | null`; `SavedLedger.exclude: string[]`; `saveLedger(storage, { files, broker, timing, exclude })`.

- [ ] **Step 1: Write failing tests.**
  - The 16.4 CSV with a stub body listing `ZZZ` as `no_data_yet`: without `exclude`, rejected with `prices_not_loaded` and `tickers: ['ZZZ']`; with `exclude: ['ZZZ']`, a result with `excluded.tickers` `['ZZZ']`, `excluded.share.toFixed(10)` `0.5004995005`, last `netInvestedSgd` 1999.61.
  - `exclude: ['ZZZ']` when `YYY` is also unavailable: rejected, and the rejection names `YYY` only.
  - No unavailable tickers and empty `exclude`: `excluded` is null and Golden A numbers are unchanged.
  - Two canonical files split on 2024-03-01, the second opening with OPENING `AAPL 5`, OPENING `ZZZ 10` (the holding before that day's sale) and OPENING USD cash 38: with `exclude: ['ZZZ']` the result has the same numbers as the single file, no `reconcile_position` and no cash notice.
  - With `exclude: ['ZZZ']`, an engine rejection (an AAPL oversell added to the file) still maps back to that row's own line.
  - `saved.test.ts`: `exclude` round-trips; a stored v1 value without `exclude` loads with `exclude: []`; `exclude: 'ZZZ'` or `[1]` loads as null.
- [ ] **Step 2:** Run `npx vitest run --project unit src/app/upload.test.ts src/app/saved.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement per spec 16.5 and 16.7. Exclusion applies to `combined.rows` and to each `combined.openings[i].rows` before `reconcile`; openings left empty are dropped.
- [ ] **Step 4: Verify.** Tests PASS; `npx vitest run --project unit src/app` PASS; `npm run typecheck` and `npm run build` pass.
- [ ] **Step 5: Commit** `feat: run uploads without excluded tickers and save the choice`.

### Task 33: Continue button and partial-report labels (spec 16.6, 16.7)

**Files:**
- Modify: `src/app/Rejections.tsx` (line and `Continue without these holdings` button, `onContinue?: (tickers: string[]) => void`), `src/app/App.tsx` (`check(files, timing, picked, saved, exclude = [])`; saved load passes `saved.exclude`; save passes `exclude`; timing toggle passes `file.out.excluded?.tickers ?? []`; new or added files pass none), `src/app/Analyse.tsx` (`onExclude` prop to `Rejections`; title suffix; notice first in the hero notices; decomposition and dividends lines; `excluded` to `ShareButtons` and `PrintButton`), `src/app/format.ts` (`listTickers(tickers)`, `formatShare(share)`), `src/app/shareCard.ts` (`cardData(result, includeSgd, excluded?)` appends the count sentence to `explanation`), `src/app/ShareButtons.tsx`, `src/app/PrintButton.tsx`, `src/app/PrintStatement.tsx` (`excluded` prop, one line after the date range)
- Test: `src/app/format.test.ts`, `src/app/shareCard.test.ts` (pure functions only; no DOM tests for components)

**Interfaces:**
- Consumes: `UploadOutcome['result'].excluded`, `Rejection.tickers`.
- Produces: `listTickers(t: string[]): string`; `formatShare(d: Decimal): string`; `cardData(result, includeSgd, excluded?: { tickers: string[]; share: Decimal } | null)`.

- [ ] **Step 1: Write failing tests.**
  - `listTickers`: `['ZZZ']` gives `ZZZ`; two give `YYY and ZZZ`; three give `XXX, YYY and ZZZ`.
  - `formatShare`: `0.5004995005` gives `50%`; `0.004` gives `less than 1%`; `0` gives `0%`; `1` gives `100%`.
  - `cardData` with `excluded` of one ticker: `explanation` ends with ` Excludes 1 holding, 50% of what was bought.`; with two, `2 holdings`; no field contains the ticker; without `excluded` the existing expectations are unchanged.
- [ ] **Step 2:** Run `npx vitest run --project unit src/app/format.test.ts src/app/shareCard.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the copy of spec 16.6 exactly and the App wiring of 16.7.
- [ ] **Step 4: Verify.** Tests PASS; `npm run typecheck` and `npm run build` pass. Screenshot checks in `npm run dev`, with the 16.4 CSV and a stub or real ticker with no data, at 360 px and 1280 px:
  1. Rejection screen: list, `No results were calculated.`, the request button (unsupported case), the new line and the secondary `Continue without these holdings` button; both buttons have hover and focus-visible states.
  2. Result after continuing: title ends `excluding ZZZ, 50% of what was bought` and wraps cleanly at 360 px; the exclusion notice sits first under the explanation.
  3. Decomposition and dividends sections show their one-line notices.
  4. Downloaded card, both sizes: the exclusion sentence is inside the three explanation lines, no ticker drawn.
  5. Print preview: still one A4 page; the `Excludes 1 holding` line under the date range; no ticker.
  6. Reload: the same partial report and labels return from the saved ledger.
  7. Timing toggle keeps the exclusion; `Choose another file` with a clean file shows no labels.
- [ ] **Step 5: Commit** `feat: continue without unavailable holdings with partial report labels`.

---

## Incidental complexity (accepted, flagged)

- `@cloudflare/vitest-pool-workers` as a second vitest project: tooling only, so D1 SQL is tested on real D1. Pins vitest to 4.1.
- `@cloudflare/vite-plugin`: tooling only, so dev is one process.
- `fetchFn` parameters on `refresh`, `fetchPrices`, `runUpload`: exist only for tests.
- Per-year JSON rows in D1: required by the free-tier write quota, not incidental.
- Moving the engine to the browser removes complexity (no server compute, no upload handling on the Worker).
- `src/app/router.ts`: a hand-rolled path switch instead of a router library (three fixed paths).
- Share card: a fake canvas context in tests, and a font-size step-down loop because `ctx.fontStretch` is not supported everywhere.
- PDF: an off-screen second chart in light colours for the print image, and the `buildChart` refactor it needs.
- Combining IBKR statements: one extra `valueDaily` pass per later statement for reconciliation (ceiling: files x days).
- Partial reports (Tasks 31 to 33): `Rejection.tickers` replaces parsing tickers back out of the rejection message, because a second consumer (the continue button) now needs them.

---

## Third round (spec section 17)

Order: 34, 35, 36, 37, 38. Each task leaves a working app. Run commands from the repo root. After each task: the task's tests, `npm run typecheck` and `npm run build`. Commits: one line, stage files by name.

### Task 34: Trading fees and US tax as decomposition lines (spec 17.3)

**Files:**
- Modify: `src/engine/types.ts` (`Decomposition.fees`, `totalGain` comment), `src/engine/decompose.ts` (fees per day; `local` no longer absorbs them), `src/app/Decomposition.tsx` (`decompositionRows`, new rows), `src/app/Analyse.tsx` (decomposition intro copy), `src/app/Methodology.tsx` (decomposition paragraph, spec 17.3.3)
- Test: `src/engine/decompose.test.ts` (update), create `src/app/decomposition.test.ts`

**Interfaces:**
- Produces: `Decomposition.fees: Decimal` (SGD, positive is a cost); `decompositionRows(d: Decomposition): { label: string; value: Decimal; total?: true }[]`.

- [ ] **Step 1: Update and add failing tests** in `src/engine/decompose.test.ts`:
  - `identity` becomes `local + fx - conversionCost - fees + dividends == totalGain` (every existing identity test uses it).
  - Golden D1: `local price effect is 140 SGD (fees are their own line)`: `local.toFixed(10)` = `140.0000000000` (was 138.7). New: `trading fees are 1.3 SGD (1 USD x 1.30)`: `fees.toFixed(10)` = `1.3000000000`. FX 104.9, conversionCost 35, totalGain 208.6 unchanged.
  - Golden D2: `local, FX and conversion are unchanged from D1` expects `['140.0000000000', '104.9000000000', '35.0000000000']`; new `fees are 1.3 SGD`; totalGain 213.5 and identity; withholding 2.1 unchanged.
  - USD-to-SGD FX variant: `fees` `0.0000000000`, `fx` 100 and `local` 0 unchanged.
  - Golden C1 through `compute`: `a DIVIDEND row's withholding is not a trading fee`: `decomposition.fees` = `0.0000000000`.
  - Sample (skips without the local fixture): `fees` 0 and the new identity holds exactly.
- [ ] **Step 2:** `src/app/decomposition.test.ts`:
  - `D2 rows in order`: labels and `value.toFixed(2)`: `Price 140.00`, `Exchange rate 104.90`, `Dividends before tax 7.00`, `US tax withheld -2.10`, `Conversion cost -35.00`, `Trading fees -1.30`, `Total gain 213.50` (last has `total: true`).
  - `D1 rows`: no dividend or tax rows: `Price`, `Exchange rate`, `Conversion cost`, `Trading fees`, `Total gain`.
  - `rows add up to Total gain exactly` for D1 and D2 (sum of all rows but the last `.eq(totalGain)`).
  - `no fees row when fees are 0` (build a `Decomposition` by hand with fees 0).
- [ ] **Step 3:** Run `npx vitest run --project unit src/engine/decompose.test.ts src/app/decomposition.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement per spec 17.3.1 and 17.3.3. `Decomposition` renders `decompositionRows` with `signedSgd`; the `total` row keeps class `row total`.
- [ ] **Step 5: Verify.** `npx vitest run --project unit src/engine src/app` PASS (goldens A to F otherwise unchanged); `npm run typecheck`; `npm run build`. In `npm run dev`, Home `Where the gain came from` shows `Dividends before tax` +SGD 3,757.44 and `US tax withheld` -SGD 1,127.23 and no `Trading fees` row; screenshot at 360 px and 1280 px.
- [ ] **Step 6: Commit** `feat: trading fees and us tax as their own decomposition lines`.

### Task 35: Largest fall and volatility in the engine (spec 17.2.1, 17.2.2)

**Files:**
- Create: `src/engine/risk.ts`, `src/engine/risk.test.ts` (Golden G inline)
- Modify: `src/engine/types.ts` (`Risk`, optional `risk` on the `ok: true` branch), `src/engine/constants.ts` (`MIN_VOLATILITY_DAYS = 90`), `src/engine/compute.ts` (attach `risk`)

**Interfaces:**
- Produces: `maxDrawdown(series): { maxDrawdown: Decimal; peakDate: IsoDate | null; troughDate: IsoDate | null }`; `volatility(series): Decimal`; `ComputeResult.risk?: Risk`.

- [ ] **Step 1: Write failing tests** in `src/engine/risk.test.ts` (assert `toFixed(10)`):
  - `Golden G, start timing: largest fall is -0.25 from 2021-06-02 to 2021-06-04`.
  - `Golden G, end timing: the same largest fall and dates`.
  - `Golden G: the value fell 62.5% but the withdrawal is not a fall` (the 2021-06-04 `valueSgd` is 585 against 1560 on 2021-06-02, and `maxDrawdown` is still `-0.2500000000`).
  - `Golden G: volatility(series) is 2.9108786106`.
  - `Golden G: compute risk.volatility is null under 90 days`.
  - `Golden A: no fall, peakDate and troughDate null`.
  - `Golden D1: a first-day fall is measured from the start: -0.0259285714 on 2021-06-01` (peak and trough both 2021-06-01).
  - `ties keep the earliest trough`: a hand-built three-day series with `dailyReturn` [-0.5, 1, -0.5] (index 0.5, 1, 0.5, exact in Decimal) gives largest fall `-0.5000000000`, peak and trough both the first date (day 3 ties day 1 and does not replace it).
  - Sample (skip without the local fixture), start timing: `-0.2892571569`, `2020-02-14`, `2020-03-23`, volatility `0.2496930424`; end timing: `-0.2867883528`, volatility `0.2501337305`.
- [ ] **Step 2:** Run `npx vitest run --project unit src/engine/risk.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement per 17.2.1. Decimal throughout (`D.sqrt`), no floats.
- [ ] **Step 4: Verify.** `npx vitest run --project unit src/engine` PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat: largest fall and volatility from daily twr returns`.

### Task 36: Year by year, and largest fall and volatility, on Analyse and Home (spec 17.2.3, 17.4, 17.5)

**Files:**
- Create: `src/app/Risk.tsx` (`RiskRows`)
- Modify: `src/app/format.ts` (`yearLabel`, `riskText`), `src/app/sections.ts` (two entries), `src/app/sections.test.ts` (SPEC list), `src/app/Analyse.tsx` (`years` and `risk` bodies), `src/app/Home.tsx` (risk Scene after `Why they differ`)
- Test: `src/app/format.test.ts`, `src/app/sections.test.ts`

**Interfaces:**
- Consumes: `ComputeResult.yearReturns`, `ComputeResult.risk`.
- Produces: `yearLabel(y: YearReturn): string`; `riskText(r: Risk): string`; `RiskRows({ risk }: { risk: Risk })`.

- [ ] **Step 1: Write failing tests.**
  - `yearLabel`: `{ year: 2020, days: 366 }` gives `2020`; `{ year: 2021, days: 365 }` gives `2021`; `{ year: 2019, days: 364 }` gives `2019 (364 days)`; `{ year: 2024, days: 365 }` gives `2024 (365 days)` (leap year).
  - `riskText`: largest fall -0.2892571569 from 2020-02-14 to 2020-03-23, volatility 0.2496930424 gives exactly `The largest fall of the TWR line from an earlier high was 28.9%, from 14 Feb 2020 to 23 Mar 2020. Volatility is how far daily returns swing, as a standard deviation scaled to a year. Both use the daily returns behind TWR, so a withdrawal is not a fall and a deposit does not hide one.`
  - `riskText`: largest fall 0 and volatility null gives `The TWR line never fell below an earlier high. Volatility is how far daily returns swing, as a standard deviation scaled to a year. It needs at least 90 days of data. Both use the daily returns behind TWR, so a withdrawal is not a fall and a deposit does not hide one.`
  - `sections.test.ts` SPEC: `returns`, `years` (`Year by year`), `risk` (`Largest fall and volatility`), `decomposition`, `dividends`, `benchmark`, `raw-prices`.
- [ ] **Step 2:** Run `npx vitest run --project unit src/app/format.test.ts src/app/sections.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `RiskRows`: `Largest fall` (`formatPct(maxDrawdown, 1)` or `None` at 0); `Volatility` `{x}% a year` when not null.
  - Analyse `years`: `Scene` with the prose of 17.4 and rows `yearLabel(y)` / `formatPct(y.twr, 1)`, only when `yearReturns.length >= 2`. Analyse `risk`: `Scene` with `riskText` and `RiskRows` when `risk` exists.
  - Home: `<Scene title="Largest fall and volatility" rows={<RiskRows risk={s.risk} />}>` with `riskText`, after `Why they differ`. No change to Home's year table.
- [ ] **Step 4: Verify.** Tests PASS; `npm run typecheck`; `npm run build`. In `npm run dev`, screenshots at 360 px and 1280 px: Home risk scene reads `28.9%`, `14 Feb 2020 to 23 Mar 2020`, `Volatility 25.0% a year`; Analyse with Golden A as a file (one year) shows no `Year by year` section and a risk section saying the TWR line never fell; Analyse with a two-year file shows the year rows with partial years labelled in days; the section row at 360 px scrolls sideways and reaches all seven links.
- [ ] **Step 5: Commit** `feat: year by year returns and largest fall and volatility sections`.

### Task 37: moomoo order history importer (spec 17.1.1 to 17.1.7, 17.1.9)

**UNVERIFIED AGAINST A REAL EXPORT.** Built from third-party reports and a synthetic fixture. When Owen supplies a real anonymised export, copy it to `src/importers/fixtures/moomoo-real.csv` (gitignored, never committed) and check, in this order:
1. The header is the first line, and the exact names of `Side`, `Symbol`, `Fill Qty`, `Fill Price`, `Fill Amount`, `Fill Time`, `Markets`, `Currency`, `Filled@Avg Price` and every fee column.
2. Side values for buys and sells, and how short sales and options appear (an option symbol should fail `bad_ticker`).
3. Fill Time format and time zone. The importer reads Singapore time and dates a fill before 09:00 to the previous day (spec 17.1.5, a `ponytail:` ceiling). Compare a few fills, including one after Singapore midnight and one in pre-market, with the US trading date in the app. If the export is in another zone or carries a zone label, replace the cutoff with the conversion named in the 17.1.5 note. Also check whether times are 12-hour with AM/PM.
4. Sub-fill layout: does the order row carry the first fill, the order total, or nothing? Does `sum(Fill Qty)` per order equal `Filled@Avg Price`?
5. Fees: on each fill row, only on the order row, or repeated on every row; and their currency for US trades.
6. `Fill Amount` equals `Fill Qty x Fill Price` within 0.01 (else `amount_mismatch` rejects every such row).
7. Number formats: thousands separators, signs, `--`, fractional shares.
8. Status text of a partly filled then cancelled order, and that it still has its fill rows.
9. `Markets` value for US stocks and ETFs, and that orders on other markets carry their own `Markets` value (they are left out by it).
10. Whether the export date range can start at the account's first trade (else `oversell`).
11. Whether a Singapore account's columns differ from the Malaysian list.
Then add a test that reads the real file (skips when absent): no rejections, `parseCsv(csv, { usdFlows: true })` clean, and the funding total compared by hand with the user's actual deposits.

**Files:**
- Create: `src/importers/moomoo.ts`, `src/importers/moomoo.test.ts`, `src/importers/fixtures/moomoo-sample.csv` (exact content in spec 17.1.9)
- Modify: `src/shared/csv.ts` (export `splitLine`, moved from `ibkr.ts`; `parseCsv(text, { usdFlows })`), `src/importers/ibkr.ts` (import `splitLine`), `src/importers/detect.ts` (`moomoo`), `src/engine/types.ts` (`RejectionCode` gains `fill_mismatch`, `moomoo_files`), `.gitignore` (`src/importers/fixtures/moomoo-real.csv`)

**Interfaces:**
- Produces: `importMoomoo(text: string): MoomooImport` (spec 17.1.2); `detectFormat(text): 'canonical' | 'ibkr' | 'moomoo' | 'unknown'`; `parseCsv(text: string, opts?: { usdFlows?: boolean })`; `splitLine(line: string): string[]` from `src/shared/csv.ts`.

- [ ] **Step 1: Write failing tests** in `src/importers/moomoo.test.ts`. Build small files in the test from a helper that takes `{ column: value }` objects and the 36-column header, so each case is short; the fixture is read with `?raw` like `ibkr.test.ts` does.
  - `detectFormat recognises the fixture as moomoo`; `a canonical file and an IBKR statement are still canonical and ibkr`; `a header with Side and Symbol but no Fill Qty is unknown`.
  - `the fixture converts to the expected canonical CSV` (exact text of spec 17.1.9) `with lines [2, 2, 4, 5, 5, 6, 7, 9, 9]`, `rejected` empty.
  - `period is the first and last fill date`: `{ from: '2024-03-05', to: '2024-03-12' }`.
  - `notices name the funding total, the skipped orders and the markets left out` (the three exact strings of 17.1.9, in order).
  - `a fill after Singapore midnight takes the previous US date`: fixture line 6 (`Mar 9, 2024 03:00:03`) gives a SELL dated `2024-03-08`; line 9 (`Mar 13, 2024 02:05:00`) a BUY dated `2024-03-12`.
  - `a fill row with empty Side and Symbol belongs to the order above it` (fixture line 5 becomes `BUY VOO 1 400.5`).
  - `cancelled, failed and queued orders with no fill are skipped, even on another market` (TSLA and D05 absent, no rejection).
  - `a partly filled order counts with what was filled` (VOO: 3 of 5).
  - `fills listed newest first give the same CSV` (fixture order blocks reversed: same `csv`; `lines` follow the new file lines).
  - `a sale and a buy on the same day net before funding`: SELL 4 AAPL at 160 (fees 2.03) and BUY 1 VOO at 410 (fees 1.99) on one day after a funded buy: no DEPOSIT that day.
  - `one funded day reads 1 day in the notice`.
  - `columns are found by name`: the same order with columns in another order gives the same rows.
  - `missing fee columns count as 0`: header with only the 7 required columns plus `Commission`; Commission 0.99 gives `fees` 0.99.
  - `the fill part of Markets and Currency is used when the order part is empty`: accepted.
  - `a missing required column rejects the file`: no `Fill Price` gives `[{ line: null, code: 'bad_header', message: 'This moomoo file is missing these columns: Fill Price.' }]`.
  - `filled orders on other markets are left out with a notice`: the fixture's HK order (line 10) is not in the output and its fill is not funded. A file with filled orders on SG (2 orders) and HK (1 order) plus one US order gives `3 orders on HK and SG markets were left out; this report covers US trades only.`; one SG order gives `1 order on SG market was left out; this report covers US trades only.`
  - `a left-out order is never checked`: a filled SG order with Fill Qty `abc` gives no rejection.
  - `a US order not in USD is rejected`: Markets `US`, Currency `HKD`, Fill Qty 10 gives `{ line, code: 'trade_currency', message: 'Only US trades in USD can be measured; this order is in HKD.' }`.
  - `Side other than Buy or Sell is rejected`: `Short Sell` gives `bad_type`, `Side must be Buy or Sell.`
  - `Fill Time is Singapore time with a 09:00 cutoff` (spec 17.1.5): `2024/03/15 08:59:59` gives `2024-03-14` (before the boundary); `2024/03/15 09:00:00` gives `2024-03-15` (on the boundary); `2024/03/15 03:15:00` gives `2024-03-14`; `2024-03-01 02:00:00` gives `2024-02-29`; `Mar 15, 2024 3:15 AM` gives `2024-03-14`; `Mar 15, 2024 9:00 PM` gives `2024-03-15`; `2024-03-15 21:30:00 ET` gives `2024-03-15` (label ignored).
  - `a Fill Time without a valid date and time is rejected`: `05/03/2024 10:00`, `2024/03/15` and `2024/03/15 25:00` each give `bad_date`, `Fill Time must be a date and time like 2024/03/05 21:30:00 or Mar 5, 2024 21:30:00.`
  - `a non-number is rejected`: Fill Qty `abc` gives `bad_number`, `Fill Qty must be a number.`
  - `fills that differ from Filled@Avg Price are rejected`: order row `3@400.17` with fills 2 gives `fill_mismatch`, `Fills add up to 2 shares, but the order shows 3 filled.`, on the order row line.
  - `a file with no filled US order is rejected`: no fills at all, and filled HK orders only, each give `empty_file`, `The file has no filled orders on the US market.`
  - `the output parses only with usdFlows`: `parseCsv(csv, { usdFlows: true })` has no rejections and three USD DEPOSIT rows; `parseCsv(csv)` rejects lines 3, 6 and 10 with `flow_currency`.
  - `a real export converts without rejections` (`describe.skipIf` when `moomoo-real.csv` is absent).
  - In `src/shared/csv.test.ts`: `a USD DEPOSIT in a plain file is still rejected with flow_currency` (existing behaviour, default options).
- [ ] **Step 2:** Run `npx vitest run --project unit src/importers src/shared`. Expected: FAIL.
- [ ] **Step 3:** Implement per 17.1.2 to 17.1.7. Reuse `splitLine`, `HEADER`, `isIsoDate`, `D`. `ibkr.test.ts` must pass unchanged after `splitLine` moves.
- [ ] **Step 4: Verify.** `npx vitest run --project unit src/importers src/shared` PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat: moomoo order history importer (unverified against a real export)`.

### Task 38: moomoo in uploads, the picker and the explanation (spec 17.1.8)

**Files:**
- Modify: `src/app/combine.ts` (moomoo branch, `moomoo_files` rule), `src/engine/types.ts` (`ComputeInput.originalLedger`), `src/engine/compute.ts` (`explanationDeposits`, exported: DEPOSIT rows in either currency from the original ledger), `src/app/upload.ts` (`originalLedger: combined.rows` on `computeInput`: the Analyse call site), `src/app/Home.tsx` (deposits from `explanationDeposits(s.ledger, s.series)`, line 33), `src/app/BrokerPicker.tsx` (`moomoo` option), `src/app/App.tsx` (`FORMAT_NAME.moomoo`), `src/app/saved.ts` (accept `moomoo`)
- Test: `src/app/combine.test.ts`, `src/app/upload.test.ts`, `src/app/saved.test.ts`, `src/engine/compute.test.ts`

**Interfaces:**
- Consumes: `importMoomoo`, `parseCsv(text, { usdFlows })`.
- Produces: `explanationDeposits(ledger: LedgerRow[], series: ValuationPoint[], original: LedgerRow[] = ledger): { date: IsoDate; amount: Decimal }[]`; `ComputeInput.originalLedger?: LedgerRow[]`; `Broker` gains `'moomoo'`.

- [ ] **Step 1: Write failing tests.**
  - `combine.test.ts`: `a moomoo file converts with its USD deposits and its own period` (`periods` `2024-03-05` to `2024-03-12`, three USD DEPOSIT rows); `an engine rejection maps back to the moomoo file line` (through `runUpload` with a stub body that has a bar on the sale date: a moomoo file whose only fill is a SELL gives `oversell` on that fill's moomoo line); `two moomoo files are rejected with moomoo_files` (exact message of 17.1.8); `a moomoo file and a canonical file with separate periods combine`.
  - `upload.test.ts`: `the moomoo fixture computes with funding deposits` using the stub body of spec 17.1.9: last `netInvestedSgd` `3807.6615`, last `valueSgd` `4050`, last USD cash `0`, `twr.value.toFixed(10)` `0.0649010829`, XIRR `0.0710198440`, `decomposition.fees.toFixed(10)` `13.4865000000`, `notices` include the funding notice.
  - `compute.test.ts`: `explanationDeposits counts USD deposits at the day's rate` on the moomoo output: `[2024-03-05 2027.6865, 2024-03-06 1623.3615, 2024-03-12 156.6135]`; `excluded sales and dividends never count as deposits`: on the spec 16.4 ledger, `explanationDeposits(reduced, series, original)` gives only `2754` on 2024-01-02 (the USD deposits 438 and 8.5 from ZZZ are left out), while `explanationDeposits(reduced, series)` without the original would also give `586.92` and `11.39` (shows why the original is passed); `compute` with `originalLedger` set gives the same explanation as before this task on that ledger; Golden A gives `1400` and `600` (unchanged); an OPENING day still adds the opening value as before (existing OPENING tests pass).
  - `upload.test.ts`: `runUpload passes the ledger before exclusion`: the 16.4 CSV with `exclude: ['ZZZ']` gives `out.input.originalLedger` containing the ZZZ BUY row (type `BUY`, ticker `ZZZ`) and `out.input.ledger` not containing it; without `exclude`, `originalLedger` equals the combined rows.
  - `saved.test.ts`: `broker moomoo round-trips`; the `schwab` case stays invalid.
- [ ] **Step 2:** Run `npx vitest run --project unit src/app/combine.test.ts src/app/upload.test.ts src/app/saved.test.ts src/engine/compute.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement per 17.1.8. Home's explanation sentence for the sample must not change (check the hero text before and after).
- [ ] **Step 4: Verify.** Tests PASS; `npx vitest run --project unit` PASS; `npm run typecheck`; `npm run build`. In `npm run dev` with `moomoo-sample.csv` and stub or real prices for AAPL and VOO, screenshots at 360 px and 1280 px: the moomoo tile is selectable with its note; picking Interactive Brokers and dropping the moomoo file shows `This looks like a moomoo order history file, not an Interactive Brokers activity statement file.`; the result shows both notices; dropping two moomoo files shows the `moomoo_files` rejection; reload restores the saved moomoo report.
- [ ] **Step 5: Commit** `feat: moomoo uploads with funding deposits and the broker tile`.

Task 22 note: the moomoo half of Task 22 is replaced by Tasks 37 and 38. Tiger stays blocked on a real sample file (spec 17.1.10).

### Incidental complexity (third round)

- `parseCsv` `usdFlows` option: exists only so importer output can carry USD deposits while plain files still cannot.
- `moomoo_files` rule: exists because funding is worked out per file; the alternative (funding over the merged ledger) would need cash rules for every other format inside `combine.ts`.
- `fill_mismatch` check: exists only because the sub-fill layout is unverified; remove it if the real export shows fills cannot be repeated.
- `ComputeInput.originalLedger`: exists only so the explanation reads deposits from before exclusion; the engine otherwise works on the reduced ledger.
- The 09:00 Singapore-time cutoff on Fill Time: a guess at the export's zone, to be replaced by a real conversion once a file shows it.
