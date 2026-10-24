// Schematic figures for Methodology (decisions doc, 2026-10-24). Round illustrative numbers, not the sample's.
// Colours are the spec 11b tokens; text inherits Faded and Archivo from .method-figure.
// Four figures are interactive (decisions doc, "Interactive methodology figures"): numbers come from methodModels.ts,
// and each control's default reproduces the static drawing.

import { useState } from 'react';
import { D } from '../engine/decimal';
import type { FlowTiming } from '../engine/types';
import { formatPct, formatSgd } from './format';
import { BUY_INDEX, DAY, EX_INDEX, flowTiming, rawPrices, SGD_CASH, SHARES, twoNumbers, valuation } from './methodModels';

const cash = formatSgd(D(SGD_CASH));
const whole = (n: number) => n.toLocaleString('en-US');

function Slider(props: { label: string; value: number; min: number; max: number; step: number; text: string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>{props.label}</span>
      <span className="num">{props.text}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        aria-valuetext={props.text}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Choice<T extends string>(props: { name: string; legend: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <fieldset className="timing">
      <legend>{props.legend}</legend>
      {props.options.map(([v, text]) => (
        <label className="choice" key={v}>
          <input type="radio" name={props.name} checked={props.value === v} onChange={() => props.onChange(v)} />
          {text}
        </label>
      ))}
    </fieldset>
  );
}

const PERIODS = [
  { a: 30, b: 130, r: '+10%' },
  { a: 130, b: 230, r: '-5%' },
  { a: 230, b: 330, r: '+8%' },
];
const DEPOSIT_X = [30, 130, 230];
const DEPOSIT_NAMES = ['First deposit', 'Second deposit', 'Third deposit'];

export function TwoNumbersFigure() {
  const [deposits, setDeposits] = useState([1000, 5000, 1000]);
  const m = twoNumbers(deposits);
  return (
    <figure className="method-figure">
      <svg viewBox="0 0 360 176" role="img" aria-label={`Three deposits of ${deposits.map(whole).join(', ')} on a timeline: TWR chains the three period returns and ignores their size, XIRR is one rate that weights each deposit by its size.`}>
        <text x="0" y="14" fill="var(--pencil-blue)">TWR chains the periods: {formatPct(m.twr, 1)} a year</text>
        {PERIODS.map((p) => (
          <g key={p.a}>
            <path d={`M${p.a + 4} 50V42H${p.b - 4}V50`} fill="none" stroke="var(--pencil-blue)" strokeWidth="1.5" />
            <text x={(p.a + p.b) / 2} y="35" textAnchor="middle" fill="var(--pencil-blue)">{p.r}</text>
          </g>
        ))}
        <line x1="20" y1="76" x2="340" y2="76" stroke="var(--faded)" />
        {DEPOSIT_X.map((x, i) => (
          <g key={x}>
            {/* Size 1,000 draws r 4 and a 1.5 wide bar, 5,000 draws r 9 and 6 wide, as the static figure did. */}
            <circle className="moves" cx={x} cy="76" r="4" fill="var(--paper)" style={{ transform: `scale(${1 + (deposits[i] - 1000) / 3200})` }} />
            <text x={x} y="102" textAnchor="middle">{whole(deposits[i])}</text>
            <rect className="moves" x={x - 0.75} y="110" width="1.5" height="28" fill="var(--ledger-green)" style={{ transform: `scaleX(${1 + (deposits[i] - 1000) / 1333})` }} />
          </g>
        ))}
        <line x1="30" y1="139" x2="330" y2="139" stroke="var(--ledger-green)" strokeWidth="1.5" />
        <text x="0" y="168" fill="var(--ledger-green)">XIRR weights each deposit: {formatPct(m.xirr, 1)} a year</text>
      </svg>
      <div className="figure-controls">
        {DEPOSIT_NAMES.map((name, i) => (
          <Slider
            key={name}
            label={name}
            value={deposits[i]}
            min={500}
            max={10000}
            step={500}
            text={whole(deposits[i])}
            onChange={(v) => setDeposits(deposits.map((d, j) => (j === i ? v : d)))}
          />
        ))}
      </div>
      <figcaption>Change the deposit sizes. TWR stays where it is; XIRR moves, because it weights each deposit by its size.</figcaption>
    </figure>
  );
}

export function FlowTimingFigure() {
  const [timing, setTiming] = useState<FlowTiming>('start');
  const start = timing === 'start';
  const r = formatPct(flowTiming(timing), 2);
  const sum = start
    ? `${whole(DAY.end)} / (${whole(DAY.holding)} + ${whole(DAY.deposit)}) - 1, the deposit in the base`
    : `(${whole(DAY.end)} - ${whole(DAY.deposit)}) / ${whole(DAY.holding)} - 1, the deposit left out`;
  return (
    <figure className="method-figure">
      <svg viewBox="0 0 360 118" role="img" aria-label={`A ${whole(DAY.deposit)} deposit counted at the ${timing} of a day when a ${whole(DAY.holding)} holding rose 2%. The day's TWR is ${r}.`}>
        <g className="moves" style={{ transform: `translateX(${start ? 0 : 268}px)` }}>
          <text x="46" y="14" textAnchor="middle" fill="var(--paper)">{whole(DAY.deposit)} deposit</text>
          <path d="M46 18V30M46 38l-4 -8h8z" stroke="var(--paper)" strokeWidth="1.5" fill="var(--paper)" />
        </g>
        <rect x="46" y="40" width="268" height="26" fill="var(--brass)" fillOpacity="0.2" stroke="var(--brass)" />
        <text x="180" y="58" textAnchor="middle" fill="var(--paper)">+2% today</text>
        {/* The line under the band is the deposit's time in the day's base: all of it at the start, none at the end. */}
        <rect className="moves" x="46" y="70" width="268" height="2" fill="var(--paper)" style={{ transform: `scaleX(${start ? 1 : 0})`, transformOrigin: 'right' }} />
        <text x="0" y="94" fill="var(--pencil-blue)">TWR for the day: {r}</text>
        <text x="0" y="112">{sum}</text>
      </svg>
      <Choice
        name="figure-flow-timing"
        legend="Count the deposit at the"
        value={timing}
        options={[['start', 'Start of the day'], ['end', 'End of the day']]}
        onChange={setTiming}
      />
      <figcaption>Switch the timing. The day ends at {whole(DAY.end)} either way; only the base changes, and with it the day's TWR.</figcaption>
    </figure>
  );
}

export function ValuationFigure() {
  const [price, setPrice] = useState(400);
  const [rate, setRate] = useState(1.35);
  const v = valuation(price, rate);
  const usd = `USD ${whole(v.holdingUsd.toNumber())}`;
  const rows = [
    [whole(SHARES), 'shares', '×', `USD ${price}`, 'close', '=', usd, 'holding'],
    [usd, 'holding', '×', rate.toFixed(2), 'USD/SGD', '=', formatSgd(v.holdingSgd), 'in SGD'],
    [formatSgd(v.holdingSgd), 'in SGD', '+', cash, 'SGD cash', '=', formatSgd(v.value), "the day's value"],
  ];
  return (
    <figure className="method-figure">
      <svg viewBox="0 0 360 160" role="img" aria-label={`${SHARES} shares times a USD ${price} close is ${usd}, times a USD/SGD rate of ${rate.toFixed(2)} is ${formatSgd(v.holdingSgd)}, plus ${cash} of cash is a day's value of ${formatSgd(v.value)}.`}>
        {rows.map(([v1, l1, op1, v2, l2, op2, v3, l3], i) => (
          <g key={i} transform={`translate(0 ${i * 56})`}>
            {/* Outer columns hug the edges, so a wide SGD figure is not clipped. */}
            {([[0, 'start', v1, l1], [180, 'middle', v2, l2], [360, 'end', v3, l3]] as const).map(([x, anchor, val, l]) => (
              <g key={x}>
                <text x={x} y="20" textAnchor={anchor} fill="var(--paper)" fontSize="15" fontWeight={i === 2 && x === 360 ? 700 : 500}>{val}</text>
                <text x={x} y="38" textAnchor={anchor}>{l}</text>
              </g>
            ))}
            <text x="114" y="20" textAnchor="middle">{op1}</text>
            <text x="246" y="20" textAnchor="middle">{op2}</text>
          </g>
        ))}
      </svg>
      <div className="figure-controls">
        <Slider label="Close" value={price} min={300} max={500} step={5} text={`USD ${price}`} onChange={setPrice} />
        <Slider label="USD/SGD rate" value={rate} min={1.25} max={1.45} step={0.01} text={rate.toFixed(2)} onChange={setRate} />
      </div>
      <figcaption>Change the close or the rate. The holding follows both; the SGD cash stays at {cash}.</figcaption>
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

// Log scale, so adjusting a stretch of closes by one factor moves that stretch by one fixed distance.
const RAW = rawPrices('raw');
const ADJUSTED = rawPrices('adjusted');
const PRICE_X = [20, 80, 140, 200, 260, 300];
const priceY = (p: number) => 120 - 380 * Math.log(p / 90.16);

export function RawPricesFigure() {
  const [kind, setKind] = useState<'raw' | 'adjusted'>('raw');
  const shown = kind === 'raw' ? RAW : ADJUSTED;
  const raw = RAW.closes;
  const adj = ADJUSTED.closes;
  const ys = raw.map(priceY);
  const shift = priceY(adj[0]) - ys[0];
  const exX = PRICE_X[EX_INDEX];
  const buyX = PRICE_X[BUY_INDEX];
  // The stretch before the ex-date, drawn at raw positions and shifted down to the adjusted ones. The segment into
  // the ex-date keeps its right end fixed, so it is skewed about that end instead of shifted.
  const earlier = (adjusted: boolean, solid: boolean) => (
    <g fill={solid ? 'var(--paper)' : 'var(--faded)'} stroke="none">
      <g className="moves" style={{ transform: `translateY(${adjusted ? shift : 0}px)` }}>
        <polyline
          points={PRICE_X.slice(0, EX_INDEX).map((x, i) => `${x},${ys[i]}`).join(' ')}
          fill="none"
          stroke={solid ? 'var(--paper)' : 'var(--faded)'}
          strokeWidth="1.5"
          strokeDasharray={solid ? undefined : '4 3'}
        />
        <circle cx={buyX} cy={ys[BUY_INDEX]} r="3.5" />
        <text x={buyX - 6} y={ys[BUY_INDEX] - 6} textAnchor="end">{adjusted ? adj[BUY_INDEX] : raw[BUY_INDEX]}</text>
      </g>
      <line
        className="moves"
        x1={PRICE_X[EX_INDEX - 1]}
        y1={ys[EX_INDEX - 1]}
        x2={exX}
        y2={ys[EX_INDEX]}
        stroke={solid ? 'var(--paper)' : 'var(--faded)'}
        strokeWidth="1.5"
        strokeDasharray={solid ? undefined : '4 3'}
        style={{
          transform: `skewY(${adjusted ? (Math.atan(shift / (PRICE_X[EX_INDEX - 1] - exX)) * 180) / Math.PI : 0}deg)`,
          transformOrigin: `${exX}px ${ys[EX_INDEX]}px`,
          transformBox: 'view-box',
        }}
      />
    </g>
  );
  return (
    <figure className="method-figure">
      <svg viewBox="0 0 360 170" role="img" aria-label={`Raw and adjusted close end at the same price today; before the dividend the adjusted close sits lower, so on the buy date it shows ${adj[BUY_INDEX]} where ${raw[BUY_INDEX]} traded. TWR at ${kind} close: ${formatPct(shown.twr, 1)}.`}>
        <text x="0" y="14" fill="var(--pencil-blue)">TWR at {kind} close: {formatPct(shown.twr, 1)}</text>
        <line x1={buyX} y1="30" x2={buyX} y2="146" stroke="var(--brass)" />
        {earlier(kind === 'raw', false)}
        {earlier(kind === 'adjusted', true)}
        <polyline points={`${exX},${ys[EX_INDEX]} ${PRICE_X[5]},${ys[5]}`} fill="none" stroke="var(--paper)" strokeWidth="1.5" />
        <circle cx={PRICE_X[5]} cy={ys[5]} r="3.5" fill="var(--paper)" />
        <text x={PRICE_X[5]} y={ys[5] - 12} textAnchor="end">today</text>
        <text x={exX} y="164" textAnchor="middle">dividend</text>
        <text x={buyX} y="164" textAnchor="middle" fill="var(--brass)">buy</text>
      </svg>
      <Choice
        name="figure-raw-prices"
        legend="Value each day at the"
        value={kind}
        options={[['raw', 'Raw close'], ['adjusted', 'Adjusted close']]}
        onChange={setKind}
      />
      <figcaption>Switch the close. The buy traded at {raw[BUY_INDEX]}; adjusted close draws it at {adj[BUY_INDEX]}, and the TWR moves with it.</figcaption>
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
