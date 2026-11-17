"""Canonical CAP 2024–2026 CSV-first parser.

Several official CAP JSON exports are structurally corrupted (e.g. a semicolon-delimited
entire row stored in one JSON property, or repeated field names collapsed). The CSV is
the authoritative analysis input and both original CSV and JSON bytes are retained.
"""
import csv
import hashlib
import io
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from etl_all import (SRC, OUT, RAW, QUARTERS, TRENDS, GEO_URL, download,
                     discover_periods, numeric, normalize, field_id, save_json,
                     reference_geography, agg_update, empty_agg)


def csv_rows(content):
    encoding_used = None
    text = None
    for encoding in ("utf-8-sig", "cp1252", "iso-8859-1"):
        try:
            text = content.decode(encoding)
            encoding_used = encoding
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ValueError("Could not decode CAP CSV")
    # CAP files are semicolon-delimited; some exports may use tab delimiters.
    sample = text[:15000]
    delimiter = ";" if sample.count(";") > sample.count("\t") else "\t"
    if sample.count(delimiter) < 20:
        try:
            delimiter = csv.Sniffer().sniff(sample, delimiters=";,\t").delimiter
        except csv.Error:
            raise ValueError("Unrecognized CAP CSV delimiter")
    parsed = [[v.strip() for v in row] for row in csv.reader(io.StringIO(text, newline=""), delimiter=delimiter)]
    parsed = [r for r in parsed if r and any(v for v in r)]
    if len(parsed) < 500:
        raise ValueError(f"Suspiciously few CSV rows: {len(parsed)}")
    return parsed, encoding_used, delimiter


def read_schema(rows, pid):
    labels = units = limits = None
    for row in rows[:12]:
        headline = normalize(row[0])
        if headline.startswith("datacamp") or headline == "dataprelievo":
            labels = row
        elif "unit" in headline and "misura" in headline:
            units = row
        elif "limit" in headline and "legge" in headline:
            limits = row
    if labels is None:
        raise ValueError(f"{pid}: no 'Data Camp.' column metadata in official CSV")
    if len(labels) < 50:
        raise ValueError(f"{pid}: only {len(labels)} parameter columns in official CSV")
    if units is None:
        print(f"WARNING {pid}: no measurement-unit header; cross-period names will remain separate", flush=True)
        units = []
    if limits is None:
        print(f"WARNING {pid}: no source-threshold header; legal comparison unavailable", flush=True)
        limits = []
    def at(row, index):
        return row[index] if index < len(row) else ""
    # Find municipality / address / sample columns from published labels.
    city_index = next((i for i, v in enumerate(labels) if normalize(v) == "comune"), 1)
    address_index = next((i for i, v in enumerate(labels) if normalize(v) == "indirizzo"), 2)
    sample_index = next((i for i, v in enumerate(labels) if "codicecampione" in normalize(v)), 3)
    fields = []
    used = set()
    for i, name in enumerate(labels):
        if i in (0, city_index, address_index, sample_index):
            continue
        name = str(name).strip()
        if not name:
            continue
        unit = str(at(units, i)).strip()
        id = field_id(name, unit)
        if id in used:
            id = hashlib.sha1((id + str(i)).encode()).hexdigest()[:12]
        used.add(id)
        n = numeric(at(limits, i))
        limit = n["value"] if n and not n["censored"] else None
        fields.append({"index": i, "key": id, "name": name, "unit": unit, "limit": limit})
    if len(fields) < 40:
        raise ValueError(f"{pid}: only {len(fields)} labeled measurement columns")
    return labels, (city_index, address_index, sample_index), fields


def choose_date_format(rows, header_index):
    us = eu = 0
    for r in rows[header_index + 1 : header_index + 800]:
        if not r:
            continue
        m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/20\d\d", r[0])
        if not m:
            continue
        left, right = int(m.group(1)), int(m.group(2))
        if right > 12 and left <= 12:
            us += 1
        if left > 12 and right <= 12:
            eu += 1
    return "%d/%m/%Y" if eu > us else "%m/%d/%Y"


def date_value(v, primary):
    for fmt in (primary, "%Y-%m-%d", "%d/%m/%Y" if primary == "%m/%d/%Y" else "%m/%d/%Y"):
        try:
            d = datetime.strptime(v, fmt).date()
            if 2024 <= d.year <= datetime.now(timezone.utc).year:
                return d.isoformat()
        except ValueError:
            continue
    return None


def main():
    registry = json.loads(SRC.read_text(encoding="utf-8"))
    sources = discover_periods(registry)
    for directory in (OUT, RAW, QUARTERS, TRENDS):
        directory.mkdir(parents=True, exist_ok=True)
    fields_by_key = {}
    cities = set()
    periods = []
    series = defaultdict(lambda: defaultdict(empty_agg))
    issues = []
    for source in sources:
        pid = source["id"]
        try:
            raw_csv = download(source["csv_url"])
            raw_json = download(source["json_url"])
            rows, encoding, separator = csv_rows(raw_csv)
            labels, indexes, fieldmap = read_schema(rows, pid)
            header_index = next(i for i, row in enumerate(rows) if row and (normalize(row[0]).startswith("datacamp") or normalize(row[0]) == "dataprelievo"))
            fmt = choose_date_format(rows, header_index)
            city_idx, address_idx, code_idx = indexes
            by_field = defaultdict(list)
            period_cities, sample_dates = set(), []
            sample_rows = observations = 0
            for r in rows[header_index + 1 :]:
                date = date_value(r[0], fmt)
                city = str(r[city_idx] if city_idx < len(r) else "").strip().upper()
                if not date or not city:
                    continue
                sample_rows += 1
                sample_dates.append(date)
                period_cities.add(city)
                address = str(r[address_idx] if address_idx < len(r) else "").strip()
                code = str(r[code_idx] if code_idx < len(r) else "").strip()
                for field in fieldmap:
                    i = field["index"]
                    n = numeric(r[i] if i < len(r) else "")
                    if n is None:
                        continue
                    v, censored, limit = n["value"], n["censored"], field["limit"]
                    status = "unknown"
                    if limit is not None and limit >= 0:
                        if censored:
                            status = "under_limit" if v <= limit else "unknown"
                        else:
                            status = "above_limit" if v > limit else ("near_limit" if limit > 0 and v >= limit * 0.8 else "under_limit")
                    record = {"city": city, "date": date, "address": address, "sample": code,
                              "value": v, "censored": censored, "status": status}
                    by_field[field["key"]].append(record)
                    observations += 1
                    for key in (city, "*"):
                        agg_update(series[field["key"]][(pid, key)], record)
            if observations < 20000 or sample_rows < 500 or len(by_field) < 40:
                raise ValueError(f"Suspicious parsed dataset: rows={sample_rows} parameters={len(by_field)} observations={observations}")
            (RAW / f"{pid}.csv").write_bytes(raw_csv)
            (RAW / f"{pid}.json").write_bytes(raw_json)
            for field in fieldmap:
                if field["key"] not in by_field:
                    continue
                if field["key"] not in fields_by_key:
                    fields_by_key[field["key"]] = {"key": field["key"], "name": field["name"],
                                                    "unit": field["unit"], "periods": [],
                                                    "limits_by_period": {}}
                item = fields_by_key[field["key"]]
                item["periods"].append(pid)
                item["limits_by_period"][pid] = field["limit"]
            for key, values in by_field.items():
                save_json(QUARTERS / pid / f"{key}.json", values)
            cities.update(period_cities)
            periods.append({
                "id": pid, "year": source["year"], "quarter": source["quarter"],
                "label": f"{source['quarter']}° trimestre {source['year']}",
                "count": observations, "source_rows": sample_rows,
                "cities_count": len(period_cities), "parameters_count": len(by_field),
                "dates_min": min(sample_dates), "dates_max": max(sample_dates),
                "date_format": fmt, "encoding": encoding, "delimiter": separator,
                "source_json": source["json_url"], "source_csv": source["csv_url"],
                "sha256_json": hashlib.sha256(raw_json).hexdigest(),
                "sha256_csv": hashlib.sha256(raw_csv).hexdigest(),
                "analysis_source": "official CSV; JSON archived without conversion"
            })
            print(f"IMPORTED {pid}: rows={sample_rows} cities={len(period_cities)} params={len(by_field)} measures={observations} encoding={encoding} date={fmt}", flush=True)
        except Exception as exc:
            issues.append(f"{pid}: {type(exc).__name__}: {exc}")
            print(f"IMPORT_ERROR {pid}: {exc}", flush=True)
    if issues or len(periods) != len(sources):
        raise RuntimeError("Full CAP archive validation failed: " + "; ".join(issues))
    for key, by_bucket in series.items():
        history = []
        for (period, city), b in sorted(by_bucket.items()):
            history.append({
                "period": period, "city": city, "count": b["count"], "measured": b["measured"],
                "censored": b["censored"],
                "avg": round(b["sum"] / b["measured"], 6) if b["measured"] else None,
                "min": b["min"], "max": b["max"], "above": b["above"], "near": b["near"],
                "unknown": b["unknown"]
            })
        save_json(TRENDS / f"{key}.json", history)
    geography = reference_geography(cities)
    result = {
        "metadata": {
            "source": registry["landing_page"], "updated_utc": datetime.now(timezone.utc).isoformat(),
            "notes": [
                "CSV-first: CAP JSON formats are inconsistent or structurally corrupted in several quarters.",
                "The exact original bytes of both official CSV and JSON are preserved with SHA-256 digests.",
                "Parameter identities are based on normalized label and unit; differing units are kept distinct.",
                "The trend is the weighted mean of quantified observations only (censored values excluded).",
                "Published period-specific CAP limits are not independently validated for legal applicability.",
                "Municipality coordinates are reference points, not water sampling stations."
            ],
        },
        "periods": periods, "fields": sorted(fields_by_key.values(), key=lambda x: x["name"].lower()),
        "cities": sorted(cities),
        "geography": {
            "source": GEO_URL, "credit": "RP92/comuni-italiani, ISTAT and Garda Informatica",
            "license": "CC BY 4.0", "locations": geography
        },
        "counts": {
            "periods": len(periods), "cities": len(cities),
            "parameters": len(fields_by_key),
            "observations": sum(p["count"] for p in periods)
        },
        "failures": []
    }
    save_json(OUT / "manifest.json", result)
    print("FULL_HISTORY_SUCCESS", json.dumps(result["counts"], ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
