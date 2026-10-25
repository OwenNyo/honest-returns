-- Spec 19.6: UTC date the ticker was last served by /api/prices. NULL = not served since this migration.
ALTER TABLE tickers ADD COLUMN last_used TEXT;
-- Spec 19.4: Tiingo calls per UTC hour, shared by the cron and on-demand fetches.
-- Spec 19.7: client_requests.count now counts tickers fetched or queued per client per day, not POSTs.
CREATE TABLE budget (
  hour TEXT PRIMARY KEY,   -- 'YYYY-MM-DDTHH', UTC
  used INTEGER NOT NULL
) WITHOUT ROWID;
