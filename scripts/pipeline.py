"""CAP ETL stage 1: one independent, reproducible normalized dataset per quarter.

A new incompatible CAP export is quarantined. Previously validated period archives remain
unchanged, so a future format change cannot invalidate earlier quarters.
"""
import gzip
import hashlib
import json
import os
import tempfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from etl_csv_all import (SRC, OUT, RAW, QUARTERS, download, discover_periods,
                         csv_rows, read_schema, choose_date_format, date_value, numeric,
                         normalize, save_json)

NORMALIZED = OUT / "normalized"
NORMALIZED.mkdir(parents=True, exist_ok=True)


def atomic_bytes(path: Path, payload: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    target = path.with_suffix(path.suffix + ".part")
    target.write_bytes(payload)
    target.replace(path)


def parse_period(source):
    pid = source["id"]
    csv_raw = download(source["csv_url"])
    json_raw = download(source["json_url"])
    rows, encoding, delimiter = csv_rows(csv_raw)
    labels, indexes, fields = read_schema(rows, pid)
    header_idx = next(i for i,r in enumerate(rows)
                      if r and (normalize(r[0]).startswith("datacamp") or normalize(r[0])=="dataprelievo"))
    fmt = choose_date_format(rows, header_idx)
    city_ix, address_ix, sample_ix = indexes
    lim_row = next((r for r in rows[:12] if r and "limit" in normalize(r[0]) and "legge" in normalize(r[0])), [])
    for f in fields:
        f["source_limit_text"] = lim_row[f["index"]] if f["index"] < len(lim_row) else ""
    field_lookup = {f["key"]:f for f in fields}
    by_field = defaultdict(list)
    period_dir = NORMALIZED / pid
    period_dir.mkdir(parents=True, exist_ok=True)
    tmp_file = period_dir / "observations.jsonl.gz.part"
    count = sample_rows = 0
    cities = set()
    days = []
    wrong_quarter = 0
    quarter = source["quarter"]
    try:
        with gzip.open(tmp_file,"wt",encoding="utf-8",compresslevel=6) as out:
            for r in rows[header_idx+1:]:
                date = date_value(r[0] if r else "", fmt)
                city = str(r[city_ix] if city_ix < len(r) else "").strip().upper()
                if not date or not city:
                    continue
                yy,mm = int(date[:4]),int(date[5:7])
                if yy != source["year"] or (mm-1)//3+1 != quarter:
                    wrong_quarter+=1
                    continue
                sample_rows += 1
                days.append(date)
                cities.add(city)
                address = str(r[address_ix] if address_ix < len(r) else "").strip()
                sample = str(r[sample_ix] if sample_ix < len(r) else "").strip()
                for field in fields:
                    idx = field["index"]
                    raw_value = r[idx] if idx < len(r) else ""
                    number = numeric(raw_value)
                    if number is None:
                        continue
                    value = number["value"]
                    censored = number["censored"]
                    limit = field["limit"]
                    status = "unknown"
                    if limit is not None and limit >= 0:
                        if censored:
                            status = "under_limit" if value <= limit else "unknown"
                        else:
                            status = ("above_limit" if value>limit else
                                      "near_limit" if limit>0 and value>=limit*.8 else "under_limit")
                    row = {"city":city,"date":date,"address":address,"sample":sample,
                           "parameter":field["key"],"value":value,"censored":censored,
                           "raw":raw_value,"status":status}
                    out.write(json.dumps(row,ensure_ascii=False,separators=(",",":"))+"\n")
                    by_field[field["key"]].append({k:row[k] for k in
                                  ("city","date","address","sample","value","censored","status")})
                    count+=1
        if count<20000 or sample_rows<500 or len(by_field)<40:
            raise ValueError(f"Suspicious quarter: {count} observations, {sample_rows} samples, {len(by_field)} fields")
        if wrong_quarter > sample_rows * .02:
            raise ValueError(f"{wrong_quarter} samples do not belong in {pid}")
        # All validation completes before exposing this period's new source or schema.
        atomic_bytes(RAW/f"{pid}.csv",csv_raw)
        atomic_bytes(RAW/f"{pid}.json",json_raw)
        for key,values in by_field.items():
            save_json(QUARTERS/pid/f"{key}.json",values)
        tmp_file.replace(period_dir/"observations.jsonl.gz")
        schema = {
          "schema_version":1,"period":pid,"year":source["year"],"quarter":quarter,
          "label":f"{quarter}° trimestre {source['year']}",
          "source_rows":sample_rows,"count":count,"cities_count":len(cities),
          "cities":sorted(cities),"parameters_count":len(by_field),
          "dates_min":min(days),"dates_max":max(days),"date_format":fmt,
          "encoding":encoding,"delimiter":delimiter,
          "source_csv":source["csv_url"],"source_json":source["json_url"],
          "sha256_csv":hashlib.sha256(csv_raw).hexdigest(),
          "sha256_json":hashlib.sha256(json_raw).hexdigest(),
          "fields":[{"key":f["key"],"name":f["name"],"unit":f["unit"],
                     "limit":f["limit"],"limit_raw":f["source_limit_text"],
                     "unit_derivation":f["unit_derivation"],
                     "source_unit":f["source_unit"]} for f in fields if f["key"] in by_field],
          "quarantined_records":wrong_quarter,
          "analysis_source":"official CSV; original CSV and JSON archived unchanged",
          "unit_repairs":[{"name":f["name"],"original":f["source_unit"],"accepted":f["unit"]}
                          for f in fields if f["unit_derivation"]=="source_header_repaired_from_four_plus_quarters"]
        }
        save_json(period_dir/"schema.json",schema)
        print(f"PERIOD_OK {pid} observations={count} samples={sample_rows} fields={len(by_field)}",flush=True)
        return True
    except Exception:
        tmp_file.unlink(missing_ok=True)
        raise


def main():
    source_registry=json.loads(SRC.read_text(encoding="utf-8"))
    sources=discover_periods(source_registry)
    issues=[]
    accepted=0
    for source in sources:
        pid=source["id"]
        valid=(NORMALIZED/pid/"schema.json").is_file() and (NORMALIZED/pid/"observations.jsonl.gz").is_file()
        try:
            parse_period(source)
            accepted+=1
        except Exception as exc:
            message=f"{pid}: {type(exc).__name__}: {exc}"
            if valid:
                print("REUSING_LAST_VALID",message,flush=True)
                issues.append({"period":pid,"reason":str(exc),"action":"reused last validated archive"})
                accepted+=1
            else:
                # New formats are reported explicitly, but do not break historical quarters.
                print("QUARANTINED_NEW_PERIOD",message,flush=True)
                issues.append({"period":pid,"reason":str(exc),"action":"excluded until parser reviewed"})
    if accepted==0:
        raise RuntimeError("No validated CAP data available")
    save_json(OUT/"pipeline_quality.json",{
        "checked_utc":datetime.now().astimezone().isoformat(),
        "source_registry":source_registry["landing_page"],
        "found_quarters":len(sources),"validated_quarters":accepted,"issues":issues
    })
    print("NORMALIZED_COMPLETE",accepted,"quarters",len(issues),"issues",flush=True)


if __name__=="__main__":
    main()
