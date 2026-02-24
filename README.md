# ENTSOE-Mirror
Hourly updated ENTSOE electricity spotprice data.

## Static hosting
This site is GitHub Pages friendly and does not require a runtime API.

- Country list comes from [`data/countries.json`](data/countries.json).
- Country data comes from `data/<slug>.json`.

`entsoe_fetcher.py` now regenerates `data/countries.json` on every fetch run.
