"""
test_strategy_routes_static.py - do the strategy routes call the service the way the service is written?

`main.py` imports pandas and FastAPI, which are not installed on every machine this is built on, so the routes
cannot always be RUN. They can still be READ: every `strategy_service.<fn>(...)` call in `main.py` is checked
against the real signature (the function exists, every keyword exists, every required argument is supplied),
and every request model's fields are checked against what the route reads from it.

This catches the class of fault Section 151.2 found (a callback of the wrong shape, wired and unreachable):
a route that passes `riskPct=` to a function that takes `risk_pct`. It does not prove the routes work; only a
running backend does, and that is said wherever this is cited.

Run:  python -m tests.test_strategy_routes_static   (from ai_backend/)
"""

from __future__ import annotations

import ast
import inspect
import pathlib
import sys

_HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / "engine"))
import strategy_service as SV  # noqa: E402

_pass = 0
_fail = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global _pass, _fail
    if ok:
        _pass += 1
        print(f"  PASS  {label}")
    else:
        _fail += 1
        print(f"  FAIL  {label}" + (f" - {detail}" if detail else ""))


src = (_HERE.parent / "main.py").read_text(encoding="utf-8")
tree = ast.parse(src)

print("\nstrategy routes - static check against the service signatures\n")

# ── every call into the service ──────────────────────────────────────────────
calls = []
for node in ast.walk(tree):
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and \
       isinstance(node.func.value, ast.Name) and node.func.value.id == "strategy_service":
        calls.append(node)

check("main.py calls the service (the glue is wired)", len(calls) >= 10, f"{len(calls)} calls")
for call in calls:
    name = call.func.attr
    fn = getattr(SV, name, None)
    if fn is None:
        check(f"strategy_service.{name} exists", False)
        continue
    sig = inspect.signature(fn)
    params = sig.parameters
    kw = [k.arg for k in call.keywords if k.arg]
    bad_kw = [k for k in kw if k not in params and not any(p.kind == p.VAR_KEYWORD for p in params.values())]
    n_pos = len(call.args)
    positional = [p for p in params.values() if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
    supplied = set(p.name for p in positional[:n_pos]) | set(kw)
    missing = [p.name for p in params.values()
               if p.default is p.empty and p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY)
               and p.name not in supplied]
    check(f"strategy_service.{name}(...) at line {call.lineno}: keywords exist, nothing required is missing",
          not bad_kw and not missing and n_pos <= len(positional), f"bad={bad_kw} missing={missing}")

# ── request models vs what the routes read ───────────────────────────────────
models = {}
for node in tree.body:
    if isinstance(node, ast.ClassDef) and node.name.startswith("Strategy") and node.name.endswith("Request"):
        models[node.name] = {t.target.id for t in node.body if isinstance(t, ast.AnnAssign) and isinstance(t.target, ast.Name)}

routes = {}
for node in tree.body:
    if isinstance(node, ast.FunctionDef):
        for dec in node.decorator_list:
            if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute) and dec.func.attr in ("get", "post") \
               and dec.args and isinstance(dec.args[0], ast.Constant) and str(dec.args[0].value).startswith("/strategy/"):
                routes[dec.args[0].value] = node

expected = ["/strategy/evolve", "/strategy/book/keep", "/strategy/book", "/strategy/book/refresh",
            "/strategy/book/retire", "/strategy/book/restore", "/strategy/book/remove", "/strategy/book/signals"]
for path in expected:
    check(f"route {path} exists", path in routes)

for path, fn in routes.items():
    ann = {a.arg: a.annotation for a in fn.args.args if a.annotation is not None}
    reads = set()
    for node in ast.walk(fn):
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == "req":
            reads.add(node.attr)
    model = None
    for a in fn.args.args:
        if a.arg == "req" and isinstance(a.annotation, ast.Name):
            model = a.annotation.id
    if model and model in models:
        unknown = sorted(r for r in reads - models[model] if not r.startswith("model_"))     # pydantic's own methods
        check(f"{path}: every `req.<field>` it reads is a field of {model}", not unknown, str(unknown))

# ── no order language, no timer ──────────────────────────────────────────────
blob = src[src.index("# ── The strategy book"):src.index("class StrategyCodeRequest")].lower()
check("the strategy-book routes never mention placing an order", not any(w in blob for w in ("place_order", "placeorder", "broker", "buy(", "sell(")))
check("and start no timer or scheduler: every call is master's act",
      not any(w in blob for w in ("schedule", "threading.timer", "asyncio.sleep", "apscheduler", "setinterval", "background")))

print(f"\n  {_pass} passed, {_fail} failed")
sys.exit(1 if _fail else 0)
