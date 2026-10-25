# Deploy checklist

Owen runs these steps. They need a Cloudflare login, so the driver only checked that `npm run build` and `npx wrangler deploy --dry-run` succeed.

## One-time setup

1. Log in: `npx wrangler login`
2. Create the database: `npx wrangler d1 create honest-returns`. Copy the `database_id` it prints into `wrangler.jsonc`, replacing `00000000-0000-0000-0000-000000000000`. Commit that change.
3. Create the tables and load the 400-ticker allowlist: `npx wrangler d1 migrations apply honest-returns --remote`
4. Add the Tiingo key as a secret: `npx wrangler secret put TIINGO_TOKEN` and paste the key at the prompt. Do not put it in a file or a commit.
   Then add the salt for hashed client IPs on ticker requests: `npx wrangler secret put REQUEST_SALT` and paste any long random string. Without it the Worker logs a warning and uses a public dev salt.

## Each deploy

5. `npm run deploy` (runs `vite build`, then `wrangler deploy`). It deploys to the custom domain `honest-returns.owennyo.com`; the `*.workers.dev` and preview URLs are off in `wrangler.jsonc`.
   If `migrations/` has a file the remote database has not run yet (for example `0003_ticker_requests.sql`), run step 3 first.
6. To undo a bad deploy: `npx wrangler rollback`.

## First data load

7. The cron runs every hour from 22:00 to 07:00 UTC (06:00 to 15:00 Singapore time). Each run fetches up to 45 tickers, priority tickers (VOO, AAPL, VT, QQQ) first, so the 400 tickers load in the first night.
8. Exchange rates load only in the 22:00 UTC run. Until the first 22:00 UTC run finishes, `/api/prices` returns `"asOf": null` and the landing shows `Prices could not be loaded. Try again in a minute.` Triggering the cron from the dashboard runs it at the current time, so it loads prices but not exchange rates unless it is 22:xx UTC. Simplest: deploy, then wait for 22:00 UTC.
9. Watch the first 22:00 UTC run: `npx wrangler tail`. Look for `refresh:` lines (HTTP 429 or 5xx stop a run; the next hour continues) and for CPU limit errors. Backfilling 20 years of prices per ticker is the heaviest work the Worker does; if Workers Free stops it at the CPU limit, see spec section 14 (backfill in year-sized windows).

## Check

10. `curl "https://honest-returns.owennyo.com/api/prices?tickers=VOO,AAPL&from=2019-01-02" | head -c 300`. Expect a non-null `asOf` and `"unavailable":[]`.
11. Open the landing page on a phone. Check the TWR and XIRR numbers, the number line, the sentence and the chart, then upload a CSV with `Check your own broker file`.

## Run the cron locally

`npm run dev`, then in a second terminal (replace the time with a 22:xx UTC time in epoch milliseconds so exchange rates load too):

```sh
curl -X POST "http://localhost:5173/cdn-cgi/local/explorer/api/local/scheduled?worker=honest-returns" \
  -H 'Content-Type: application/json' \
  -d '{"cron":"0 22 * * *","scheduled_time":1792879500000}'
```

One run makes up to 45 Tiingo requests. Tiingo's free plan allows about 50 an hour, so run it at most once an hour. `npm run preview` with `curl "http://localhost:8787/__scheduled?cron=0+22+*+*+*"` also works, but it always uses the current time, so it loads exchange rates only between 22:00 and 22:59 UTC.
