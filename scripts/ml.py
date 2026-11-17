"""Exploratory ML anomaly screening over ALL available CAP quarters.

This model is statistical, NOT an assessment of potability or regulatory status.
"""
import collections
import json
import math
from pathlib import Path
from sklearn.ensemble import IsolationForest
import sklearn

DATA = Path(__file__).resolve().parents[1] / "public" / "data"
TERMS = (
    "nitrato", "nitrito", "arsenico", "solfato", "cloruro", "durezza",
    "conduttivit", "calcio", "fluoruro", "sodio", "manganese", "ferro",
    "pfoa", "pfos", "potassio", "uranio", "ph",
)


def main():
    manifest = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
    output = []
    trained = 0
    total_training_rows = 0
    for field in manifest["fields"]:
        name = field["name"].lower()
        if not any(term in name for term in TERMS):
            continue
        group = []
        for period in field["periods"]:
            path = DATA / "quarters" / period / f"{field['key']}.json"
            if not path.exists():
                continue
            rows = json.loads(path.read_text(encoding="utf-8"))
            for row in rows:
                if row["censored"] or row["value"] < 0 or not math.isfinite(row["value"]):
                    continue
                group.append({**row, "period": period})
        if len(group) < 60:
            continue
        values = [s["value"] for s in group]
        if len(set(values)) < 12:
            continue
        features = [[math.log1p(v)] for v in values]
        model = IsolationForest(
            n_estimators=64, contamination=0.025,
            max_samples=min(256, len(features)), random_state=42, n_jobs=1
        )
        model.fit(features)
        scores = model.decision_function(features)
        trained += 1
        total_training_rows += len(features)
        candidates = sorted(
            ((float(-score), i) for i, score in enumerate(scores) if score < 0),
            reverse=True,
        )
        for score, index in candidates[:6]:
            s = group[index]
            output.append({
                "city": s["city"], "date": s["date"], "period": s["period"],
                "sample": s["sample"], "address": s["address"], "parameter": field["key"],
                "name": field["name"], "unit": field["unit"], "value": s["value"],
                "score": round(score, 5)
            })
    output.sort(key=lambda a: a["score"], reverse=True)
    result = {
        "model": "IsolationForest",
        "library": "scikit-learn",
        "version": sklearn.__version__,
        "trained_parameters": trained,
        "training_observations": total_training_rows,
        "source_periods": [p["id"] for p in manifest["periods"]],
        "random_state": 42,
        "contamination": 0.025,
        "anomalies": output,
        "disclaimer": (
            "Statistical exploration only: scores are not legal-limit exceedances or "
            "potability alerts. Spatial and temporal heterogeneity can produce false positives."
        ),
    }
    (DATA / "ml-anomalies.json").write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print("FULL_HISTORY_ML", len(result["source_periods"]), "quarters",
          trained, "models", total_training_rows, "training rows",
          len(output), "exploratory examples", flush=True)


if __name__ == "__main__":
    main()
