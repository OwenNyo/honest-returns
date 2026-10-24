CREATE TABLE tickers (            -- the allowlist
  ticker       TEXT PRIMARY KEY,  -- Tiingo symbol, upper case
  priority     INTEGER NOT NULL DEFAULT 0, -- 1 = sample/benchmark tickers, refreshed first
  last_date    TEXT,              -- latest bar stored, NULL = not backfilled yet
  refreshed_on TEXT,              -- UTC date of the last successful refresh
  added_on     TEXT NOT NULL
);
CREATE TABLE prices (             -- one row per ticker per calendar year
  ticker TEXT NOT NULL,
  year   INTEGER NOT NULL,
  rows   TEXT NOT NULL,           -- JSON: [["2020-08-31","129.04","4.0","0.0"], ...] ascending
  PRIMARY KEY (ticker, year)
) WITHOUT ROWID;
CREATE TABLE fx (
  year INTEGER PRIMARY KEY,
  rows TEXT NOT NULL              -- JSON: [["2020-08-31","1.3612"], ...] SGD per USD, ascending
);
