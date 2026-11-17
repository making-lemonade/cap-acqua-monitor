# Aqua Intelligence · Open Water Analytics

**Portfolio project: Business Intelligence, Data Engineering, geospatial analytics and explainable exploratory ML from real-world messy open data.**

**Live:** https://making-lemonade.github.io/cap-acqua-monitor/  
**Source:** https://github.com/making-lemonade/cap-acqua-monitor  
**Official data:** https://www.gruppocap.it/it/cosa-facciamo/qualita-acqua

> Independent portfolio project, not affiliated with Gruppo CAP. This application does not certify potability or provide medical advice.

## Scope: complete public CAP aqueduct archive

As of **17 November 2026**, the official CAP page exposes **11 quarterly aqueduct datasets** from **Q1 2024 through Q3 2026**, each in CSV and JSON (22 original files). The exact vetted URLs, including naming inconsistencies, are stored in [scripts/sources.json](scripts/sources.json). In the first verified import, 1,397,737 numeric observations were normalized across 135 municipalities; these are observations, not independent sampling campaigns. The ingestion also discovers newly published quarterly links from the official HTML page.

The ETL archives both downloaded originals byte-for-byte in **public/data/raw/**. A SHA-256 is recorded in the manifest for every quarter and format. No source file is silently rewritten or discarded.

### Current functionality

- Interactive filters for **quarter, municipality and parameter**.
- Historical charts with *weighted quarterly averages* using **quantified** readings only.
- Daily time-series within the selected quarter, sample-level exploration, searchable paginated table and CSV export.
- Interactive Leaflet/OpenStreetMap territory map, with color-coded indicators derived from the **selected parameter and quarter**, not general judgements about a city's water.
- Trend data and normalized measurements **sharded per parameter** for fast, low-bandwidth static hosting.
- Downloadable, source-provenanced original CSV and JSON files, public data dictionary and processing audit metadata.
- Experimental scikit-learn Isolation Forest models trained on historical quantified observations; results clearly identified as *statistical outliers*, not sanitary or legal failures.
- GitHub Actions orchestration and GitHub Pages, no server or paid services.

## Architecture

```
Gruppo CAP official quarterly CSV + JSON (2024–2026)
    ├── Original bytes: public/data/raw/<year>-q<quarter>.{json,csv}
    └── Python CSV-first normalization: scripts/etl_csv_all.py
             ├── date formats inferred per source (US vs EU)
             ├── source-specific field names, units and thresholds
             ├── flags for values reported below quantification limit
             ├── stable parameter keys based on normalized name + unit
             ├── data/quarters/<quarter-id>/<parameter-id>.json
             ├── data/trends/<parameter-id>.json (pre-aggregated history)
             └── data/manifest.json (provenance, coverage, hashes, geography)
                 │
                 ├── Python / scikit-learn: scripts/ml.py → ml-anomalies.json
                 └── React + TypeScript / Recharts + Leaflet
                                    ↓
                               GitHub Pages
```

## Why this demonstrates senior BI / data engineering skills

**Data provenance:** Original source files remain available; SHA-256, source URLs, observation counts, period, date format and field-specific units are explicit.

**Semantic modeling:** Measurements are standardized without merging distinct parameters with different names or units. Where CAP places units in shifted CSV header columns, the parser documents column alignment and repairs only confidently cross-verified metadata using [unit_reference.json](scripts/unit_reference.json); it never rescales numerical values. A threshold comes from the **source period** and is not applied retroactively to older samples.

**Data quality:** Several supplied CAP JSON exports lose fields or collapse semicolon-delimited rows. For that reason **the CSV files are the normalization source** and both published originals are archived byte-for-byte. Values such as `<0,01` are **left-censored**, NOT zero or the exact upper bound. They are excluded from numerical averages, while remaining visible in the underlying data. Parsing errors abort a full-history build rather than silently advertising incomplete coverage.

**Performance:** Quarterly observations are statically sharded per parameter; charts use precomputed weighted aggregates. The visitor never downloads all original archives to open the dashboard.

**Cautious interpretation:** A source-listed threshold does not constitute independently verified legal applicability; 80% proximity is merely an interface warning, not a legal category. Naturally different aquifers or measurement periods can produce ML outliers without indicating any hazard.

**Geospatial limits:** Points represent *approximate municipality reference coordinates*, not aqueduct infrastructure or sampling stations. Geography source: [RP92/comuni-italiani](https://github.com/RP92/comuni-italiani), based on ISTAT and Garda Informatica data, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Map tiles: [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

## Run locally

Python 3.12+ and Node.js 22+:

```bash
python scripts/etl_csv_all.py
python -m pip install -r scripts/requirements.txt
python scripts/ml.py
npm install
npm run dev
```

Production build: `npm run build`.

## CI/CD

The [GitHub Actions workflow](.github/workflows/deploy.yml) handles source download, ETL, model generation, build and Pages deployment. It runs automatically on changes to `main` and weekly for source refresh. The originals and normalized outputs are retained in `public/data/` and are published as static files.

Potential future extensions: authoritative point-level coordinates, revised legal thresholds and longitudinal parameter harmonization with documented mappings. None are presented as already implemented.

## Sources and verification

- [Official CAP water-quality open data](https://www.gruppocap.it/it/cosa-facciamo/qualita-acqua), accessed 17 November 2026.
- [CAP quarterly URL registry](scripts/sources.json), verified against the HTML `data-link` attributes on the CAP website.
- [RP92 municipality data](https://github.com/RP92/comuni-italiani), original ISTAT and Garda Informatica sources, CC BY 4.0.
- [scikit-learn IsolationForest reference](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html).
