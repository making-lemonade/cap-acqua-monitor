# Aqua Intelligence

**Open Water Data · Lombardy** — an independent, portfolio-grade Business Intelligence and Data Engineering dashboard using official Gruppo CAP water quality open data.

## Stack
React, TypeScript, Vite, Recharts, Python ETL, GitHub Actions and GitHub Pages. Free static hosting, no database, no API keys.

## Features
- Clean, responsive dashboard with light/dark themes and filters by municipality and parameter.
- Time series, coverage KPIs, parameter-specific threshold flags, municipality comparison.
- Download filtered results as CSV.
- Data explorer and documentation of data ingestion/quality rules.
- Source JSON and optional original CSV archived under `public/data/` by scheduled GitHub Actions.

## Getting started
```bash
python scripts/etl.py
npm install
npm run dev
```

## Publish on GitHub Pages
In **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source. Then start **Actions → CAP data and GitHub Pages → Run workflow**. The expected URL is https://making-lemonade.github.io/cap-acqua-monitor/ once deployment succeeds.

## Data quality and interpretation
Official source: https://www.gruppocap.it/it/cosa-facciamo/qualita-acqua

The ETL stores original source bytes, records their SHA-256, normalizes source metadata and preserves below-quantification markers. The alert color uses thresholds published within the CAP file; it is not an independently validated regulatory assessment. An 80% near-threshold indicator is a visual convention only. Missing thresholds are not considered compliant. Results do **not** establish the potability of all water in a municipality.

**Known limitations:** phase 1 only covers the first quarter of 2026; historical comparisons and a verifiable geospatial map need additional datasets and location references. Date formats in source files must be validated; ambiguous dates currently use US-first parsing. The site intentionally does not fabricate coordinates, interpolated observations or AI outcomes.

## Portfolio case study
Pipeline: official JSON/CSV → Python parsing/validation → versioned source and normalized JSON → TypeScript analytics UI → GitHub Actions CI/CD → GitHub Pages.

Independent project, not affiliated with Gruppo CAP.
