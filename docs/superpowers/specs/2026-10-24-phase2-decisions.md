# Phase 2 decisions (orchestrator, 2026-10-24)

Technical readings taken at the test-writer checkpoint for the engine batch. They bind the driver. Owen may overturn any of them at the next checkpoint.

1. **Importer result shape** is the plan's: `importIbkr(text) -> { csv, rejected, notices, sections }` where `notices: string[]` and `sections: Record<sectionName, { converted, skipped, rejected }>`. Total and SubTotal rows are not counted.
2. **OPENING rows**: a position row carries `ticker`, `quantity`, `price` (Prior Price), `currency` and `amount` = quantity x price, like a BUY. Positions must be in USD (`trade_currency` otherwise); opening cash may be SGD or USD. Date = the first date of the statement Period. The engine applies OPENING rows before any other row that day; the opening inflow for TWR and XIRR is the SGD value of the opening positions at that day's (carried) close plus opening cash at that day's FX rate. The row price is informational.
3. **IBKR Forex commission** is reported in SGD even when USD is sold. The importer folds it into the SGD leg (reduce SGD received, or increase SGD paid) and writes `fees` = 0 on the FX row. A one-line note goes on the methodology page.
4. **DIVIDEND fees**: an empty `fees` field means "apply the default 30% withholding"; an explicit value, including 0, is used as the actual withholding. The parser must therefore distinguish empty from 0 on DIVIDEND rows (for example an optional `withholding` field on the row, null when empty). Matched rows credit `amount - withholding`.
5. **Benchmark list** is exported as `BENCHMARKS = ['VOO', 'VT', 'QQQ'] as const` from the benchmark module, VOO default.
6. **Dependency order**: Task 18 (dividends) is built before Task 21 (adjusted close panel) because Golden E includes an ex-date dividend.

## UI batch decisions (orchestrator, 2026-10-24), answering spec 15.6

1. Device-saved ledger: still Owen's call. Until then Task 16 stays cancelled; nothing is stored anywhere.
2. IBKR opening-balance reconciliation: positions must match within 0.0001 shares or the file is rejected (reconciliation message naming the symbol and both figures). Cash may differ, because the engine does not model interest, account fees or options: the difference per currency is booked as a labelled `ADJUST` cash row dated the later statement's start, with a notice `Cash adjusted by {amount} {currency} on {date} to match the statement (interest, fees or options not modelled).` ADJUST rows are not external flows.
3. Canonical CSV files combined: never flag gaps. Overlap rule applies.
4. Share card lives on Analyse only. The sample can be shared from there via the Sample tab.
5. Navbar: the brand is the Home link; no separate Home item. Items: Analyse, Methodology, GitHub.
6. PDF via the print dialog is accepted; no PDF dependency. Revisit only if Owen asks for a direct download.
7. Order: 25, 26, 14, then 13, 20, 23, 27, 28, 29, then the engine-fed sections (17, 18, 21, 24 UI wiring), then 30 after 15.

## Analyse page broker picker (Owen, 2026-10-24)

Task 25 adds a broker picker above the upload button on Analyse, which also serves as the supported-formats list: `Interactive Brokers activity statement (CSV)` (supported), `Tiger Brokers` and `moomoo` (shown disabled with "coming soon"), and `Plain CSV` with a link that downloads the canonical template (header line plus two example rows). Format detection still runs on the chosen file; a mismatch between the pick and the detected format shows `This looks like a {detected} file, not a {picked} file.` and does not compute. The picker is a radio group styled with 11b tokens; the Home page's closing call to action links to Analyse.

## Navbar without GitHub (Owen, 2026-10-24)

No GitHub link in the navbar. Navbar items are the brand (Home), Analyse and Methodology. The Methodology page may still link to the repository's golden tests in its text, as spec 10.x already describes; that is the only place the repo is referenced.

Reverted (Owen, same day): keep the GitHub link. Navbar items are the brand (Home), Analyse, Methodology and GitHub, as spec 15.1 says. The "Navbar without GitHub" section above is void.

## UI batch test-writer rulings (orchestrator, 2026-10-24)

1. `DAILY_CLIENT_REQUESTS = 10` per hashed client IP per UTC day on the ticker request endpoint; the eleventh POST returns HTTP 429 `{ error: 'too_many_requests' }`. Every POST counts. The raw IP is never stored; store a salted SHA-256 of `CF-Connecting-IP` (salt from a Worker secret `REQUEST_SALT`, falling back to a constant in dev).
2. `runUpload` accepts either a single CSV string (existing behaviour and tests) or an array of `{ name, text }` files (Task 29 and 30). No call-site edits to existing tests.
3. Cash reconciliation between combined IBKR statements: any nonzero difference per currency is booked as an ADJUST row (no tolerance); the notice uses signed two-decimal amounts; the reconciliation date is the day before the later statement starts; `runUpload` returns `notices` so the UI can show them.
4. Migration `0003_ticker_requests.sql` is created by the driver in Task 20 with the columns the tests imply.

## Home page call to action (Owen, 2026-10-24)

The Home page has one brass button, in the closing scene. The hero carries a plain text link `Skip the story and check your own file` instead of a second button. Overrides spec 15.1.4 scene 1.

## Analyse page is for your own file (Owen, 2026-10-24)

The Analyse page no longer shows the sample and has no Sample / Your file tabs. Before a file is chosen it shows the broker picker, the upload button and one sentence. The sample appears only in the Home story. Overrides spec 15.1.5 tabs and the share card / PDF on the sample. `src/app/ResultTabs.tsx` removed.

## Methodology covers the method only (Owen, 2026-10-24)

The Methodology page describes the calculation and its conventions only. The privacy sentence in the lede and the Ticker requests section are removed; privacy wording lives on the Analyse page and the Home closing scene.

## Home hero shows the numbers only (Owen, 2026-10-24)

The Home hero has no verification badge and no skip link. The hero is the title, the two rates, the explanation sentence, the number line and the chart. The only call to action on Home is the brass button in the closing scene. Overrides spec 15.1.4 scene 1 and the earlier "Home page call to action" note.

## Methodology layout and figures (Owen, 2026-10-24)

The Methodology page uses the Home story's two-column scene grid at 960px and up: prose left, an inline SVG figure right, stacked on phones. Six schematic figures with round illustrative numbers in `src/app/MethodFigures.tsx`: two numbers, flow timing, daily valuation, decomposition, raw vs adjusted close, dividends. Figures are drawn in code with the palette tokens, no image assets. Overrides spec 10.4 single-column prose.

## Home actions are buttons in the right column (Owen, 2026-10-24)

Site rule: calls to action are buttons, never underlined links in prose. Brass `.button` for the page's main action, outlined `.button.secondary` for navigation actions such as Read the methodology. On Home each scene's action sits in the Scene `rows` column, level with the prose. All buttons have hover and focus-visible states: lighter brass, 1px lift, soft shadow; colour-only under reduced motion. The two closing scenes run to four sentences, overriding the three-sentence cap in spec 15.1.4. Copy as built.

## Analyse empty state (Owen, 2026-10-24)

Before a file is chosen, Analyse is a two-column hero: title, lede, three lines of what the reader gets, broker tiles (a real radio group), a drag-and-drop zone around the upload control, and the privacy line on the left; a muted ghost of the result (rate slots, empty number line, empty chart frame) on the right. No sample data on this page. Below 960 px, where the ghost is hidden, the order is title, lede, what-you-get list, tiles, drop zone, privacy line. Overrides spec 15.1.5 picker and upload layout.

## Design review fixes for Home and Analyse (2026-10-24)

From the design review: hero tools (timing, share, print) sit under the number line, not beside the rates; on Analyse the picker and upload sit after the result with the label Choose another file; the result title is a generated money-in and date-range sentence with the filename in Faded under it; broker tiles ordered Interactive Brokers, Plain CSV, Tiger Brokers, moomoo; ghost hidden on phones; the what-you-get list sits above the ghost; Analyse empty title is Check your own broker file; brass removed from year notes and notice borders; Home story says "their" through a possessive argument on the explanation and raw-prices text; partial years labelled with their end date; scene rows capped at about 28rem.

## Interactive methodology figures (Owen, 2026-10-24)

Four Methodology figures are interactive with native controls whose defaults reproduce the static drawing: two numbers (deposit sizes, TWR fixed while XIRR moves), flow timing (start vs end of day), why raw prices (raw vs adjusted close), daily valuation (price and exchange rate). Numbers come from the engine's pure functions through models in `src/app/methodModels.ts`, checked by `methodModels.test.ts`. Decomposition and dividends stay static.

## Device-saved ledger reinstated (Owen, 2026-10-24)

Task 16 is built. After a successful result the file set, broker and flow timing are saved in localStorage under `honest-returns:ledger:v1` (`{ version: 1, files: { name, text }[], broker, timing, savedAt }`). On load a valid saved ledger is run again with fresh prices and shown with the notice "Saved on this device only. Clearing browser data removes it." and a Remove saved file button. Failed uploads do not save or clear. Storage errors are swallowed. Privacy copy now says a copy stays on this device until removed; the "nothing stored anywhere" rule in Checkpoint 3 is void for browser storage; nothing of the file ever reaches the server.

## Scene prose width (Owen, 2026-10-24)

At 960px and up the scene grid is prose first (max 56ch, which measures about 62 characters per line in the serif at the body size) with the right column sized to its content and aligned to the right edge; replaces the 5fr/7fr split. Row tables, the years table and Methodology figures keep their width and sit at the right edge; a lone action button sits at the right edge level with the first line of prose. On Methodology from 1152px the right column is a fixed 28rem in every section, with or without a figure, so every prose block has the same measure. Between 960 and 1151px Methodology is one column, with each figure under its prose, so the prose keeps its measure.

## Methodology sections removed (Owen, 2026-10-24)

The Verification, Out of scope and Golden tests sections are removed from the Methodology page, with `src/app/verification.ts`. The page ends with XIRR. Task 13 is dropped.

## Benchmark line in its own section (Owen, 2026-10-24)

The fund's dotted value line moves from the hero chart to a chart in the `Against a single fund` section, next to the portfolio value: the hero chart was crowded, and the comparison belongs where the fund's figures are.
## Partial reports (Owen, 2026-10-24)

Spec section 16, Tasks 31 to 33. When an upload has tickers with no price data, the rejection screen adds `Continue without these holdings`; nothing is computed until the user picks it.

1. Exclusion happens on the ledger before reconciliation and compute (`excludeTickers` in `src/engine/exclude.ts`), so TWR, XIRR, decomposition, dividends, the adjusted-close panel and the benchmark all see the reduced flows. The benchmark needs no change: `shadowLedger` reads `netFlowSgd`.
2. An excluded BUY becomes a USD WITHDRAW of `amount + fees`; an excluded SELL or DIVIDEND becomes a USD DEPOSIT of `amount - fees`; excluded OPENING positions are dropped. Cash balances stay identical to the original ledger, so the exclusion cannot cause `negative_cash`. No new row type. Files still may not contain USD flows (`flow_currency`).
3. The engine converts USD flows at the day's valuation rate (latest ECB point on or before the day), the rate it already uses for opening values. Only SGD DEPOSIT rows count as the investor's deposits in the explanation sentence.
4. Share of what was bought = excluded gross buys plus excluded opening positions (row amount) over all gross buys plus all opening positions, rates from the series. Whole percent, always 0 to 100%. The explorer's draft divided by gross money in, which could exceed 100% with recycled sale proceeds; replaced without consulting Owen as it changes only the label's denominator.
5. Labels: screen copy names the tickers; the share card and PDF give the count only (`Excludes 1 holding, 50% of what was bought.`), keeping the no-ticker rule of spec 15.2 and 15.3.
6. Saved ledger remembers the list (`exclude: string[]` in `honest-returns:ledger:v1`, missing reads as empty). A reload shows the same partial report. The timing toggle keeps the exclusion; a new or added file starts without one.
7. Availability rejections carry `tickers: string[]`; the message parser in `RequestTickers.tsx` is removed.
8. Review finding "empty reduced ledger", resolved: when the earliest file has no rows left after exclusion, the upload rejects with `nothing_left` instead of crashing in valuation or reconciliation.
9. The result title names one or two excluded tickers and gives the count for three or more (`excluding 8 holdings, 86% of what was bought`): a long ticker list ran the title to several lines, and the notice under the numbers still lists the names.

## Site footer (2026-10-24)

Home ended at the closing button with no closure, so a footer was added to every page (spec 11c): brand, Analyse, Methodology and GitHub links, and the Tiingo, ECB and TradingView credits. The Home closing scene is unchanged.

## Third round (2026-10-25)

Spec section 17, Tasks 34 to 38. Explorer readings, settled by Owen at the checkpoint the same day: items 3 and 7 confirmed as written, items 4 and 5 changed, item 11 added.

1. **moomoo goes ahead without a real export.** Overrides Checkpoint 1 decision 11 for moomoo only: the importer is built from third-party reports and a synthetic fixture, and the plan (Task 37) lists what to check when Owen supplies a file. The file read is the order history CSV from the desktop app (Trade History, History tab), not a statement: Singapore statements are PDF only.
2. **Tiger stays blocked** on a real sample file. No public header list exists. Its tile stays "coming soon".
3. **moomoo funding** (confirmed by Owen): each day's net USD shortfall over the file's own fills becomes a same-day USD DEPOSIT, and the user is told in a notice. Rejected: refusing trade-only files (moomoo would stay unusable), and an SGD DEPOSIT plus an FX row at the ECB rate (invents a conversion and a zero conversion cost). USD DEPOSIT rows reach the parser through a `usdFlows` option that only the moomoo path sets; plain files still reject them with `flow_currency`.
4. **Explanation deposits count USD DEPOSIT rows** at the day's rate, **read from the ledger before exclusion** (Owen). Changes the "Partial reports" item 3 rule ("only SGD DEPOSIT rows count"): without it, every moomoo report gets the generic sentence. `runUpload` passes `combined.rows` (held before `excludeTickers` runs) as `ComputeInput.originalLedger`, so the synthetic USD deposits from excluded sales and dividends never count as money put in. Home uses the same `explanationDeposits` function. Spec 16.2 change 3 and 17.1.8.
5. **moomoo orders on other markets are left out with a notice** (Owen; replaces the reject rule in the brief): `{n} orders on {markets} markets were left out; this report covers US trades only.` They are never checked, converted or funded. A US-market order not in USD is still rejected with `trade_currency`.
6. **One moomoo file per report** (`moomoo_files`): funding starts from zero cash in each file, so two files would count money in twice.
7. **Largest fall and volatility** sit in their own Scene on Analyse and Home, not in the Returns hero, because "Home hero shows the numbers only" fixes the hero's contents. Both come from the TWR daily returns, so flows are not falls. Volatility: sample standard deviation of every calendar day's return times `sqrt(365)`, shown from 90 days (confirmed by Owen).
8. **Fees and tax in the decomposition**: a `fees` line (BUY and SELL fees at the row date's rate) comes out of the price residual; identity `totalGain = local + fx - conversionCost - fees + dividends`. Dividends show before tax with `US tax withheld` as its own line, so every row still adds up to Total gain. Golden D: local 140 (was 138.7), fees 1.3.
9. **Calendar-year table** on Analyse only, all years, partial years labelled with their days, shown from two years. Home already has the per-year rows in `Why they differ`, so it gets no second table.
10. **Analyse section order**: Returns, Year by year, Largest fall and volatility, Where the gain came from, Dividends, Against a single fund, Why raw prices. On Home the risk Scene follows `Why they differ`. No scroll-spy at seven sections.
11. **moomoo Fill Time is Singapore time** (Owen): a fill before 09:00 is dated the previous calendar day, because US regular and extended sessions run from about 16:00 to 08:00 Singapore time. `08:59:59` on 15 March gives 14 March; `09:00:00` gives 15 March. A `ponytail:` ceiling (zone label ignored, overnight session not handled), on the Task 37 list of checks against a real export. Spec 17.1.5.

## Remove file on a failed upload (2026-10-25)

Every state after an upload shows a remove button, not only a result. On a rejected, empty, mismatched or errored upload it reads `Remove file`, clears the file state and clears the saved set in localStorage, so nothing comes back on reload. Owen asked for it after a rejected IBKR file left no way back to the empty page.

## Fourth round (2026-10-25)

Spec section 18, Tasks 39 to 42. Items 1 to 6 and 9 to 12 were settled by Owen in the grill; items 7, 8 and 13 to 16 are explorer readings; items 17 and 18 are Owen's checkpoint answers the same day.

1. **Download the converted file**: one button per IBKR or moomoo file, offering that file's own importer output (the canonical CSV), not the merged or reduced ledger. Plain CSV files get no button. Named `{name without extension}-converted.csv`, saved through a Blob and object URL from a `<button>` (the share card's pattern, now `saveBlob` in `shareCard.ts`), never a `data:` link.
2. **When it shows**: after a result, and after a rejection from valuation or compute. Importer, parse and combine rejections, and availability rejections, show no button. `runUpload`'s rejected outcome carries `converted?: { name, csv }[]` for engine rejections only; `combineFiles` exposes `converted`, earliest first.
3. **Plain files accept USD DEPOSIT and WITHDRAW** (Owen): the parser's `flow_currency` check and the `usdFlows` option go. Overrides "Partial reports" item 2 ("Files still may not contain USD flows") and "Third round" item 3 (the `usdFlows` option). The IBKR importer now accepts USD deposits too (item 17).
4. **Where the button lives**: on a result, in the hero notices block after the notices, with `The notices above do not travel with the converted file.` when there are notices; after an engine rejection, in the file-status block under the rejection list.
5. **What does not travel**: the IBKR statement period (so gap notices stop), the options-skipped notice, the moomoo funding notice, and the cash adjustments (they are booked again when the converted set is uploaded).
6. **Privacy unchanged**: the file is built and saved in the browser; no server change.
7. **Rejection line numbers** stay lines of the original file, with one sentence next to the button: `Line numbers above count lines in your original file, not in the converted file.` Rejected: a second line number on every rejection.
8. **`reconcile` rejections other than `reconcile_position`** come from its valuation pass, so they get the button.
9. **Gain by holding** (Owen asked for "What you hold"; title `Gain by holding` chosen because the rows include closed positions and the right column is the gain): a Scene on Analyse only, right after `Where the gain came from`. Never on Home, the share card or the PDF.
10. **Rows**: one per ticker ever held (closed positions at 0 shares), SGD cash, USD cash, `Cash and exchange on cash` (total gain less the ticker gains), and the total, whose gain equals `decomposition.totalGain` exactly.
11. **Ticker gain** in SGD = end value + sales (amount - fees) + net dividends (row and ex-date) - buys (amount + fees) - opening value at the carried close, each at its date's rate. Excluded tickers have no row and the section repeats `These figures leave out ...`. Flow timing has no effect.
12. **Engine owns the arithmetic**: `holdingRows` in `src/engine/holdings.ts` returns Decimal rows; the UI only formats. It reads closes from `prices` instead of `ValuationPoint` gaining per-ticker values.
13. **Layout** (accepted by Owen, item 18): the existing two-cell `.row` with a faded second line (`5 shares, SGD 1,474.00, 69.4%`), gain on the right, a header row `Holding` / `Gain since {first date}`. Five real columns do not fit 360 px or the 28rem rows column. For the design reviewer: a `<table>` in the Scene `below` slot with a phone fallback is the alternative.
14. The total row is labelled `Total` (its second line shows the end value as well).
15. Ticker rows are sorted A to Z; cash rows show value and weight but no gain.
16. Weights are of the end value and `null` (not shown) when the end value is 0.
17. **IBKR USD deposits and withdrawals** (Owen, checkpoint): a `Deposits & Withdrawals` row in USD becomes a USD DEPOSIT or WITHDRAW, counted as money in or out at that day's rate like an SGD row. Other currencies are still rejected with `flow_currency`, whose message becomes `DEPOSIT and WITHDRAW must be in SGD or USD.` Part of Task 39. Overrides spec 10.11 and the Task 15 addendum (SGD only).
18. **Accepted by Owen at the checkpoint**: the title `Gain by holding` and the two-line row layout (item 13).
