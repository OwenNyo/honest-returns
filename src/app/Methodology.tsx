import type { ReactNode } from 'react';
import { DAYS_PER_YEAR, MONTHLY_NEW_TICKERS, REPO_URL, US_WITHHOLDING, XIRR_GUESS, XIRR_RANGE } from '../engine/constants';
import { FOOTNOTES } from './footnotes';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const [LO, HI] = XIRR_RANGE;
const WITHHOLDING = pct(US_WITHHOLDING.toNumber());

// Spec 10.4. Numbers in the text come from the engine's constants. Sections 3, 6 and 10 open with footnotes a to c.
export function Methodology() {
  return (
    <article className="prose">
      <h1 className="hero-title">Methodology</h1>
      <p className="lede">
        How Honest Returns turns a broker file into two numbers, and every convention it uses. Your file is read in this
        browser and is never uploaded or stored: only the list of tickers and the first date are sent, to fetch prices.
      </p>

      <Section id="two-numbers" title="The two numbers">
        <p>
          TWR, the time-weighted return, measures how the investments did, independent of when money was added or taken
          out. It is the right number to judge a strategy or compare it with a fund.
        </p>
        <p>
          XIRR, the money-weighted return, measures what the investor earned, including the effect of the timing of
          deposits and withdrawals. GIPS 2020 prefers time-weighted returns and allows money-weighted returns in some
          cases. Showing both, side by side, is the point of this site.
        </p>
      </Section>

      <Section id="cash-flows" title="Cash flows">
        <p>
          Only SGD deposits and withdrawals cross the boundary of the portfolio. Currency conversions, trades and
          dividends move money inside it, so they are not cash flows.
        </p>
      </Section>

      <Section id="flow-timing" title="Flow timing">
        <p>{FOOTNOTES.a('start')}</p>
        <p>
          With V the value at the end of day d and F the deposits minus withdrawals on day d, the start-of-day daily return
          is V<sub>d</sub> / (V<sub>d-1</sub> + F<sub>d</sub>) - 1. The end-of-day return is (V<sub>d</sub> - F<sub>d</sub>)
          / V<sub>d-1</sub> - 1. A day whose base is zero or negative counts as no return. On Analyse you can switch your
          own file between the two.
        </p>
      </Section>

      <Section id="valuation" title="Daily valuation">
        <p>
          Every calendar day is valued, not only trading days: value = SGD cash + (USD cash + the sum of each holding times
          its close) x the USD/SGD rate. Within a day, rows apply in a fixed order (deposits, dividends, conversions,
          trades, withdrawals), and balances are checked at the end of the day.
        </p>
      </Section>

      <Section id="dates" title="Dates">
        <p>
          Dates are calendar dates as written in the file, with no time zone. The US close (16:00 New York) and the ECB
          fixing (16:00 CET) of the same date are combined.
        </p>
      </Section>

      <Section id="prices" title="Prices">
        <p>{FOOTNOTES.c}</p>
        <p>
          Splits are applied to the holding on the split date; past rows are never rewritten. Symbols listed outside the US,
          for example an Irish-domiciled ETF on the London Stock Exchange, are usually not available and are reported as
          unsupported tickers.
        </p>
      </Section>

      <Section id="exchange-rates" title="Exchange rates">
        <p>
          The rate is the ECB reference rate from Frankfurter. USD/SGD is a cross rate through the euro, fixed around 16:00
          CET on TARGET business days, and carried forward on other days, which is flagged. Conversions use the broker's own
          amounts from the file; the reference rate is used only for valuation.
        </p>
        <p>
          Interactive Brokers reports the commission on a currency conversion in SGD, even when USD is sold. The importer
          adds it to the SGD side of the conversion, so it shows up in the conversion cost.
        </p>
      </Section>

      <Section id="dividends" title="Dividends">
        <p>
          A dividend is due for the shares held at the start of its ex-date. Singapore residents have {WITHHOLDING} of US
          dividends withheld. A dividend row in your file is matched to the latest ex-date of that ticker in the 90 days
          before it and credits the amount minus the tax in the row; an empty tax field means {WITHHOLDING}. A dividend
          with no row is credited on the ex-date with {WITHHOLDING} withheld, and the page says how many were.
        </p>
        <p>
          No dividend receivable is carried between the ex-date and the pay date: the value dips on the ex-date and comes
          back on the pay date, as in Portfolio Performance.
        </p>
      </Section>

      <Section id="decomposition" title="Where the gain came from">
        <p>
          The total gain is the end value minus the money put in, in SGD. It is split per day. The exchange rate effect is
          the USD held at the start of the day times the change in the rate. The conversion cost is the SGD value given up
          on each conversion against the reference rate of that day. Dividends are the net dividend cash at that day's
          rate. The price effect is what is left, so it includes trade fees and the difference between trade prices and
          closes, and the parts always add up to the total exactly.
        </p>
        <p>
          The split is in SGD, not percentage points. For one holding, the SGD return is (1 + price return) x (1 + rate
          return) - 1, so the two effects interact, and splitting percentages over many days needs a linking method this
          site does not use.
        </p>
      </Section>

      <Section id="raw-prices" title="Why raw prices">
        <p>
          Many charting sites show adjusted close: past prices rewritten so that later dividends and splits are already
          inside them. For one position bought once and held, that gives the right return. Once money is added over time,
          it values the earlier holdings at prices that never traded, so the daily values and the TWR drift from what the
          account was worth. This site values each day at the close that traded that day and applies splits to the
          holding on the split date. The Analyse page shows how far the adjusted-close TWR would be from yours.
        </p>
      </Section>

      <Section id="annualising" title="Annualising">
        <p>
          Periods over {DAYS_PER_YEAR} days are annualised with a {DAYS_PER_YEAR}-day year. Shorter periods show the total
          return, because annualising a few weeks magnifies noise.
        </p>
      </Section>

      <Section id="xirr" title="XIRR">
        <p>{FOOTNOTES.b}</p>
        <p>
          Newton's method starts from {pct(XIRR_GUESS)}. If it does not settle inside {pct(LO)} to {pct(HI)}, bisection
          searches that range. If more than one rate in the range balances the flows, the page says so and shows the one
          found from {pct(XIRR_GUESS)}.
        </p>
      </Section>

      <Section id="out-of-scope" title="Out of scope">
        <p>
          Accounts, SGX tickers, Irish-domiciled ETFs, currencies other than SGD and USD, margin and short positions,
          interest on cash, cash in lieu on reverse splits and options. A file that needs any of these is rejected or, for
          options in an Interactive Brokers statement, skipped with a notice.
        </p>
      </Section>

      <Section id="ticker-requests" title="Ticker requests">
        <p>
          A ticker that is not supported yet can be requested from the upload result. Up to {MONTHLY_NEW_TICKERS} new
          tickers are added each month, overnight.
        </p>
      </Section>

      <Section id="tests" title="Golden tests">
        <p>
          Every rule above is pinned by hand-worked test cases in the{' '}
          <a href={`${REPO_URL}/tree/master/src/engine`}>engine tests on GitHub</a>.
        </p>
      </Section>
    </article>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="method-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
