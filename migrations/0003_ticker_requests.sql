-- Spec 10.8: requested tickers, fetched by the nightly cron.
CREATE TABLE ticker_requests (
  ticker       TEXT PRIMARY KEY,
  requested_on TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('queued','added','not_found')),
  resolved_on  TEXT
);
-- Checkpoint 1 decision 12: POSTs per client per UTC day. client = salted SHA-256 of the IP, never the IP.
CREATE TABLE client_requests (
  client TEXT NOT NULL,
  day    TEXT NOT NULL,
  count  INTEGER NOT NULL,
  PRIMARY KEY (client, day)
) WITHOUT ROWID;
