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

Before a file is chosen, Analyse is a two-column hero: title, lede, three lines of what the reader gets, broker tiles (a real radio group), a drag-and-drop zone around the upload control, and the privacy line on the left; a muted ghost of the result (rate slots, empty number line, empty chart frame) on the right. No sample data on this page. Overrides spec 15.1.5 picker and upload layout.

## Design review fixes for Home and Analyse (2026-10-24)

From the design review: hero tools (timing, share, print) sit under the number line, not beside the rates; on Analyse the picker and upload sit after the result with the label Choose another file; the result title is a generated money-in and date-range sentence with the filename in Faded under it; broker tiles ordered Interactive Brokers, Plain CSV, Tiger Brokers, moomoo; ghost hidden on phones; the what-you-get list sits above the ghost; Analyse empty title is Check your own broker file; brass removed from year notes and notice borders; Home story says "their" through a possessive argument on the explanation and raw-prices text; partial years labelled with their end date; scene rows capped at about 28rem.

## Interactive methodology figures (Owen, 2026-10-24)

Four Methodology figures are interactive with native controls whose defaults reproduce the static drawing: two numbers (deposit sizes, TWR fixed while XIRR moves), flow timing (start vs end of day), why raw prices (raw vs adjusted close), daily valuation (price and exchange rate). Numbers come from the engine's pure functions through models in `src/app/methodModels.ts`, checked by `methodModels.test.ts`. Decomposition and dividends stay static.

## Device-saved ledger reinstated (Owen, 2026-10-24)

Task 16 is built. After a successful result the file set, broker and flow timing are saved in localStorage under `honest-returns:ledger:v1` (`{ version: 1, files: { name, text }[], broker, timing, savedAt }`). On load a valid saved ledger is run again with fresh prices and shown with the notice "Saved on this device only. Clearing browser data removes it." and a Remove saved file button. Failed uploads do not save or clear. Storage errors are swallowed. Privacy copy now says a copy stays on this device until removed; the "nothing stored anywhere" rule in Checkpoint 3 is void for browser storage; nothing of the file ever reaches the server.

## Scene prose width (Owen, 2026-10-24)

At 960px and up the scene grid is prose first (max 56ch, which measures about 62 characters per line in the serif at the body size) with the right column sized to its content and aligned to the right edge; replaces the 5fr/7fr split. Row tables, the years table and Methodology figures keep their width and sit at the right edge; a lone action button sits at the right edge level with the first line of prose.

## Methodology sections removed (Owen, 2026-10-24)

The Verification, Out of scope and Golden tests sections are removed from the Methodology page, with `src/app/verification.ts`. The page ends with XIRR. Task 13 is dropped.

## Benchmark line in its own section (Owen, 2026-10-24)

The fund's dotted value line moves from the hero chart to a chart in the `Against a single fund` section, next to the portfolio value: the hero chart was crowded, and the comparison belongs where the fund's figures are.
