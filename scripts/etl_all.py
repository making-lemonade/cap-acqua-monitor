"""Ingest every published CAP aqueduct quarterly CSV/JSON source (2024 onward).

The downloaded originals are byte-for-byte preserved. Normalized observations are
sharded by quarter and parameter, keeping the static web app fast and auditable.
No coordinates of sampling points, regulatory conclusions or values are invented.
"""
from __future__ import annotations
from collections import defaultdict
from datetime import datetime, timezone
from html.parser import HTMLParser
import hashlib
import json
import re
import unicodedata
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data"
RAW = OUT / "raw"
QUARTERS = OUT / "quarters"
TRENDS = OUT / "trends"
SRC = ROOT / "scripts" / "sources.json"
GEO_URL = "https://raw.githubusercontent.com/RP92/comuni-italiani/main/data/comuni.json"
ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4}


def download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 AquaIntelligence/1.1"})
    with urllib.request.urlopen(req, timeout=100) as resp:
        result = resp.read()
    if not result:
        raise ValueError(f"Empty response for {url}")
    return result


def save_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")


class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = set()

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in ("data-link", "data-filename") and value:
                self.links.add(value.strip())


def discover_periods(seed: dict) -> list[dict]:
    entries = {x["id"]: dict(x) for x in seed["periods"]}
    try:
        p = LinkParser()
        p.feed(download(seed["landing_page"]).decode("utf-8", "replace"))
        for url in sorted(p.links):
            parsed = urlparse(url)
            if parsed.scheme != "https" or parsed.hostname != "www.gruppocap.it":
                continue
            if "/qualita-acqua/analisi-" not in parsed.path.lower():
                continue
            m = re.search(r"/analisi-(20\d\d)/(i|ii|iii|iv)-trimestre(?:-\d{4})?/", parsed.path, re.I)
            if not m:
                continue
            ext = parsed.path.rsplit(".", 1)[-1].lower()
            if ext not in ("json", "csv"):
                continue
            year, quarter = int(m.group(1)), ROMAN[m.group(2).lower()]
            if year > datetime.now(timezone.utc).year:
                continue
            pid = f"{year}-q{quarter}"
            record = entries.setdefault(pid, {"id": pid, "year": year, "quarter": quarter})
            record[f"{ext}_url"] = url
        print(f"Source discovery: {len(p.links)} official download links; {len(entries)} periods")
    except Exception as exc:
        print(f"Source discovery unavailable; use verified source registry: {exc}")
    return sorted((p for p in entries.values() if p.get("json_url") and p.get("csv_url")),
                  key=lambda p: (p["year"], p["quarter"]))


def parse_rows(raw: bytes) -> list[dict]:
    text = raw.decode("utf-8-sig").strip()
    try:
        rows = json.loads(text)
    except json.JSONDecodeError:
        # CAP sometimes publishes successive top-level JSON objects without an array.
        dec = json.JSONDecoder()
        rows, pos = [], 0
        while pos < len(text):
            while pos < len(text) and (text[pos].isspace() or text[pos] in ",;"):
                pos += 1
            if pos == len(text):
                break
            row, pos = dec.raw_decode(text, pos)
            if isinstance(row, dict):
                rows.append(row)
            elif isinstance(row, list):
                rows.extend(row)
            else:
                raise ValueError("Unexpected CAP JSON entry type")
    if isinstance(rows, dict):
        matches = [v for v in rows.values() if isinstance(v, list)]
        rows = matches[0] if matches else [rows]
    if not isinstance(rows, list) or not rows:
        raise ValueError("CAP JSON has no rows")
    rows = [row for row in rows if isinstance(row, dict)]
    if not rows:
        raise ValueError("CAP JSON has no object rows")
    return rows


def numeric(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return {"value": float(v), "censored": False}
    if not isinstance(v, str):
        return None
    value = v.strip().replace(" ", "").replace("\u00a0", "")
    if not value or value in ("-", "n.d.", "ND", "N.D.", "n.r.", "--"):
        return None
    censored = value.startswith(("<", "≤"))
    if censored:
        value = value[1:].lstrip("=")
    if not re.fullmatch(r"[+-]?\d+(?:[.,]\d+)?", value):
        return None
    return {"value": float(value.replace(",", ".")), "censored": censored}


def normalize(v) -> str:
    s = unicodedata.normalize("NFKD", str(v)).replace("µ", "u").replace("μ", "u")
    return re.sub(r"[^a-z0-9]+", "", s.encode("ascii", "ignore").decode("ascii").lower())


def field_id(name, unit):
    # Same label AND unit only; differently measured quantities are not conflated.
    return hashlib.sha1(f"{normalize(name)}|{normalize(unit)}".encode()).hexdigest()[:12]


def metadata(rows):
    headings = None
    units = None
    limits = None
    for row in rows:
        label = str(row.get("CATEGORIA DI ANALISI", "")).strip().lower()
        if "data camp" in label or normalize(row.get("Column2", "")) == "comune":
            headings = row
        elif "unit" in label and "misur" in label:
            units = row
        elif "limiti di legge" in label or ("limit" in label and "legge" in label):
            limits = row
    if not (headings and units and limits):
        raise ValueError("CAP metadata headers, units or source limits missing")
    return headings, units, limits


def date_format(rows):
    # The 2026 CAP source contains 03/25/2026 => MM/DD/YYYY, but detect per quarter.
    us, eu = 0, 0
    for row in rows[:700]:
        s = str(row.get("CATEGORIA DI ANALISI", "")).strip()
        m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/20\d\d", s)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            if b > 12 and a <= 12:
                us += 1
            elif a > 12 and b <= 12:
                eu += 1
    return "%m/%d/%Y" if us >= eu else "%d/%m/%Y"


def parse_date(value, primary):
    text = str(value).strip()
    for pattern in (primary, "%Y-%m-%d", "%d/%m/%Y" if primary == "%m/%d/%Y" else "%m/%d/%Y"):
        try:
            return datetime.strptime(text, pattern).date().isoformat()
        except ValueError:
            continue
    return None


def reference_geography(city_names):
    try:
        source = json.loads(download(GEO_URL))
        choices = {}
        for r in source:
            if not isinstance(r, dict) or r.get("regione", {}).get("nome") != "Lombardia":
                continue
            coord = r.get("coordinate")
            if not isinstance(coord, dict):
                continue
            lat, lon = coord.get("lat"), coord.get("lng")
            if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
                choices[normalize(r.get("nome", ""))] = {"lat": lat, "lng": lon}
        matches = {city: choices[normalize(city)] for city in city_names if normalize(city) in choices}
        print(f"Municipality reference coordinates matched: {len(matches)} / {len(city_names)}")
        return matches
    except Exception as exc:
        print(f"Municipality reference coordinate download failed: {exc}")
        return {}


def agg_update(b, item):
    b["count"] += 1
    if item["status"] == "above_limit":
        b["above"] += 1
    elif item["status"] == "near_limit":
        b["near"] += 1
    elif item["status"] == "unknown":
        b["unknown"] += 1
    if item["censored"]:
        b["censored"] += 1
    else:
        v = item["value"]
        b["measured"] += 1
        b["sum"] += v
        b["min"] = v if b["min"] is None else min(b["min"], v)
        b["max"] = v if b["max"] is None else max(b["max"], v)


def empty_agg():
    return {"count": 0, "measured": 0, "censored": 0, "above": 0, "near": 0,
            "unknown": 0, "sum": 0.0, "min": None, "max": None}


def main():
    source_registry = json.loads(SRC.read_text(encoding="utf-8"))
    sources = discover_periods(source_registry)
    if len(sources) < len(source_registry["periods"]):
        raise RuntimeError("Some registered CAP sources have disappeared from discovery")
    for folder in (OUT, RAW, QUARTERS, TRENDS):
        folder.mkdir(parents=True, exist_ok=True)

    all_fields = {}
    all_cities = set()
    period_entries = []
    # param -> (quarter, city) -> aggregation; * means the weighted overall series
    series = defaultdict(lambda: defaultdict(empty_agg))
    issues = []
    for source in sources:
        pid = source["id"]
        try:
            raw = download(source["json_url"])
            original_csv = download(source["csv_url"])
            rows = parse_rows(raw)
            headings, units, limits = metadata(rows)
            fmt = date_format(rows)
            key_city = next((k for k, v in headings.items() if normalize(v) == "comune"), "Column2")
            key_address = next((k for k, v in headings.items() if normalize(v) == "indirizzo"), "Column3")
            key_sample = next((k for k, v in headings.items() if "campione" in normalize(v)), "Column4")
            # Metadata remains period-specific; do not apply new limits retroactively.
            fieldmap = {}
            seen_names = set()
            for column, label in headings.items():
                if column in ("CATEGORIA DI ANALISI", key_city, key_address, key_sample):
                    continue
                name = str(label).strip() if label is not None else ""
                if not name or name.startswith("Column"):
                    continue
                unit = str(units.get(column, "") or "").strip()
                key = field_id(name, unit)
                if key in seen_names:
                    # Duplicate identical names in the same source are separate analytical columns.
                    key = hashlib.sha1((key + column).encode()).hexdigest()[:12]
                seen_names.add(key)
                lim = numeric(limits.get(column))
                limit = lim["value"] if lim and not lim["censored"] else None
                fieldmap[column] = {"key": key, "name": name, "unit": unit, "limit": limit}
            if not fieldmap:
                raise ValueError("No named chemical or bacteriological parameters")
            by_field = defaultdict(list)
            period_cities = set()
            source_rows = 0
            observations = 0
            sample_dates = []
            for row in rows:
                date = parse_date(row.get("CATEGORIA DI ANALISI", ""), fmt)
                city = str(row.get(key_city, "") or "").strip().upper()
                if not date or not city:
                    continue
                source_rows += 1
                sample_dates.append(date)
                period_cities.add(city)
                address = str(row.get(key_address, "") or "").strip()
                sample = str(row.get(key_sample, "") or "").strip()
                for column, field in fieldmap.items():
                    value = numeric(row.get(column))
                    if value is None:
                        continue
                    v, censored, limit = value["value"], value["censored"], field["limit"]
                    status = "unknown"
                    if limit is not None and limit >= 0:
                        if censored:
                            status = "under_limit" if v <= limit else "unknown"
                        else:
                            status = "above_limit" if v > limit else (
                                "near_limit" if limit > 0 and v >= limit * .8 else "under_limit"
                            )
                    item = {"city": city, "date": date, "address": address, "sample": sample,
                            "value": v, "censored": censored, "status": status}
                    by_field[field["key"]].append(item)
                    observations += 1
                    for city_key in (city, "*"):
                        agg_update(series[field["key"]][(pid, city_key)], item)
            if not source_rows or not observations:
                raise ValueError("No recognized sample dates or numeric observations")
            # Only publish the period if it parsed successfully.
            (RAW / f"{pid}.json").write_bytes(raw)
            (RAW / f"{pid}.csv").write_bytes(original_csv)
            for column, f in fieldmap.items():
                key = f["key"]
                if key not in by_field:
                    continue
                rec = all_fields.setdefault(key, {"key": key, "name": f["name"], "unit": f["unit"],
                                                  "periods": [], "limits_by_period": {}})
                if pid not in rec["periods"]:
                    rec["periods"].append(pid)
                rec["limits_by_period"][pid] = f["limit"]
            for key, values in by_field.items():
                save_json(QUARTERS / pid / f"{key}.json", values)
            all_cities.update(period_cities)
            period_entries.append({
                "id": pid, "year": source["year"], "quarter": source["quarter"],
                "label": f"{source['quarter']}° trimestre {source['year']}",
                "count": observations, "source_rows": source_rows,
                "cities_count": len(period_cities), "parameters_count": len(by_field),
                "dates_min": min(sample_dates), "dates_max": max(sample_dates),
                "date_format": fmt, "source_json": source["json_url"],
                "source_csv": source["csv_url"],
                "sha256_json": hashlib.sha256(raw).hexdigest(),
                "sha256_csv": hashlib.sha256(original_csv).hexdigest()
            })
            print(f"IMPORTED {pid}: rows={source_rows} cities={len(period_cities)} "
                  f"parameters={len(by_field)} observations={observations} date_format={fmt}", flush=True)
        except Exception as exc:
            issues.append(f"{pid}: {type(exc).__name__}: {exc}")
            print(f"IMPORT_ERROR {pid}: {exc}", flush=True)

    # Refuse to publish incomplete historical data as if it were comprehensive.
    if issues or len(period_entries) != len(sources):
        raise RuntimeError("CAP full-history import incomplete: " + "; ".join(issues))
    for key, buckets in series.items():
        history = []
        for (pid, city), b in sorted(buckets.items()):
            history.append({
                "period": pid, "city": city, "count": b["count"],
                "measured": b["measured"], "censored": b["censored"],
                "avg": round(b["sum"] / b["measured"], 6) if b["measured"] else None,
                "min": b["min"], "max": b["max"],
                "above": b["above"], "near": b["near"], "unknown": b["unknown"]
            })
        save_json(TRENDS / f"{key}.json", history)

    geography = reference_geography(all_cities)
    manifest = {
        "metadata": {
            "source": source_registry["landing_page"], "updated_utc": datetime.now(timezone.utc).isoformat(),
            "notes": [
                "Separate parameters when their names or units differ between sources.",
                "Values reported below quantification limits are censored, never treated as exact values.",
                "Period trend averages exclude censored observations and are weighted by quantified observation count.",
                "Thresholds are copied from period-specific CAP source metadata; legal applicability is not independently confirmed.",
                "Map markers refer to municipality coordinates, not CAP sampling points.",
            ],
        },
        "periods": period_entries,
        "cities": sorted(all_cities),
        "fields": sorted(all_fields.values(), key=lambda f: f["name"].lower()),
        "geography": {
            "source": GEO_URL, "license": "CC BY 4.0",
            "credit": "RP92/comuni-italiani, ISTAT and Garda Informatica",
            "locations": geography
        },
        "counts": {
            "periods": len(period_entries), "cities": len(all_cities),
            "parameters": len(all_fields),
            "observations": sum(p["count"] for p in period_entries)
        },
        "failures": issues
    }
    save_json(OUT / "manifest.json", manifest)
    print("FULL_HISTORY_SUCCESS", json.dumps(manifest["counts"], ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
