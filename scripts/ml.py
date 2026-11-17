"""Exploratory unsupervised anomaly detection: NOT an assessment of drinking-water safety."""
import json
import math
import collections
from pathlib import Path
from sklearn.ensemble import IsolationForest
import sklearn

DATA = Path(__file__).resolve().parents[1] / "public" / "data"
CANDIDATE_TERMS = (
    "nitrato", "nitrito", "arsenico", "solfato", "cloruro", "durezza",
    "conduttivit", "calcio", "fluoruro", "sodio", "manganese",
    "ferro", "pfoa", "pfos", "potassio", "uranio", "ph",
)

def main():
    data = json.loads((DATA / "dashboard.json").read_text(encoding="utf-8"))
    by_parameter = collections.defaultdict(list)
    for sample in data["samples"]:
        if sample["censored"] or sample["value"] < 0 or not math.isfinite(sample["value"]):
            continue
        by_parameter[sample["parameter"]].append(sample)
    out = []
    trained = 0
    for field in data["fields"]:
        name = field["name"].lower()
        if not any(term in name for term in CANDIDATE_TERMS):
            continue
        group = by_parameter.get(field["key"], [])
        if len(group) < 60:
            continue
        values = [s["value"] for s in group]
        if len(set(values)) < 12:
            continue
        features = [[math.log1p(v)] for v in values]
        model = IsolationForest(
            n_estimators=64, contamination=0.025, max_samples=min(256, len(features)),
            random_state=42, n_jobs=1,
        )
        model.fit(features)
        scores = model.decision_function(features)
        trained += 1
        unusual = sorted(((float(-score), i) for i, score in enumerate(scores) if score < 0), reverse=True)
        for score, idx in unusual[:6]:
            sample = group[idx]
            out.append({
                "city": sample["city"], "date": sample["date"],
                "sample": sample["sample"], "address": sample["address"],
                "parameter": field["key"], "name": field["name"],
                "unit": field["unit"], "value": sample["value"],
                "score": round(score, 5),
            })
    out.sort(key=lambda a: a["score"], reverse=True)
    result = {
        "model": "IsolationForest",
        "library": "scikit-learn",
        "version": sklearn.__version__,
        "trained_parameters": trained,
        "random_state": 42,
        "contamination": 0.025,
        "anomalies": out,
        "disclaimer": "Exploratory anomaly scores only. Heterogeneous city water chemistry and measurement practices can generate false positives. NOT a potability assessment, legal exceedance or medical risk.",
    }
    (DATA / "ml-anomalies.json").write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("ML models trained:", trained, "exploratory anomalies:", len(out))

if __name__ == "__main__":
    main()
