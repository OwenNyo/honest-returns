# Honest Returns: approved proposal (2026-10-24)

Produced by an ideation agent, stress-tested by a grill agent, revised twice, and decided by Owen.

## Pitch
A free, public web app that calculates true SGD portfolio returns for Singapore investors holding US assets, from their broker history. It reports time-weighted return (TWR) and money-weighted return (XIRR) side by side, explains why they differ, and publishes every convention it uses. Numbers are verified against Portfolio Performance (open source).

**Two-minute belief (sets the landing view):** "This developer can turn a real broker history into correct SGD returns, knows which conventions matter, and proved the numbers against an independent tool."

## Decisions made by Owen
- Market data: Tiingo end-of-day on Owen's own free-tier key. Persistent shared price cache is allowed. (Owen is aware the free-tier terms say internal use and no persistent storage, and chose to proceed.)
- Hosting must be free. Always-on preferred so recruiters never hit a cold start.
- Free-tier quota is acceptable; design for it with an allowlist and graceful rejection.
- Must work on desktop and mobile. Responsive web, mobile-first, no native app.
- No LLM anywhere in the app. Explanation text is rule-based templates.
- Target audience for hiring: wealth tech / asset management.
- Use the frontend-design skill for planning and implementation.

## Assumptions (not yet confirmed by Owen)
- IBKR activity statement is the reference broker export. Canonical CSV ships first; IBKR importer later.
- About 4 evenings a week; 3 to 6 weeks total.
- Public URL required.

## Concept
- TWR measures how the strategy performed, independent of deposit timing. MWR (XIRR) measures what the investor actually earned including deposit timing. GIPS 2020 prefers TWR but allows MWR in some cases. Do not say "GIPS requires TWR".
- SGD decomposition: (1 + local return) x (1 + FX return) - 1. FX conversion cost (broker rate vs reference rate) reported separately.
- US dividends: 30% withholding for Singapore residents (no US-SG tax treaty). Irish-domiciled ETFs out of scope.
- Positioning: Sharesight, StocksCafe, Snowball and Portfolio Performance already compute TWR and IRR. This is not a new product. The difference is rigour, transparent method, and being free and Singapore-specific.

## Core user flow
1. Landing page shows the sample portfolio: SGD investor, 2019 to 2025, VOO + AAPL, monthly deposits, through the AAPL 4:1 split (ex-date 2020-08-31). Top: TWR, XIRR, a "Verified against Portfolio Performance" badge (full scope).
2. One rule-based sentence explaining the TWR vs XIRR gap (e.g. "XIRR is lower than TWR because most of your money arrived before the 2022 drawdown").
3. SGD daily value chart with deposits, withdrawals and FX conversions marked.
4. Decomposition: local price, FX, conversion cost, dividends (full scope).
5. Upload your own CSV. Computed on the server in memory, never stored. Ledger saved only in browser storage so a return visit shows updated numbers without an account.
6. Methodology page: every convention, the ECB cross-rate caveat, links to the golden tests.

## Canonical CSV
Columns: `date, type, ticker, quantity, price, currency, amount, fees`.

| Type | Meaning |
|---|---|
| DEPOSIT / WITHDRAW | SGD crossing the account boundary. The only external cash flows used for TWR and XIRR. |
| FX | Conversion at the broker's actual rate between per-currency cash balances. |
| BUY / SELL | Trades paid from the cash balance in the trade currency. |
| DIVIDEND | Dividend income (full scope). |

- Cash tracked and valued daily per currency, so held USD cash earns FX return.
- Conversion cost on an FX row = (broker rate - reference rate) x amount.
- Rows that would push a cash balance negative are rejected with a reason. Margin out of scope.
- Uploads with tickers outside the allowlist are rejected and the missing tickers listed. Never compute a partial result.

## Data
- **Tiingo EOD** `/tiingo/daily/{ticker}/prices` with unadjusted close, `splitFactor`, `divCash`. Free tier (from memory, verify): ~50 req/hour, 1,000/day, 500 unique symbols/month. The symbol limit binds.
- **Shared price cache**: each ticker fetched once, stored; one refresh request per ticker per night. Users never trigger provider calls.
- **Allowlist** of about 400 US tickers (major ETFs and large caps), preloaded. Ticker request queue adds up to ~100 a month. When exhausted: "monthly ticker limit reached, available from [date]".
- If Tiingo fails or quota runs out: serve cached prices labelled "as of [date]". Sample portfolio tickers are always cached so the demo never breaks.
- **FX**: Frankfurter API (ECB reference rates). USD/SGD is a cross rate through EUR set ~16:00 CET on TARGET business days. Gap rule for weekends and holidays: carry last rate forward, flagged. Used for valuation only; conversions use the broker rate from the CSV.
- Out of scope: SGX tickers.

## Hosting: Cloudflare Workers + D1 (free)
- Workers do not sleep; D1 does not pause. Cron triggers built in.
- Hono instead of Fastify (Fastify does not run on Workers). D1 (SQLite) instead of Postgres. decimal.js runs on Workers.
- Data size: 400 tickers x 20 years x 252 days is about 2M rows, within free limits.
- Nightly refresh: cron hourly 22:00 to 07:00 UTC after US close, 45 tickers per run to stay under 50/hour. Request queue first, then oldest prices. Frankfurter once a night.
- Tiingo key is a Worker secret (`.dev.vars` locally, never committed).

## Mobile
- Standard file input on phones opens Files / iCloud / Drive, so an emailed or Drive-saved export works.
- Ledger saved on device; each device uploads once; no device sync (would need accounts).
- Primary mobile view: TWR and XIRR as two large numbers, the explanation sentence, then the touch chart. Below: decomposition as stacked rows, flows as cards. No wide tables. Design for 360 px first.
- Web manifest only (installable). No offline caching.

## Stack
- React + Vite + TypeScript, mobile-first CSS.
- TradingView lightweight-charts (Apache 2.0, touch support).
- Hono on Cloudflare Workers, D1, cron triggers. Single worker serving the Vite build as static assets plus the API, if that keeps deploys to one step.
- decimal.js for all money maths; no floats in money paths.
- zod: one CSV schema shared by client and server.
- vitest with golden fixtures (hand-worked spreadsheet committed) plus an adjusted-close comparison test.

## The hard problem
Rebuilding a correct daily SGD valuation from a ledger with multi-currency cash, splits and FX conversions.
- Raw prices plus one ordered event stream, sorted by (exchange-local date, priority). Order on a day: split, ex-dividend, FX, trades.
- Splits change quantity on the ex-date; past trades are not rewritten.
- Dates are exchange-local calendar dates, never UTC timestamps. Holidays carry the last close forward.
- Dividends: entitlement on ex-date from prior-day holdings; cash on pay date after 30% withholding; fall back to ex-date if pay date missing (documented).

Conventions (methodology page):
- External flows counted at start of day (deposits arrive before that day's trades). End-of-day shown as a toggle.
- Annualise only for periods over one year; shorter periods show cumulative.
- XIRR: Newton from a stated starting guess, bisection fallback; "undefined" when flows never change sign; warning if more than one root in [-99%, 1000%].
- "Why we value from raw prices" panel: adjusted close is correct for a single buy-and-hold position; it double counts when used to value held quantities with intermediate cash flows. Show the error size on the sample.

Verification (full scope): rebuild the sample in Portfolio Performance; publish its TTWROR and IRR next to ours with tolerance 0.01 percentage points.

## Scope
**MVP (weeks 1 and 2):**
- SGD base, DEPOSIT / WITHDRAW / FX / BUY / SELL rows, per-currency cash.
- Splits, daily valuation, TWR and XIRR.
- Shared cache with the allowlist and nightly refresh.
- Landing page with sample portfolio, chart, two headline numbers.
- CSV upload with validation and rejected-row reasons.
- Mobile-first layout.
- Deployed.
- No dividends yet.

**Full scope, in cut order (cut from the bottom):**
1. Verification against Portfolio Performance plus the badge
2. Methodology page
3. IBKR importer
4. Ledger saved on the device
5. FX and conversion-cost decomposition
6. Dividends with 30% US withholding
7. Explanation sentence
8. Ticker request queue
9. "Why raw prices" panel
10. Tiger and moomoo importers
11. Web manifest
12. Benchmark with the same cash flows

## Risks
- Tiingo terms (internal use, no persistent storage). Owen accepted this risk. If the key is revoked the demo serves cached data.
- Matching Portfolio Performance may take days.
- ECB cross rate blurs the conversion-cost figure; stated, not fixed.
- Device-only storage is lost when browser data is cleared; say so on the page.
- Broker export formats change; importers need fixture tests from real exports.
