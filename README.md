# Aqua Intelligence · Water Quality Analytics

**A portfolio-grade, end-to-end Business Intelligence, Data Engineering and experimental Machine Learning application built on official Italian water-quality open data.**

[GitHub Pages demo](https://making-lemonade.github.io/cap-acqua-monitor/) · [Official Gruppo CAP open data](https://www.gruppocap.it/it/cosa-facciamo/qualita-acqua)

> **Independent project.** Not affiliated with Gruppo CAP. Color-coded summaries and ML outliers are exploratory analytical aids, **not drinking-water safety certifications**.

## What this project demonstrates

| Skill | Implementation |
|---|---|
| Data Engineering | Python ETL, non-standard JSON parsing, original-file retention, SHA-256 provenance |
| Business Intelligence | City/parameter filters, time series, coverage KPIs, regulated-source threshold comparisons and CSV exports |
| Geospatial analytics | Interactive Leaflet / OpenStreetMap municipality map with per-parameter statuses |
| Applied ML | Reproducible scikit-learn IsolationForest exploratory anomaly screening |
| Frontend Engineering | React, TypeScript, Vite, responsive Apple-inspired design, dark mode, accessibility-minded UI |
| DevOps | Scheduled ingestion, CI build, GitHub Actions and zero-server GitHub Pages deployment |

## Verified input data (as of 17 November 2026)

The initial normalized Q1 2026 feed produced:
- **2,465** source records, including metadata rows;
- **133** unique municipality names;
- **142,964** numeric / censored normalized observations;
- **174** parameter labels;
- municipality reference coordinates matched for **133 / 133** using a separately attributed source.

These counts describe **processing coverage**, not compliance, potability, the number of independent samples or active aqueduct infrastructure. The pipeline recalculates these counts when run.

## Pipeline

```
Official CAP JSON (malformed concatenated top-level objects) + CSV
       │ preserve exact raw files and hash
       ▼
Python ETL (extract metadata, normalize date / city / parameter, flags)
       │
       ├── Municipality reference locations (RP92, not sample locations)
       ├── JSON dashboard model (per-observation source threshold flags)
       └── Unsupervised ML experiment (IsolationForest)
       ▼
Versioned files in public/data/ → Vite / React / TypeScript
       ▼
GitHub Actions → GitHub Pages (no server, database, paid API, or secret key)
```

### Data quality and limitations

1. **The original CAP `.json` is not a valid JSON array:** it contains consecutive top-level objects. A streaming decoder preserves the original file and parses it defensively.
2. Values such as `<0,02` are **left-censored**: the number is an upper detection/quantification boundary, not an exact concentration. The time-series average excludes censored values.
3. Measurement dates in the source are encoded **MM/DD/YYYY** (for example, `03/25/2026`) even though the dataset is Italian. Parsing is explicit.
4. Reference limits are read from **CAP's published metadata**, not independently validated for parameter-specific legal applicability. The **80% near-limit** color is an arbitrary visualization convention. Incomplete/unknown data are never treated as compliant. Zero bacteriological thresholds are handled explicitly.
5. The map shows **approximate municipality reference coordinates**, obtained from a separate nonofficial dataset; it does **not** claim to locate CAP sampling points or aqueduct facilities. A red point means at least one result exceeding a source-published threshold for the currently selected parameter, **not** that all drinking water in that city is unsafe.
6. IsolationForest is a **statistical exploration tool**, trained separately on selected quantitative parameters, excluding censored observations. Naturally varying geography, measurement frequency and mixtures of sampling points can create false positives. Outliers are **not** health or regulatory alerts; scores from different models are not comparable.
7. Initial scope: **Q1 2026 only**. Trends are within this period. Multi-quarter ingestion, parameter-level regulatory validation, and sampling-point geography are documented future improvements rather than simulated functionality.

## Local development

Requires Python 3.12+ and Node.js 22+:

```bash
python scripts/etl.py
python -m pip install -r scripts/requirements.txt
python scripts/ml.py
npm install
npm run dev
```

Build: `npm run build`.

The ETL requires access to official CAP URLs and the credited municipality dataset. It saves:
- `public/data/cap-2026-q1-original.json` — original CAP JSON bytes;
- `public/data/cap-2026-q1-original.csv` — original CAP CSV bytes, if available;
- `public/data/dashboard.json` — normalized observations, field schema, provenance and municipality reference coordinates;
- `public/data/ml-anomalies.json` — optional, experimentally generated model output.

## Deployment

Repository: `making-lemonade/cap-acqua-monitor`.

1. In **Settings → Pages → Build and deployment**, select **GitHub Actions** (one-time repo setting; GitHub's GITHUB_TOKEN cannot create a Pages site without extra admin permissions).
2. The committed `.github/workflows/deploy.yml` automatically runs ETL, the offline ML experiment, the TypeScript/Vite build and Pages deployment on updates to `main`.
3. A weekly scheduled run refreshes the Q1 2026 source archive and generated datasets. It does **not** silently change to a later quarter.

No personal access token, cloud server, payment method or external data warehouse is needed.

## Provenance, licenses and links

- [Gruppo CAP — Water quality analytical open data](https://www.gruppocap.it/it/cosa-facciamo/qualita-acqua), initial period: I trimestre 2026. CAP states data are open and reusable.
- [Q1 2026 original JSON](https://www.gruppocap.it/content/dam/groupcap/assets/documents/documents-web/cosa-facciamo/qualita-acqua/analisi-2026/i-trimestre-2026/ACQUEDOTTO%20I%20TRIMESTRE%202026.json)
- [Q1 2026 original CSV](https://www.gruppocap.it/content/dam/groupcap/assets/documents/documents-web/cosa-facciamo/qualita-acqua/analisi-2026/i-trimestre-2026/Acquedotto%20I%20TRIMESTRE%202026.csv)
- [RP92/comuni-italiani](https://github.com/RP92/comuni-italiani), municipality coordinates derived from ISTAT/Garda Informatica, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Original coordinates were adapted by matching CAP municipality names; the source is independently credited.
- [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors for map tiles.
- [scikit-learn](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html) for experimental, reproducible unsupervised ML.

## Roadmap

- Multi-quarter history, dimensionally consistent schema and source-snapshot versioning.
- Validate each legal limit and reported unit against authoritative documentation.
- Administrative boundary overlays and authoritative sample location identifiers when published.
- Columnar Parquet / browser SQL analytics for larger datasets.

---
**Built to show the full lifecycle:** messy public data → defensible transformations → reproducible analytical products → transparent reporting → production deployment.
