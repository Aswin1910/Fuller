# Fuller — Excel Time Series Analyzer

A small Flask app for uploading one or more `.xlsx` files that share a
`Time` column, merging them, filtering by a time range, and viewing
summary statistics and interactive Plotly charts per column.

## Requirements

- Python 3.10+
- `pip install flask pandas openpyxl pyarrow werkzeug`

## Setup

```bash
export SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
python app.py
```

Set `SECRET_KEY` to a fixed, random value in any real deployment —
without it, Flask sessions (and therefore each user's uploaded data
reference) are invalidated on every restart. Set `FLASK_DEBUG=1` only for
local development; never run with the debugger enabled in production.

## How it works

1. Upload one or more `.xlsx` files, each containing a `Time` column.
2. The app validates, merges, and time-sorts them, then caches the merged
   data as Parquet under `cache/` (referenced via the Flask session).
3. Filter by a time range to view the data table, per-column statistics,
   and a Plotly chart of selected columns ("plants").

## Notes

- Uploaded files are deleted immediately after being merged into the
  cache — only the derived Parquet cache persists server-side.
- `uploads/` and `cache/` are gitignored; don't commit real data files.
