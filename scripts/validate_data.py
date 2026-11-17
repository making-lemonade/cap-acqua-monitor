"""Fail CI when normalized historical data, provenance or limit handling are inconsistent."""
import gzip
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/"public"/"data"

def load(path):return json.loads(path.read_text(encoding="utf-8"))

def main():
    manifest=load(DATA/"manifest.json")
    snapshot=load(DATA/"city_latest.json")
    latest=load(DATA/"latest_signals.json")
    periods=manifest["periods"]
    assert len(periods)>=11, "Expected at least the 11 verified 2024–2026 quarters"
    assert sum(x["count"] for x in periods)==manifest["counts"]["observations"]
    assert len({p["id"] for p in periods})==len(periods)
    assert snapshot["latest_period"]==periods[-1]["id"]
    assert latest["latest_period"]==periods[-1]["id"]
    assert len({f["key"] for f in manifest["fields"]})==len(manifest["fields"])
    # Every municipality must have an independently fetchable small detail payload.
    city_paths=latest.get("city_files", {})
    assert set(city_paths)==set(manifest["cities"]), "City detail shards missing or extra"
    indexed_signals={(e["city"],e["parameter"]) for e in latest["events"]}
    for city,relative in city_paths.items():
        assert relative.startswith("data/city_latest/") and ".." not in relative
        detail=load(ROOT/"public"/relative)
        assert detail["city"]==city
        assert detail["latest_period"]==latest["latest_period"]
        assert detail["events"], f"No detailed readings for {city}"
        assert all(e["city"]==city for e in detail["events"])
        for e in detail["events"]:
            if e["period"]==latest["latest_period"] and e["indicator"]!="not_flagged":
                assert (city,e["parameter"]) in indexed_signals
    # Curated cluster parameter labels must match a real normalized CAP parameter.
    cfg=load(ROOT/"public"/"config"/"clusters.json")
    def normal(label):
        import unicodedata
        import re
        value=unicodedata.normalize("NFKD",label).encode("ascii","ignore").decode("ascii")
        return re.sub(r"[^a-z0-9]","",value.lower())
    names={normal(f["name"]) for f in manifest["fields"]}
    assert len(cfg["clusters"])>=10, "Missing curated thematic groups"
    assert len({group["id"] for group in cfg["clusters"]})==len(cfg["clusters"])
    for group in cfg["clusters"]:
        assert group["parameters"], f"Empty cluster: {group['id']}"
        for name in group["parameters"]:
            assert normal(name) in names, f"Unknown CAP cluster label: {name}"
    print("CITY_AND_CLUSTER_GATE_PASS",len(city_paths),"city files",len(cfg["clusters"]),"clusters",flush=True)
    for p in periods:
        period=p["id"]
        folder=DATA/"normalized"/period
        schema=load(folder/"schema.json")
        assert schema["count"]==p["count"]
        assert (folder/"observations.jsonl.gz").stat().st_size>1000
        assert (DATA/"raw"/f"{period}.csv").stat().st_size>1000
        assert (DATA/"raw"/f"{period}.json").stat().st_size>1000
        assert schema["sha256_csv"]==p["sha256_csv"]
        assert schema["sha256_json"]==p["sha256_json"]
    # Guard against the original bug: censored arsenic is NOT '1 ug/l'.
    q1=load(DATA/"normalized"/"2026-q1"/"schema.json")
    arsenic=next(x for x in q1["fields"] if x["name"]=="Arsenico (As)")
    assert arsenic["unit"]=="µg/l"
    assert arsenic["limit"]==10
    found=False
    with gzip.open(DATA/"normalized"/"2026-q1"/"observations.jsonl.gz","rt",encoding="utf-8") as handle:
        for line in handle:
            row=json.loads(line)
            if (row["city"]=="ABBIATEGRASSO" and row["address"]=="Via Pasubio"
                    and row["date"]=="2026-02-05" and row["parameter"]==arsenic["key"]):
                assert row["censored"],"Arsenic value lost its less-than marker"
                assert row["value"]==1
                assert row["raw"].strip().startswith("<")
                found=True
                break
    assert found,"Expected exact sourced arsenic quality-control example"
    for e in snapshot["events"]:
        if e["limit_percent"] is not None:
            assert e["limit"] is not None and e["limit"]>0
        if e["censored"] and e["statistical"] is not None:
            raise AssertionError("Censored results cannot have exact statistical anomalies")
        if e["statistical"] is not None:
            assert e["statistical"]["history_count"]>=10
    print("QUALITY_GATE_PASS",len(periods),"periods",manifest["counts"]["observations"],
          "observations",len(snapshot["events"]),"recent readings",len(latest["events"]),"alerts",flush=True)

if __name__=="__main__":main()
