import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Env } from './index';

declare global {
  namespace Cloudflare {
    interface Env extends ProvidedEnv {}
    interface GlobalProps {
      mainModule: typeof import('./index');
    }
  }
}
interface ProvidedEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
