"""CAP ETL stage 2: join independently validated quarterly normalizations.

Reads ONLY public/data/normalized/<quarter>/schema.json and observations.jsonl.gz.
A new CAP source format can no longer corrupt past quarter snapshots.
Emits a complete reproducible combined union, period/parameter browser shards,
quarterly trends and defensible latest municipality signals.
"""
from __future__ import annotations
import gzip
import json
import hashlib
import math
import statistics
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from etl_all import OUT, TRENDS, QUARTERS, RAW, GEO_URL, save_json, reference_geography, agg_update, empty_agg
from gziputil import deterministic_text_gzip

NORMALIZED=OUT/"normalized"
CONFIG=Path(__file__).resolve().parents[1]/"public"/"config"/"clusters.json"
COMBINED=OUT/"combined"
def priority(item):
    status=item.get("status")
    rank={"above_limit":4,"near_limit":3,"under_limit":2,"unknown":1}.get(status,0)
    return (rank,not item["censored"],item["value"])
def detect(v,hist,threshold,min_hist):
    if v["censored"]:return None
    historic=[x for date,x in hist if date<v["date"]]
    if len(historic)<min_hist or len(set(historic))<5:return None
    median=statistics.median(historic)
    deviations=[abs(x-median) for x in historic]
    mad=statistics.median(deviations)
    if mad<1e-10:return None
    z=.67448975*(v["value"]-median)/mad
    if not math.isfinite(z):return None
    return {"z":round(z,2),"reference_median":round(median,6),"history_count":len(historic),
            "direction":"high" if z>0 else "low",
            "flag":abs(z)>=threshold}
def main():
    config=json.loads(CONFIG.read_text(encoding="utf-8"))
    min_hist=int(config["analysis"]["min_history_quantified"])
    z_threshold=float(config["analysis"]["statistical_robust_z"])
    periods=[]
    fields={}
    sources=[]
    for schema in sorted(NORMALIZED.glob("*/schema.json")):
        part=json.loads(schema.read_text(encoding="utf-8"))
        source_path=schema.parent/"observations.jsonl.gz"
        if not source_path.is_file():continue
        pid=part["period"]
        if part["count"]<20000 or not part["fields"]:continue
        info={k:v for k,v in part.items() if k not in ("fields","cities")}
        periods.append(info)
        sources.append((part,source_path))
        for field in part["fields"]:
            key=field["key"]
            f=fields.setdefault(key,{"key":key,"name":field["name"],"unit":field["unit"],
                                   "periods":[],"limits_by_period":{},"limit_text_by_period":{}})
            if f["unit"]!=field["unit"]:
                raise ValueError(f"Unit collision: {key} {pid}")
            f["periods"].append(pid)
            f["limits_by_period"][pid]=field["limit"]
            f["limit_text_by_period"][pid]=field.get("limit_raw","")
    if not sources:raise RuntimeError("No normalized quarterly datasets")
    periods.sort(key=lambda p:(p["year"],p["quarter"]))
    latest_pid=periods[-1]["period"]
    cities=set()
    trend=defaultdict(lambda:defaultdict(empty_agg))
    last={}
    historical=defaultdict(list)
    COMBINED.mkdir(parents=True,exist_ok=True)
    mergedfile=COMBINED/"observations.jsonl.gz"
    temp=COMBINED/"observations.jsonl.gz.part"
    total=0
    with deterministic_text_gzip(temp,compresslevel=6) as merged:
        for part,path in sources:
            pid=part["period"]
            print("ASSEMBLE_PERIOD",pid,flush=True)
            with gzip.open(path,"rt",encoding="utf-8") as stream:
                for line in stream:
                    if not line.strip():continue
                    row=json.loads(line)
                    row["period"]=pid
                    key=row["parameter"]
                    field=fields.get(key)
                    if not field:raise RuntimeError(f"Unknown parameter {key} in {pid}")
                    if row["date"][:4]!=str(part["year"]):
                        raise ValueError(f"Invalid year in {pid}")
                    cities.add(row["city"])
                    merged.write(json.dumps(row,ensure_ascii=False,separators=(",",":"))+"\n")
                    total+=1
                    for c in (row["city"],"*"):
                        agg_update(trend[key][(pid,c)],row)
                    ident=(row["city"],key)
                    old=last.get(ident)
                    if old is None or row["date"]>old["date"]:
                        last[ident]={**row,"samples_same_day":1}
                    elif row["date"]==old["date"]:
                        count=old["samples_same_day"]+1
                        if priority(row)>priority(old):
                            last[ident]={**row,"samples_same_day":count}
                        else:
                            old["samples_same_day"]=count
                    if not row["censored"]:
                        historical[ident].append((row["date"],row["value"]))
    temp.replace(mergedfile)
    if total!=sum(p["count"] for p in periods):
        raise RuntimeError("Stage-2 union count differs from sum of stage-1 normalizations")
    for key,groups in trend.items():
        values=[]
        for (period,city),b in sorted(groups.items()):
            values.append({
                "period":period,"city":city,"count":b["count"],"measured":b["measured"],
                "censored":b["censored"],"avg":round(b["sum"]/b["measured"],6) if b["measured"] else None,
                "min":b["min"],"max":b["max"],"above":b["above"],"near":b["near"],"unknown":b["unknown"]
            })
        save_json(TRENDS/f"{key}.json",values)
    latest=[]
    for (city,key),sample in last.items():
        field=fields[key]
        pid=sample["period"]
        limit=field["limits_by_period"].get(pid)
        pct=round(100*sample["value"]/limit,4) if limit is not None and limit>0 else None
        signal=detect(sample,historical[(city,key)],z_threshold,min_hist)
        if sample["status"]=="above_limit":indicator="source_above_limit"
        elif sample["status"]=="near_limit":indicator="source_near_limit"
        elif signal and signal["flag"]:indicator="statistical_"+signal["direction"]
        else:indicator="not_flagged"
        latest.append({
          "city":city,"parameter":key,"name":field["name"],"unit":field["unit"],
          "date":sample["date"],"period":pid,"address":sample["address"],
          "sample":sample["sample"],"samples_same_day":sample["samples_same_day"],
          "value":sample["value"],"raw":sample["raw"],"censored":sample["censored"],
          "limit":limit,"limit_raw":field["limit_text_by_period"].get(pid,""),
          "limit_percent":pct,"status":sample["status"],"indicator":indicator,
          "statistical":signal
        })
    latest.sort(key=lambda x:(x["city"],x["parameter"]))
    # Small overview index plus one fast, independently fetchable file per city.
    # Mobile visitors no longer download the ~8.6 MB global observation snapshot.
    city_details=defaultdict(list)
    for row in latest:
        city_details[row["city"]].append(row)
    city_files={}
    for city,items in city_details.items():
        city_id=hashlib.sha256(city.encode("utf-8")).hexdigest()[:16]
        city_files[city]=f"data/city_latest/{city_id}.json"
        save_json(OUT/"city_latest"/f"{city_id}.json",{
            "city":city,"latest_period":latest_pid,"events":items
        })
    alerts=[x for x in latest if x["period"]==latest_pid and x["indicator"]!="not_flagged"]
    alerts.sort(key=lambda x:({"source_above_limit":0,"source_near_limit":1,"statistical_high":2,"statistical_low":3}.get(x["indicator"],4),
                              x["city"],x["name"]))
    save_json(OUT/"city_latest.json",{"latest_period":latest_pid,"events":latest,
             "notes":["Each event shows the worst-ranking result on the city's most recent sampling date for this parameter.",
                      "A municipality may be sampled at different points on different dates.",
                      "Source threshold exceedances and historical statistical outliers are distinct concepts.",
                      "The statistical baseline uses prior quantified results from the same municipality and parameter only."]})
    save_json(OUT/"latest_signals.json",{"latest_period":latest_pid,"city_files":city_files,"events":alerts,
             "statistical_method":"median and MAD robust z-score","minimum_history":min_hist,
             "threshold_abs_z":z_threshold})
    geography=reference_geography(cities)
    quality_path=OUT/"pipeline_quality.json"
    quality=json.loads(quality_path.read_text(encoding="utf-8")) if quality_path.exists() else {"issues":[]}
    manifest={
      "metadata":{
        "source":"https://www.gruppocap.it/it/cosa-facciamo/qualita-acqua",
        "updated_utc":datetime.now(timezone.utc).isoformat(),
        "normalization":"Independent /data/normalized/YYYY-qN/schema.json + observations.jsonl.gz, then combined union",
        "notes":["Original JSON and CSV archived byte-for-byte with SHA-256 per quarter.",
                 "Each quarter has its own validated normalized schema and gzip JSONL observations.",
                 "A malformed future quarter is quarantined without re-parsing older normalized archives.",
                 "Source limit values are metadata, not independent legal verification.",
                 "Censored concentrations are upper bounds, not exact measurements.",
                 "The map uses municipality reference coordinates, never aqueduct sampling points."]
      },
      "periods":[{**p,"id":p["period"]} for p in periods],
      "cities":sorted(cities),
      "fields":sorted(fields.values(),key=lambda x:x["name"].lower()),
      "counts":{"periods":len(periods),"cities":len(cities),"parameters":len(fields),"observations":total},
      "geography":{"source":GEO_URL,"license":"CC BY 4.0","credit":"RP92/comuni-italiani, ISTAT and Garda Informatica","locations":geography},
      "failures":quality.get("issues",[])
    }
    save_json(OUT/"manifest.json",manifest)
    print("ASSEMBLY_OK",json.dumps({"periods":len(periods),"observations":total,"cities":len(cities),
         "params":len(fields),"latest_events":len(latest),"signals":len(alerts)}),flush=True)

if __name__=="__main__":main()
