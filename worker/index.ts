import { Hono } from 'hono';
import { getPrices } from './prices';
import { refresh } from './refresh';
import { postTickerRequests } from './requests';

export type Env = { DB: D1Database; TIINGO_TOKEN: string; REQUEST_SALT?: string };

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true }));
app.get('/api/prices', getPrices);
app.post('/api/ticker-requests', postTickerRequests);

export default {
  fetch: app.fetch,
  async scheduled(event, env) {
    await refresh(env, new Date(event.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
