import { env, exports } from 'cloudflare:workers';
import { beforeEach, expect, test } from 'vitest';
import { PricesResponse } from '../src/shared/api';

// Test tickers that are not on the real allowlist, so seeding does not clash with 0002_allowlist.sql.
const A_2018 = '[["2018-12-31","9","1","0"]]';
const A_2019 = '[["2019-01-02","10","1","0"],["2019-12-31","11","1","0"]]';
const A_2020 = '[["2020-01-02","12","1","0"],["2020-08-31","129.04","4.0","0.0"]]';
const B_2019 = '[["2019-01-02","20","1","0"]]';
const B_2020 = '[["2020-01-02","21","1","0"],["2020-06-30","22","1","0"]]';
const FX_2018 = '[["2018-12-31","1.36"]]';
const FX_2019 = '[["2019-01-02","1.3612"]]';
const FX_2020 = '[["2020-01-02","1.35"],["2020-12-30","1.33"]]';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM prices'),
    env.DB.prepare('DELETE FROM fx'),
    env.DB.prepare("DELETE FROM tickers WHERE ticker IN ('TSTA','TSTB','TSTC','VOO')"),
    env.DB.prepare(
      "INSERT INTO tickers (ticker, priority, last_date, refreshed_on, added_on) VALUES " +
        "('TSTA',0,'2020-08-31','2020-09-01','2020-01-01'), ('TSTB',0,'2020-06-30','2020-09-01','2020-01-01'), " +
        "('TSTC',0,NULL,NULL,'2020-01-01'), ('VOO',1,'2020-01-02','2020-09-01','2020-01-01')",
    ),
    env.DB.prepare('INSERT INTO prices (ticker, year, rows) VALUES (?,?,?), (?,?,?), (?,?,?), (?,?,?), (?,?,?), (?,?,?)').bind(
      'TSTA', 2018, A_2018, 'TSTA', 2019, A_2019, 'TSTA', 2020, A_2020,
      'TSTB', 2019, B_2019, 'TSTB', 2020, B_2020,
      'VOO', 2020, '[["2020-01-02","300","1","0"]]',
    ),
    env.DB.prepare('INSERT INTO fx (year, rows) VALUES (?,?), (?,?), (?,?)').bind(2018, FX_2018, 2019, FX_2019, 2020, FX_2020),
  ]);
});

const get = (qs: string) => exports.default.fetch(`http://x/api/prices?${qs}`);
const body = async (qs: string) => (await (await get(qs)).json()) as any;

test('prices for each ticker are its year rows concatenated in order', async () => {
  const b = await body('tickers=TSTA,TSTB&from=2019-01-02');
  expect(b.prices.TSTA).toEqual([...JSON.parse(A_2018), ...JSON.parse(A_2019), ...JSON.parse(A_2020)]);
  expect(b.prices.TSTB).toEqual([...JSON.parse(B_2019), ...JSON.parse(B_2020)]);
});

test('fx is the fx year rows concatenated in order', async () => {
  const b = await body('tickers=TSTA&from=2019-01-02');
  expect(b.fx).toEqual([...JSON.parse(FX_2018), ...JSON.parse(FX_2019), ...JSON.parse(FX_2020)]);
});

test('asOf is the earliest last_date among available tickers and the last fx date', async () => {
  expect((await body('tickers=TSTA,TSTB&from=2019-01-02')).asOf).toBe('2020-06-30');
});

test('asOf is capped by the last fx date', async () => {
  await env.DB.prepare("UPDATE tickers SET last_date = '2021-01-05' WHERE ticker = 'TSTA'").run();
  expect((await body('tickers=TSTA&from=2019-01-02')).asOf).toBe('2020-12-30');
});

test('from=2020-03-01 returns year rows from 2019 onwards only', async () => {
  const b = await body('tickers=TSTA&from=2020-03-01');
  expect(b.prices.TSTA).toEqual([...JSON.parse(A_2019), ...JSON.parse(A_2020)]);
  expect(b.fx).toEqual([...JSON.parse(FX_2019), ...JSON.parse(FX_2020)]);
});

test('stored strings are returned unchanged', async () => {
  const b = await body('tickers=TSTA&from=2020-03-01');
  expect(b.prices.TSTA).toContainEqual(['2020-08-31', '129.04', '4.0', '0.0']);
});

test('unknown and not-yet-loaded tickers are listed as unavailable and left out of prices', async () => {
  const b = await body('tickers=TSTA,NOPE9,TSTC&from=2019-01-02');
  expect(b.unavailable).toHaveLength(2);
  expect(b.unavailable).toEqual(
    expect.arrayContaining([
      { ticker: 'NOPE9', reason: 'not_on_allowlist' },
      { ticker: 'TSTC', reason: 'no_data_yet' },
    ]),
  );
  expect(Object.keys(b.prices)).toEqual(['TSTA']);
});

test('asOf is null when no requested ticker is available', async () => {
  expect((await body('tickers=NOPE9&from=2019-01-02')).asOf).toBeNull();
});

test('lower-case tickers are upper-cased', async () => {
  const b = await body('tickers=voo&from=2020-01-02');
  expect(b.prices.VOO).toEqual([['2020-01-02', '300', '1', '0']]);
});

test('an empty ticker list returns fx only, with asOf the last fx date', async () => {
  const b = await body('tickers=&from=2019-01-02');
  expect(b).toEqual({
    asOf: '2020-12-30',
    prices: {},
    fx: [...JSON.parse(FX_2018), ...JSON.parse(FX_2019), ...JSON.parse(FX_2020)],
    unavailable: [],
  });
});

test.each([
  ['51 tickers', `tickers=${Array.from({ length: 51 }, (_, i) => `T${i}`).join(',')}&from=2020-01-02`],
  ['missing from', 'tickers=TSTA'],
  ['impossible from date', 'tickers=TSTA&from=2020-13-01'],
  ['missing tickers', 'from=2020-01-02'],
  ['ticker with a bad character', 'tickers=TS$A&from=2020-01-02'],
])('%s gives 400 bad_request', async (_name, qs) => {
  const res = await get(qs);
  expect(res.status).toBe(400);
  const b = (await res.json()) as any;
  expect(b.error).toBe('bad_request');
  expect(typeof b.message).toBe('string');
});

test('200 responses are cacheable for an hour', async () => {
  const res = await get('tickers=TSTA&from=2019-01-02');
  expect(res.status).toBe(200);
  expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
});

test('an empty answer is not cacheable', async () => {
  const res = await get('tickers=NOPE9&from=2019-01-02');
  expect(res.status).toBe(200);
  expect(((await res.json()) as any).asOf).toBeNull();
  expect(res.headers.get('Cache-Control')).toBe('no-store');
});

test('the body matches the shared PricesResponse schema', async () => {
  const b = await body('tickers=TSTA,NOPE9,TSTC&from=2019-01-02');
  expect(PricesResponse.safeParse(b).success).toBe(true);
});
