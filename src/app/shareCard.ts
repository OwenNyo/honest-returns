import type { ComputeResult } from '../engine/types';
import { cssVar } from './css';
import { excludesLine, formatDate, formatPct, formatSgd } from './format';
import { numberLineScale } from './numberline';
import type { Excluded } from './upload';

type Ok = ComputeResult & { ok: true };
export type CardSize = '1200x630' | '1080x1080';
export interface Tokens { ink: string; binding: string; paper: string; faded: string; brass: string; blue: string; green: string; rule: string }
type Rate = { text: string; unit: string; pct: number };

// Spec 15.2: only these fields reach the card. No ledger, no tickers, no SGD amounts unless opted in.
export interface CardData {
  period: string;
  twr: Rate;
  xirr: Rate | null; // null: XIRR cannot be calculated
  gap: string | null; // from the Decimal values, as the Hero and the statement print it
  explanation: string;
  sgdLine: string | null;
}

export const SITE = 'honest-returns.owennyo.com';

export function cardData(result: Ok, includeSgd: boolean, excluded?: Excluded | null): CardData {
  const first = result.series[0];
  const last = result.series[result.series.length - 1];
  const unit = (annualised: boolean) => (annualised ? 'a year' : 'in total');
  const { twr, xirr } = result;
  return {
    period: `${formatDate(first.date)} to ${formatDate(last.date)}`,
    twr: { text: formatPct(twr.value, 1), unit: unit(twr.annualised), pct: Number(twr.value.times(100).toFixed(2)) },
    xirr:
      xirr.kind === 'ok'
        ? { text: formatPct(xirr.value, 1), unit: unit(xirr.annualised), pct: Number(xirr.value.times(100).toFixed(2)) }
        : null,
    gap: xirr.kind === 'ok' ? xirr.value.minus(twr.value).abs().times(100).toFixed(1) : null,
    explanation: (result.explanation ?? '') + (excluded ? ` ${excludesLine(excluded)}` : ''),
    sgdLine: includeSgd ? `Value ${formatSgd(last.valueSgd)}, money in ${formatSgd(last.netInvestedSgd)}` : null,
  };
}

// Layout per size, in px. 64 px margins; the bottom 72 px band is Binding.
const LAYOUT = {
  '1200x630': { w: 1200, h: 630, title: 96, period: 96, label: 150, value: 250, valueSize: 120, unit: 285, axis: 340, ticks: 385, gap: 422, text: 466, textSize: 30, lineH: 36 },
  '1080x1080': { w: 1080, h: 1080, title: 96, period: 140, label: 260, value: 400, valueSize: 150, unit: 440, axis: 520, ticks: 570, gap: 612, text: 680, textSize: 36, lineH: 46 },
};
const M = 64;
const BAND = 72;

// Splits text into lines no wider than `width`.
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export function drawCard(ctx: CanvasRenderingContext2D, data: CardData, size: CardSize, t: Tokens): void {
  const L = LAYOUT[size];
  const right = L.w - M;
  ctx.fillStyle = t.ink;
  ctx.fillRect(0, 0, L.w, L.h);
  ctx.fillStyle = t.binding;
  ctx.fillRect(0, L.h - BAND, L.w, BAND);
  ctx.textBaseline = 'alphabetic';

  // Setting ctx.font resets ctx.fontStretch, so the stretch is set after the font, every time.
  const setFont = (font: string, condensed = false) => {
    ctx.font = font;
    if ('fontStretch' in ctx) ctx.fontStretch = condensed ? 'condensed' : 'normal';
  };
  const text = (s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'left', condensed = false) => {
    setFont(font, condensed);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(s, x, y);
  };

  text('Honest Returns', M, L.title, '800 32px Archivo', t.paper);
  if (size === '1200x630') text(data.period, right, L.period, '600 24px Archivo', t.faded, 'right');
  else text(data.period, M, L.period, '600 24px Archivo', t.faded);

  // Width 75 where the browser supports it; otherwise step the size down until both numbers fit their half.
  const half = (L.w - 2 * M) / 2;
  let valueSize = L.valueSize;
  const fits = (s: string) => {
    setFont(`800 ${valueSize}px Archivo`, true);
    return ctx.measureText(s).width <= half - 32;
  };
  const values = [data.twr.text, data.xirr?.text ?? ''];
  while (valueSize > 24 && !values.every(fits)) valueSize -= 4;

  const rate = (label: string, r: Rate | null, x: number, color: string) => {
    text(label, x, L.label, '600 24px Archivo', color);
    if (r) {
      text(r.text, x, L.value, `800 ${valueSize}px Archivo`, color, 'left', true);
      text(r.unit, x, L.unit, '600 24px Archivo', color);
    } else text('Cannot be calculated', x, L.value - valueSize / 3, '600 36px Archivo', color);
  };
  rate('TWR', data.twr, M, t.blue);
  rate('XIRR', data.xirr, M + half, t.green);

  // Number line: axis and ticks in Rule, the gap band in Brass, the marks in their colours.
  const { min, max, ticks } = numberLineScale(data.twr.pct, data.xirr?.pct ?? data.twr.pct);
  const x = (v: number) => M + ((v - min) / (max - min)) * (L.w - 2 * M);
  ctx.fillStyle = t.rule;
  ctx.fillRect(M, L.axis - 1, L.w - 2 * M, 2);
  for (const v of ticks) {
    ctx.fillStyle = t.rule;
    ctx.fillRect(x(v) - 1, L.axis - 8, 2, 16);
    text(`${v}%`, x(v), L.ticks, '400 20px Archivo', t.faded, v === min ? 'left' : v === max ? 'right' : 'center');
  }
  const tx = x(data.twr.pct);
  if (data.xirr && data.gap) {
    const xx = x(data.xirr.pct);
    ctx.fillStyle = t.brass;
    ctx.fillRect(Math.min(tx, xx), L.axis - 16, Math.abs(tx - xx), 32);
    ctx.fillStyle = t.green;
    ctx.fillRect(xx - 2, L.axis - 24, 4, 48);
    const mid = Math.min(Math.max((tx + xx) / 2, M + 80), right - 80);
    text(`${data.gap} points`, mid, L.gap, '800 26px Archivo', t.brass, 'center');
  }
  ctx.fillStyle = t.blue;
  ctx.fillRect(tx - 2, L.axis - 24, 4, 48);

  // Explanation: at most 3 lines; the font steps down 2 px until it fits.
  let textSize = L.textSize;
  let lines: string[] = [];
  for (; textSize > 12; textSize -= 2) {
    setFont(`400 ${textSize}px "Source Serif 4"`);
    lines = wrap(ctx, data.explanation, L.w - 2 * M);
    if (lines.length <= 3) break;
  }
  const lineH = L.lineH * (textSize / L.textSize);
  lines.forEach((line, i) => text(line, M, L.text + i * lineH, `400 ${textSize}px "Source Serif 4"`, t.paper));

  const bandY = L.h - BAND / 2 + 8;
  text(SITE, M, bandY, '600 22px Archivo', t.faded);
  if (data.sgdLine) text(data.sgdLine, right, bandY, '600 22px Archivo', t.paper, 'right');
}

export const FONT_ERROR = 'The image could not be drawn because the fonts did not load. Try again.';
const FONTS = ['800 96px Archivo', '600 24px Archivo', '400 30px "Source Serif 4"'];

// Draws the card at its exact pixel size and downloads it. Throws FONT_ERROR when a web font is missing,
// so a card in a fallback font is never produced.
export async function downloadCard(result: Ok, size: CardSize, includeSgd: boolean, excluded: Excluded | null): Promise<void> {
  await Promise.all(FONTS.map((f) => document.fonts.load(f)));
  if (!FONTS.every((f) => document.fonts.check(f))) throw new Error(FONT_ERROR);
  const tokens: Tokens = {
    ink: cssVar('--ink'),
    binding: cssVar('--binding'),
    paper: cssVar('--paper'),
    faded: cssVar('--faded'),
    brass: cssVar('--brass'),
    blue: cssVar('--pencil-blue'),
    green: cssVar('--ledger-green'),
    rule: cssVar('--rule'),
  };
  const { w, h } = LAYOUT[size];
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  drawCard(canvas.getContext('2d')!, cardData(result, includeSgd, excluded), size, tokens);
  const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('canvas.toBlob gave no image'))), 'image/png'));
  saveBlob(blob, `honest-returns-${size}.png`);
}

// An object URL, never a data: link (spec 18.1.3). Shared by the share card and the converted file.
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
