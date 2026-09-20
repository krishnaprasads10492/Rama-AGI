"""
test_macro.py — master's transmission chain, measured (Section 114).

The measurement is the product here, so it is tested the way `test_strategy_eval` tests its harness: by
planting a relationship and checking it is found, planting none and checking nothing is found, and — the
assertion that matters most — planting a relationship and declaring the WRONG sign, to check the link is
reported as contradicted rather than quietly flipped to match the data.

Run from `ai_backend/`:  py -m tests.test_macro
"""

import math
import pathlib
import random
import sys

# Top-level import, bypassing `engine/__init__.py` and its numpy dependency. The measurement half of
# `macro.py` is stdlib by design; the fetch half is imported lazily inside its own functions, so this
# never touches pandas.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "engine"))
import macro as M   # noqa: E402

_pass = 0
_fail = 0


def check(label, ok, detail=""):
    global _pass, _fail
    if ok:
        _pass += 1
        print(f"  PASS  {label}")
    else:
        _fail += 1
        print(f"  FAIL  {label}{(' - ' + str(detail)) if detail else ''}")


def dates(n):
    """Sequential ISO dates. Calendar correctness is irrelevant here; ordering and alignment are not."""
    out = []
    y, m, d = 2014, 1, 1
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}-{d:02d}")
        d += 1
        if d > 28:
            d = 1
            m += 1
            if m > 12:
                m = 1
                y += 1
    return out


def planted(n=2600, window=20, lag=20, strength=0.6, noise=0.004, seed=7):
    """
    An input random walk, and a target whose forward move responds NEGATIVELY to sustained input rises.

    The daily target return at t is driven by the input's trailing `window` return at t, spread over
    `lag` days — which is how a cost shock actually transmits: gradually, into the following weeks,
    rather than on the day the headline prints.
    """
    rng = random.Random(seed)
    ds = dates(n)
    iv = [100.0]
    for _ in range(n - 1):
        iv.append(iv[-1] * (1.0 + rng.gauss(0, 0.012)))
    tv = [100.0]
    for t in range(1, n):
        wr = (iv[t] / iv[t - window] - 1.0) if t >= window else 0.0
        drift = -strength * wr / lag
        tv.append(tv[-1] * (1.0 + drift + rng.gauss(0, noise)))
    return list(zip(ds, iv)), list(zip(ds, tv))


print("\nmacro transmission - a chain that can be measured and rejected\n")

IN, TGT = planted()

# ── A planted relationship is found, in the declared direction ────────────────
print("  a planted cost relationship is found")
r = M.measure_link(IN, TGT, sign=-1, window=20, lag=20)
check("the measurement runs", r["ok"] is True, r.get("reason"))
check("and is SUPPORTED", r["verdict"] == "supported", f"{r['verdict']}: {r['reason']}")
check("the declared direction matched", r["directionMatches"] is True)
check("the response is negative: a rise in the input hurts the target", r["response"] < 0, r["response"])
check("the target does worse after a large input rise than after a large fall",
      r["meanForwardAfterRise"] < r["meanForwardAfterFall"])
check("the t-statistic clears the threshold", abs(r["tStat"]) >= M.T_THRESHOLD, r["tStat"])
check("the reason states both conditional returns", "%" in r["reason"] and "t=" in r["reason"])
check("the unconditional mean is reported for comparison", r["unconditionalMean"] is not None)

# ── THE ASSERTION THAT MATTERS MOST ───────────────────────────────────────────
print("\n  a wrong declared sign is CONTRADICTED, never flipped")
w = M.measure_link(IN, TGT, sign=1, window=20, lag=20)
check("the same data with the sign declared backwards is contradicted",
      w["verdict"] == "contradicted", f"{w['verdict']}: {w['reason']}")
check("directionMatches is false", w["directionMatches"] is False)
check("the response is IDENTICAL - only the declared claim differs",
      abs(w["response"] - r["response"]) < 1e-12)
check("the sign in the result is the DECLARED one, not the measured one", w["sign"] == 1)
check("and the reason says the sign is not adjusted to fit",
      "not adjusted to fit" in w["reason"], w["reason"])
check("a contradicted link is never labelled supported", w["verdict"] != "supported")

# ── Noise produces nothing ────────────────────────────────────────────────────
print("\n  noise produces no finding")
rng = random.Random(99)
ds = dates(2600)
n1 = [100.0]
n2 = [100.0]
for _ in range(2599):
    n1.append(n1[-1] * (1.0 + rng.gauss(0, 0.012)))
    n2.append(n2[-1] * (1.0 + rng.gauss(0, 0.012)))
noise_a, noise_b = list(zip(ds, n1)), list(zip(ds, n2))
nr = M.measure_link(noise_a, noise_b, sign=-1, window=20, lag=20)
check("two independent random walks are NOT supported",
      nr["verdict"] in ("not-supported", "contradicted"), f"{nr['verdict']}: {nr['reason']}")
check("and if not supported, the reason names the noise band",
      nr["verdict"] != "not-supported" or "noise band" in nr["reason"], nr["reason"])
weak = sum(1 for s in range(40)
           if M.measure_link(*planted(seed=200 + s, strength=0.0), sign=-1, window=20,
                             lag=20)["verdict"] == "supported")
check("across 40 zero-strength draws, spurious support stays rare", weak <= 4, f"{weak}/40")

# ── Sampling is non-overlapping, and says so ──────────────────────────────────
print("\n  non-overlapping sampling")
expected = len(range(20, 2600 - 20, 20))
check("observations step by the lag, not by the bar",
      abs(r["observations"] - expected) <= 1, f"{r['observations']} vs {expected}")
check("which is far fewer than the aligned bars", r["observations"] < r["alignedBars"] / 10)
check("and the sampling is described rather than assumed",
      "no two forward windows share a bar" in r["sampling"])
check("a longer lag yields proportionally fewer observations",
      M.measure_link(IN, TGT, sign=-1, window=20, lag=40)["observations"] < r["observations"] * 0.6)
check("bucket size is reported so the reader knows how thin the tails are",
      r["bucketSize"] >= M.MIN_PER_BUCKET)

# ── Refusals ──────────────────────────────────────────────────────────────────
print("\n  what it refuses to measure")
short = M.measure_link(IN[:50], TGT[:50], sign=-1, window=20, lag=20)
check("too little history is insufficient, not a weak finding", short["verdict"] == "insufficient")
check("and the reason states how many bars would be needed",
      "needs at least" in short["reason"], short["reason"])
check("a sign of 0 is refused - direction is never inferred",
      M.measure_link(IN, TGT, sign=0, window=20, lag=20)["verdict"] == "insufficient")
check("and the refusal says so", "never inferred" in M.measure_link(IN, TGT, sign=0, window=20, lag=20)["reason"])
check("a zero lag is refused", M.measure_link(IN, TGT, sign=-1, window=20, lag=0)["ok"] is False)
check("a one-bar window is refused", M.measure_link(IN, TGT, sign=-1, window=1, lag=5)["ok"] is False)
flat = list(zip(dates(2600), [100.0] * 2600))
check("a constant target has no variance to test and is refused, not reported as riskless",
      M.measure_link(IN, flat, sign=-1, window=20, lag=20)["verdict"] == "insufficient")

print("\n  alignment")
check("dates present in only one series are dropped",
      M.measure_link(IN, TGT[:1300], sign=-1, window=20, lag=20)["alignedBars"] == 1300)
offset = [(d, v) for d, v in TGT[100:]]
check("a shifted series still aligns on common dates only",
      M.measure_link(IN, offset, sign=-1, window=20, lag=20)["alignedBars"] == len(TGT) - 100)
check("non-positive prices are dropped rather than producing a negative return",
      M.measure_link([(d, 0.0) for d, _ in IN[:500]] + IN[500:], TGT,
                     sign=-1, window=20, lag=20)["alignedBars"] == 2100)
check("no overlap at all is insufficient",
      M.measure_link(IN[:1000], TGT[1500:], sign=-1, window=20, lag=20)["verdict"] == "insufficient")

# ── The map ───────────────────────────────────────────────────────────────────
print("\n  the exposure map is master's chain, written out")
ids = [e["id"] for e in M.EXPOSURES]
check("master's own crude-to-autos example is the first link", "crude_auto" in ids)
check("every link states the chain in words", all(len(e["chain"]) > 50 for e in M.EXPOSURES))
check("every link declares a sign of +1 or -1", all(e["sign"] in (1, -1) for e in M.EXPOSURES))
check("every link declares a window and a lag",
      all(e["window"] >= 2 and e["lag"] >= 1 for e in M.EXPOSURES))
check("both directions of master's chain are represented - consumers and producers",
      {M.CONSUMER, M.PRODUCER}.issubset({e["role"] for e in M.EXPOSURES}))
check("a consumer link is negative and a producer link positive",
      all(e["sign"] == -1 for e in M.EXPOSURES if e["role"] == M.CONSUMER)
      and all(e["sign"] == 1 for e in M.EXPOSURES if e["role"] == M.PRODUCER))
check("FMCG is given a longer lag than autos, because repricing is slower",
      [e for e in M.EXPOSURES if e["id"] == "crude_fmcg"][0]["lag"]
      > [e for e in M.EXPOSURES if e["id"] == "crude_auto"][0]["lag"])
check("the whole-economy crude link uses a longer window, because the mechanism is a deficit",
      [e for e in M.EXPOSURES if e["id"] == "crude_index"][0]["window"] >= 60)
check("crude against Nifty Energy is marked AMBIGUOUS rather than asserted",
      [e for e in M.EXPOSURES if e["id"] == "crude_energy"][0].get("ambiguous") is not None)
check("and the ambiguity names the reason: the index mixes producers with refiners",
      "refiners" in [e for e in M.EXPOSURES if e["id"] == "crude_energy"][0]["ambiguous"])
check("inputs with no free series are listed rather than silently proxied",
      len(M.NO_FREE_SERIES) >= 4)
check("palm oil is named as a real FMCG input with no series",
      "palm_oil" in M.NO_FREE_SERIES)

# ── Controls ──────────────────────────────────────────────────────────────────
print("\n  controls test the method, not the market")
controls = [e for e in M.EXPOSURES if e["role"] == M.CONTROL]
check("there is at least one positive and one negative control",
      {"supported", "not-supported"} == {e["expect"] for e in controls})
pos = [e for e in controls if e["expect"] == "supported"][0]
neg = [e for e in controls if e["expect"] == "not-supported"][0]
check("the positive control is VIX against the index", pos["input"] == "india_vix")
check("and says that failing it invalidates the harness", "harness is broken" in pos["chain"])
check("the negative control has no plausible mechanism", neg["input"] == "gold")
check("and says that passing it makes every other finding suspect", "suspect" in neg["chain"])


def loader_from(mapping):
    return lambda key: mapping.get(key)


print("\n  measure_all reports the multiple-comparison cost")
ma = M.measure_all(loader_from({"crude_brent": IN, "NIFTY_AUTO": TGT}), only=["crude_auto"])
check("it measures the link it was given", ma["linksTested"] == 1)
check("and reports it as supported", ma["supported"] == 1, ma["rows"][0]["measurement"]["verdict"])
check("a supported link is the ONLY thing labelled measured evidence",
      ma["rows"][0]["evidence"] == "measured")
unsup = M.measure_all(loader_from({"crude_brent": noise_a, "NIFTY_AUTO": noise_b}), only=["crude_auto"])
check("an unsupported link stays an assertion, never measured evidence",
      unsup["rows"][0]["evidence"] == "asserted")
check("the number of links tested is stated", "links tested" in ma["multipleComparisons"])
check("and the expected false-positive count is worked out for master",
      "by chance alone" in ma["multipleComparisons"])
check("it credits the pre-registration for halving that rate",
      "pre-registered" in ma["multipleComparisons"])
check("a missing series is reported, not skipped silently",
      len(M.measure_all(loader_from({"crude_brent": IN}), only=["crude_auto"])["missingSeries"]) == 1)
check("and names which side was missing",
      "NIFTY_AUTO" in M.measure_all(loader_from({"crude_brent": IN}),
                                    only=["crude_auto"])["missingSeries"][0]["why"])
check("a supported link is described as an EXPOSURE, not a signal", "not a signal" in ma["note"])

print("\n  a failing control is loud")
# The negative control measuring as supported must invalidate the run, not be noted and ignored.
bad = M.measure_all(loader_from({"gold": IN, "NIFTY_IT": TGT, "india_vix": IN, "NIFTY50": TGT}),
                    only=["control_gold_it", "control_vix_index"])
check("the negative control fed a real relationship is flagged",
      any("CONTROL FAILED" in w for w in bad["controlWarnings"]), bad["controlWarnings"])
check("and the warning says every supported link becomes suspect",
      any("suspect" in w for w in bad["controlWarnings"]))
clean = M.measure_all(loader_from({"gold": noise_a, "NIFTY_IT": noise_b}), only=["control_gold_it"])
check("a passing negative control raises no warning", clean["controlWarnings"] == [],
      clean["controlWarnings"])

# ── News: classification, and the honesty about it ────────────────────────────
print("\n  news says whether the cause will persist - and admits it is unmeasured")
h = M.persistence_hint([
    {"title": "Red Sea shipping blocked after attack on tanker"},
    {"title": "Crude demand forecast revised lower on inventory build"},
    {"title": "OPEC output cut extended while demand forecast trimmed"},
    {"title": "Markets close mixed"},
])
check("a supply disruption is classified as supply", h["classified"][0]["kind"] == "supply")
check("a demand revision is classified as demand", h["classified"][1]["kind"] == "demand")
check("a headline with both is mixed, not forced into one", h["classified"][2]["kind"] == "mixed")
check("an unrelated headline is unclassified rather than guessed",
      h["classified"][3]["kind"] == "unclassified")
check("the words that matched are returned, so the classification is auditable",
      "blocked" in h["classified"][0]["matched"])
check("AND IT IS MARKED UNMEASURED", h["measured"] is False)
check("with the reason: persistence has never been tested against price history",
      "NOT been measured" in h["note"])
check("and the measurable version of the claim is written down",
      "decays more slowly" in h["toMeasure"])
check("empty input does not throw", M.persistence_hint([])["classified"] == [])
check("None does not throw", M.persistence_hint(None)["measured"] is False)
check("a headline with no text is skipped rather than classified as unrelated",
      M.persistence_hint([{"title": ""}])["classified"] == [])

# ── Registry ──────────────────────────────────────────────────────────────────
print("\n  the registry a cold session reads")
reg = M.registry()
check("every series is marked unverified until a sync resolves it",
      all(s["unverified"] is True for s in reg["series"]))
check("so a written-down ticker is never mistaken for a working one",
      all(s["unverified"] is True for s in reg["sectors"]))
check("every series records why it matters, not just what it is",
      all(len(s["why"]) > 30 for s in reg["series"]))
check("the method states that signs are pre-registered",
      "declared before measurement" in reg["method"]["preRegistered"])
check("and that a contradicted link is never flipped", "never flipped" in reg["method"]["preRegistered"])
check("the control policy says a failure invalidates the run",
      "invalidates every other result" in reg["method"]["controls"])
check("master's purpose is recorded with the mechanism",
      "level the field" in reg["purpose"])
check("the index-level limitation is stated first",
      "Index level only" in reg["limits"][0])
check("and that an exposure is not a signal", any("not a signal" in x for x in reg["limits"]))
check("crude is named as India's most consequential imported input",
      "85%" in reg["series"][0]["why"])

print(f"\n  {_pass} passed, {_fail} failed\n")
sys.exit(1 if _fail else 0)
