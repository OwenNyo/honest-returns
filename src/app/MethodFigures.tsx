// Schematic figures for Methodology (decisions doc, 2026-10-24). Round illustrative numbers, not the sample's.
// Colours are the spec 11b tokens; text inherits Faded and Archivo from .method-figure.

const PERIODS = [
  { a: 30, b: 130, r: '+10%' },
  { a: 130, b: 230, r: '-5%' },
  { a: 230, b: 330, r: '+8%' },
];
const DEPOSITS = [
  { x: 30, r: 4, w: 1.5, label: '1,000' },
  { x: 130, r: 9, w: 6, label: '5,000' },
  { x: 230, r: 4, w: 1.5, label: '1,000' },
];

export function TwoNumbersFigure() {
  return (
    <figure className="method-figure">
      <svg viewBox="0 0 360 176" role="img" aria-label="Three deposits of 1,000, 5,000 and 1,000 on a timeline: TWR chains the three period returns and ignores their size, XIRR is one rate that weights each deposit by its size.">
        <text x="0" y="14" fill="var(--pencil-blue)">TWR chains the periods: +4.1% a year</text>
        {PERIODS.map((p) => (
          <g key={p.a}>
            <path d={`M${p.a + 4} 50V42H${p.b - 4}V50`} fill="none" stroke="var(--pencil-blue)" strokeWidth="1.5" />
            <text x={(p.a + p.b) / 2} y="35" textAnchor="middle" fill="var(--pencil-blue)">{p.r}</text>
          </g>
        ))}
        <line x1="20" y1="76" x2="340" y2="76" stroke="var(--faded)" />
        {DEPOSITS.map((d) => (
          <g key={d.x}>
            <circle cx={d.x} cy="76" r={d.r} fill="var(--paper)" />
            <text x={d.x} y="102" textAnchor="middle">{d.label}</text>
            <line x1={d.x} y1="110" x2={d.x} y2="138" stroke="var(--ledger-green)" strokeWidth={d.w} />
          </g>
        ))}
        <line x1="30" y1="139" x2="330" y2="139" stroke="var(--ledger-green)" strokeWidth="1.5" />
        <text x="0" y="168" fill="var(--ledger-green)">XIRR weights each deposit: +2.4% a year</text>
      </svg>
      <figcaption>The 5,000 deposit missed the +10% year. TWR does not care; XIRR does.</figcaption>
    </figure>
  );
}

export function FlowTimingFigure() {
  const row = (y: number, title: string, start: boolean) => (
    <g>
      <text x="40" y={y} fill="var(--paper)">{title}</text>
      <rect x="40" y={y + 10} width="280" height="26" fill="var(--brass)" fillOpacity="0.2" stroke="var(--brass)" />
      <text x="180" y={y + 28} textAnchor="middle" fill="var(--paper)">+2% today</text>
      {start && <line x1="40" y1={y + 33} x2="320" y2={y + 33} stroke="var(--paper)" strokeWidth="2" />}
      {start ? (
        <path d={`M4 ${y + 23}H32M40 ${y + 23}l-8 -4v8z`} stroke="var(--paper)" strokeWidth="1.5" fill="var(--paper)" />
      ) : (
        <path d={`M356 ${y + 23}H328M320 ${y + 23}l8 -4v8z`} stroke="var(--paper)" strokeWidth="1.5" fill="var(--paper)" />
      )}
      <text x="40" y={y + 54}>{start ? 'The deposit shares in the +2%' : 'The deposit misses the +2%'}</text>
    </g>
  );
  return (
    <figure className="method-figure">
      <svg viewBox="0 0 360 156" role="img" aria-label="One day drawn twice: a deposit counted at the start of the day shares in that day's +2% return, a deposit counted at the end misses it.">
        {row(14, 'Start of day', true)}
        {row(94, 'End of day', false)}
      </svg>
      <figcaption>The arrow is the deposit; the band is the day's return.</figcaption>
    </figure>
  );
}

const VALUATION = [
  ['10', 'shares', '×', 'USD 400', 'close', '=', 'USD 4,000', 'holding'],
  ['USD 4,000', 'holding', '×', '1.35', 'USD/SGD', '=', 'SGD 5,400', 'in SGD'],
  ['SGD 5,400', 'in SGD', '+', 'SGD 600', 'SGD cash', '=', 'SGD 6,000', "the day's value"],
];

export function ValuationFigure() {
  return (
    <figure className="method-figure">
      <svg viewBox="0 0 360 160" role="img" aria-label="10 shares times a USD 400 close is USD 4,000, times a USD/SGD rate of 1.35 is SGD 5,400, plus SGD 600 of cash is a day's value of SGD 6,000.">
        {VALUATION.map(([v1, l1, op1, v2, l2, op2, v3, l3], i) => (
          <g key={i} transform={`translate(0 ${i * 56})`}>
            {[[48, v1, l1], [180, v2, l2], [312, v3, l3]].map(([x, v, l]) => (
              <g key={x}>
                <text x={x} y="20" textAnchor="middle" fill="var(--paper)" fontSize="15" fontWeight={i === 2 && x === 312 ? 700 : 500}>{v}</text>
                <text x={x} y="38" textAnchor="middle">{l}</text>
              </g>
            ))}
            <text x="114" y="20" textAnchor="middle">{op1}</text>
            <text x="246" y="20" textAnchor="middle">{op2}</text>
          </g>
        ))}
      </svg>
      <figcaption>USD cash joins the holdings before the conversion, SGD cash after it.</figcaption>
    </figure>
  );
}

export function DecompositionFigure() {
  return (
    <figure className="method-figure">
      <svg viewBox="0 0 360 108" role="img" aria-label="A gain of SGD 1,100 split into price +1,200 and dividends +200 to the right of zero, and exchange rate -200 and conversion cost -100 to the left of zero.">
        <text x="82" y="20">Exchange rate -200</text>
        <line x1="82" y1="24" x2="82" y2="46" stroke="var(--faded)" />
        <text x="298" y="20" textAnchor="middle" fill="var(--paper)">Total +1,100</text>
        <rect x="46" y="48" width="16" height="24" fill="var(--faded)" />
        <rect x="64" y="48" width="35" height="24" fill="var(--faded)" />
        <rect x="101" y="48" width="214" height="24" fill="var(--paper)" />
        <rect x="317" y="48" width="35" height="24" fill="var(--paper)" />
        {/* Zero: dashed and set in a wider gap, so it reads apart from the solid 2 px gaps between segments. */}
        <line x1="100" y1="48" x2="100" y2="72" stroke="var(--ink)" strokeWidth="6" />
        <line x1="100" y1="32" x2="100" y2="86" stroke="var(--paper)" strokeWidth="2" strokeDasharray="4 3" />
        <line x1="298" y1="26" x2="298" y2="78" stroke="var(--brass)" strokeWidth="2" />
        <line x1="54" y1="74" x2="54" y2="84" stroke="var(--faded)" />
        <line x1="208" y1="74" x2="208" y2="84" stroke="var(--faded)" />
        <line x1="334" y1="74" x2="334" y2="84" stroke="var(--faded)" />
        <text x="0" y="100">Conversion cost -100</text>
        <text x="208" y="100" textAnchor="middle" fill="var(--paper)">Price +1,200</text>
        <text x="360" y="100" textAnchor="end" fill="var(--paper)">Dividends +200</text>
      </svg>
      <figcaption>The vertical line is zero. Losses stack to its left, gains to its right.</figcaption>
    </figure>
  );
}

export function RawPricesFigure() {
  return (
    <figure className="method-figure">
      <svg viewBox="0 0 360 170" role="img" aria-label="Raw and adjusted close end at the same price today; going back in time the adjusted close sits lower, so on the buy date it shows 92 where 100 traded.">
        <polyline points="20,70 80,66 140,60 200,58 260,54 300,50" fill="none" stroke="var(--paper)" strokeWidth="1.5" />
        <polyline points="20,120 80,108 140,94 200,82 260,64 300,50" fill="none" stroke="var(--faded)" strokeWidth="1.5" strokeDasharray="4 3" />
        <line x1="80" y1="30" x2="80" y2="146" stroke="var(--brass)" />
        <circle cx="80" cy="66" r="3.5" fill="var(--paper)" />
        <circle cx="80" cy="108" r="3.5" fill="var(--faded)" />
        <circle cx="300" cy="50" r="3.5" fill="var(--paper)" />
        <text x="200" y="46" fill="var(--paper)">Raw close</text>
        <text x="200" y="100">Adjusted close</text>
        <text x="300" y="34" textAnchor="end">today</text>
        <text x="88" y="82" fill="var(--paper)">traded at 100</text>
        <text x="88" y="126">shown as 92</text>
        <text x="80" y="164" textAnchor="middle" fill="var(--brass)">buy</text>
      </svg>
      <figcaption>Adjusted close rewrites the past, so the buy sits at a price that never traded.</figcaption>
    </figure>
  );
}

export function DividendsFigure() {
  return (
    <figure className="method-figure">
      <svg viewBox="0 0 360 80" role="img" aria-label="A dividend of 100 split into 70 credited to the account and 30 withheld as US tax.">
        <text x="0" y="14" fill="var(--paper)">Dividend 100</text>
        <rect x="0" y="24" width="250" height="24" fill="var(--paper)" />
        <rect x="254" y="24" width="106" height="24" fill="var(--faded)" />
        <text x="0" y="70" fill="var(--paper)">70 credited</text>
        <text x="360" y="70" textAnchor="end">30 withheld</text>
      </svg>
      <figcaption>US withholding takes 30 before the dividend reaches the account.</figcaption>
    </figure>
  );
}
