import { exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';

test('GET /api/health returns ok', async () => {
  const res = await exports.default.fetch('http://x/api/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
