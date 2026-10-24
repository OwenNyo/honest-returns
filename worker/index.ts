import { Hono } from 'hono';

export type Env = { DB: D1Database; TIINGO_TOKEN: string };

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true }));

export default {
  fetch: app.fetch,
  async scheduled() {},
} satisfies ExportedHandler<Env>;
