"""
train.py — fit StockMind's models from the command line.

Master can retrain without the app running:

    python train.py --symbol NIFTY50 --horizon 5
    python train.py --symbol NIFTY50 --derivatives --deriv-symbol NIFTY
    python train.py --dry-run                       # report scores, write nothing

THE HORIZON IS THE ONE CHOICE THAT MATTERS HERE (spec Section 69). It sets what the model
is being asked to predict: `--horizon 1` is next-bar, `5` is a swing of about a week on
daily bars, `20` is positional. It is recorded in every artifact, so a model trained for one
horizon can never be silently used as though trained for another.

Nothing is written unless a model beats its holdout base rate. "Nothing beat always-guessing
the majority class" is a real answer about the data, not a failure.
"""

import argparse
import json
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(message)s")


def main() -> int:
    p = argparse.ArgumentParser(description="Train StockMind's ensemble on stored history.")
    p.add_argument("--symbol", default="NIFTY50", help="stored OHLCV series to train on")
    p.add_argument("--exchange", default="NSE")
    p.add_argument("--interval", default="1d")
    p.add_argument("--horizon", type=int, default=None,
                   help="bars ahead the label looks (default 5 — swing)")
    p.add_argument("--derivatives", action="store_true",
                   help="join the Section 67 option/future metrics into the feature vector")
    p.add_argument("--models", default=None,
                   help="comma-separated subset, e.g. random_forest,mlp")
    p.add_argument("--splits", type=int, default=4, help="forward-chaining folds")
    p.add_argument("--holdout", type=float, default=0.2, help="fraction held back entirely")
    p.add_argument("--stride", type=int, default=1,
                   help="use every Nth bar; consecutive bars overlap heavily in features")
    p.add_argument("--max-rows", type=int, default=None)
    p.add_argument("--dry-run", action="store_true", help="score everything, persist nothing")
    p.add_argument("--json", action="store_true", help="print the full report as JSON")
    a = p.parse_args()

    from engine.training import train, DEFAULT_HORIZON

    horizon = a.horizon or DEFAULT_HORIZON
    if a.horizon is None:
        print(f"No --horizon given; using the default {DEFAULT_HORIZON} bars (swing). "
              f"It is recorded in the artifact, so this is a choice, not an assumption.\n")

    report = train(
        symbol=a.symbol, exchange=a.exchange, interval=a.interval, horizon=horizon,
        include_derivatives=a.derivatives,
        models=[m.strip() for m in a.models.split(",")] if a.models else None,
        n_splits=a.splits, holdout_frac=a.holdout, stride=a.stride,
        max_rows=a.max_rows, dry_run=a.dry_run,
    )

    if a.json:
        print(json.dumps(report, indent=2, default=str))
        return 0 if report.get("ok") else 1

    if not report.get("ok"):
        print(f"Could not train: {report.get('reason')}")
        print("\nIf the store is empty, fetch history first:")
        print("  python -c \"from engine import store; "
              "print(store.sync('NIFTY50','NSE','1d',years=30)[1])\"")
        return 1

    print(f"symbol            {report['symbol']} ({report['exchange']} {report['interval']})")
    print(f"horizon           {report['horizonBars']} bars")
    print(f"features          {report['featureCount']}"
          + (f" (derivatives included, coverage {report['derivativeCoverage']})"
             if report["includeDerivatives"] else " (price/volume only)"))
    print(f"rows              {report['rows']} (stride {report['stride']}), "
          f"{report['positiveRate']:.1%} up")
    print(f"train range       {report['trainRange']['first']} -> {report['trainRange']['last']}")
    print(f"holdout range     {report['holdoutRange']['first']} -> "
          f"{report['holdoutRange']['last']} ({report['holdoutRows']} rows)")
    print(f"holdout base rate {report['holdoutBaseRate']:.4f}  (always-majority accuracy)")
    g = report["gate"]
    print(f"gate              AUC >= {g['minAuc']}, Brier skill > {g['minBrierSkill']}, "
          f"fold AUC >= {g['minFoldAuc']}")
    print(f"                  {g['note']}")
    print()
    print(f"{'model':<16}{'AUC':>8}{'BSS':>9}{'acc':>8}{'edge':>8}{'brier':>8}{'ece':>8}"
          f"{'foldAUC':>9}  persisted")
    print("-" * 88)
    for name, m in report["models"].items():
        h = m["holdout"]
        auc = h.get("auc")
        bss = h.get("brierSkillScore")
        print(f"{name:<16}{(auc if auc is not None else 0):>8.4f}"
              f"{(bss if bss is not None else 0):>+9.4f}"
              f"{h['accuracy']:>8.4f}{h['edgeOverBase']:>+8.4f}"
              f"{h['brierScore']:>8.4f}{h['ece']:>8.4f}"
              f"{(m.get('foldMeanAuc') or 0):>9.4f}  "
              f"{'yes' if m['persisted'] else 'NO'}")
        if not m.get("accepted"):
            print(f"{'':<16}refused: {m.get('reason','')}")
    for name, why in (report.get("skipped") or {}).items():
        print(f"{name:<16}skipped: {why}")
    print()
    print(report["summary"])
    if report.get("reloaded"):
        print(f"reloaded: now trained {report['reloaded'].get('trainedAfter')}")
    if not report["persistedModels"]:
        print("\nNothing was persisted. That is a result, not an error: no model cleared all "
              "three conditions on this data, and the reason is printed per model above. "
              "Shipping one anyway would make predictions worse while /health reported a "
              "trained artifact. Try a different --horizon (see sweep_horizons), a longer "
              "history, or --derivatives.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
