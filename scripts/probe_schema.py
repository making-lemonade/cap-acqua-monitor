"""Print only metadata shape and header examples, never entire source files."""
import json
from etl_all import SRC, discover_periods, download, parse_rows, normalize

def main():
    sources=discover_periods(json.loads(SRC.read_text(encoding="utf-8")))
    for s in sources:
        try:
            rows=parse_rows(download(s["json_url"]))
            print("SCHEMA", s["id"], "rows",len(rows),"sample_keys",len(rows[0]),flush=True)
            for idx,r in enumerate(rows[:5]):
                preview={k:str(v)[:70] for k,v in list(r.items())[:8]}
                print("HEADER_ROW",s["id"],idx,json.dumps(preview,ensure_ascii=False),flush=True)
            m=next((r for r in rows if normalize(r.get("Column2",""))=="comune" or "data camp" in str(r.get("CATEGORIA DI ANALISI","")).lower()),None)
            if m:
                keys=list(m.keys())
                print("META_SUMMARY",s["id"],"columns",len(keys),"first_labels",json.dumps({k:str(m.get(k))[:36] for k in keys[:24]},ensure_ascii=False),flush=True)
            first=next((r for r in rows if str(r.get("Column2","")).strip().isupper() and len(str(r.get("Column2",""))) > 3),None)
            if first:
                print("SAMPLE",s["id"],json.dumps({k:str(v)[:30] for k,v in list(first.items())[:24]},ensure_ascii=False),flush=True)
        except Exception as e:
            print("SCHEMA_PROBE_FAILED",s["id"],str(e),flush=True)

if __name__=="__main__":main()
