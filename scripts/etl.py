"""Normalize Gruppo CAP water-quality open data without inventing measurements."""
import datetime as dt
import hashlib
import json
import re
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "public" / "data"
OUT.mkdir(parents=True, exist_ok=True)
BASE = "https://www.gruppocap.it/content/dam/groupcap/assets/documents/documents-web/cosa-facciamo/qualita-acqua/analisi-2026/i-trimestre-2026/"
JSON_URL = BASE + "ACQUEDOTTO%20I%20TRIMESTRE%202026.json"
CSV_URL = BASE + "Acquedotto%20I%20TRIMESTRE%202026.csv"

def download(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 AquaIntelligenceOpenData"})
    with urllib.request.urlopen(req, timeout=100) as r:
        return r.read()

def numeric(value):
    if isinstance(value, (float, int)) and not isinstance(value, bool):
        return {"value": float(value), "censored": False}
    if not isinstance(value, str):
        return None
    s = value.strip().replace(" ", "")
    censored = s.startswith("<")
    if censored:
        s = s[1:]
    try:
        return {"value": float(s.replace(",", ".")), "censored": censored}
    except ValueError:
        return None

def parse_date(raw):
    raw = str(raw).strip()
    for fmt in ("%m/%d/%Y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            v = dt.datetime.strptime(raw, fmt).date()
            if v.year in range(2024, 2031):
                return v.isoformat()
        except ValueError:
            pass
    return None

def main():
    raw = download(JSON_URL)
    (OUT / "cap-2026-q1-original.json").write_bytes(raw)
    try:
        (OUT / "cap-2026-q1-original.csv").write_bytes(download(CSV_URL))
    except Exception as e:
        print("Optional CSV download failed:", e)
    # The publisher's .json contains comma-separated top-level JSON objects (not an array).
    # Preserve the original bytes; decode each object without altering any source values.
    text = raw.decode("utf-8-sig")
    try:
        rows = json.loads(text)
    except json.JSONDecodeError:
        decoder = json.JSONDecoder()
        rows = []
        pos = 0
        while pos < len(text):
            while pos < len(text) and (text[pos].isspace() or text[pos] in ",;"):
                pos += 1
            if pos >= len(text):
                break
            row, end = decoder.raw_decode(text, pos)
            if not isinstance(row, dict):
                raise RuntimeError("Unexpected CAP top-level JSON item")
            rows.append(row)
            pos = end
    if isinstance(rows, dict):
        rows = next((v for v in rows.values() if isinstance(v, list)), [])
    if not isinstance(rows, list) or not rows:
        raise RuntimeError("CAP schema not recognized: expected nonempty row list")
    def marker(v):
        return next((r for r in rows if isinstance(r, dict) and str(r.get("CATEGORIA DI ANALISI", "")).strip() == v), None)
    names = marker("Data Camp.")
    units = marker("Unità di misura")
    limits = next((r for r in rows if isinstance(r, dict) and "Limiti di legge" in str(r.get("CATEGORIA DI ANALISI", ""))), None)
    if names is None or units is None or limits is None:
        raise RuntimeError("CAP metadata rows missing. Stop: cannot safely infer parameters")
    fields = []
    for key, label in names.items():
        if key in ("CATEGORIA DI ANALISI", "Column2", "Column3", "Column4"):
            continue
        if not isinstance(label, str) or not label.strip():
            continue
        lim = numeric(limits.get(key))
        unit = str(units.get(key, "") or "").strip()
        fields.append({"key": key, "name": label.strip(), "unit": unit, "source_limit": lim["value"] if lim and not lim["censored"] else None})
    data = []
    cities = set()
    for r in rows:
        if not isinstance(r, dict):
            continue
        date = parse_date(r.get("CATEGORIA DI ANALISI", ""))
        city = str(r.get("Column2", "") or "").strip().upper()
        if not city or not date:
            continue
        cities.add(city)
        for field in fields:
            val = numeric(r.get(field["key"]))
            if val is None:
                continue
            limit = field["source_limit"]
            n = val["value"]
            status = "unknown"
            if limit is not None and limit > 0:
                if val["censored"]:
                    status = "under_limit" if n <= limit else "unknown"
                else:
                    status = "above_limit" if n > limit else ("near_limit" if n >= limit * .8 else "under_limit")
            data.append({"city": city, "date": date, "address": str(r.get("Column3", "") or "").strip(), "sample": str(r.get("Column4", "") or "").strip(), "parameter": field["key"], "value": n, "censored": val["censored"], "status": status})
    if not data:
        raise RuntimeError("No measurements found. Verify date format and CAP source schema")
    result = {"metadata": {"source": JSON_URL, "csv_source": CSV_URL, "source_sha256": hashlib.sha256(raw).hexdigest(), "updated_utc": dt.datetime.now(dt.timezone.utc).isoformat(), "period_label": "I trimestre 2026", "notes": ["Limits copied from CAP dataset metadata; legal applicability has not been independently verified", "Results expressed as <x are censored values, not measured x", "Date parsing uses US-first format; verify ambiguous dates with source", "No spatial coordinates published in this source: point locations are not inferred"]}, "fields": fields, "cities": sorted(cities), "samples": data}
    (OUT / "dashboard.json").write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("records", len(rows), "cities", len(cities), "measurements", len(data), "parameters", len(fields))

if __name__ == "__main__":
    main()
