import { Hono } from 'hono';
import { getPrices } from './prices';

export type Env = { DB: D1Database; TIINGO_TOKEN: string };

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true }));
app.get('/api/prices', getPrices);

export default {
  fetch: app.fetch,
  async scheduled() {},
} satisfies ExportedHandler<Env>;
