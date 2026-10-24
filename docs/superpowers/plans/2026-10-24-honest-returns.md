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
