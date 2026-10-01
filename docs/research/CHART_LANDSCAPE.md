# CHART_LANDSCAPE — the StockMind charting landscape, gap analysis, alignment pass and first implementation tranche

Written: **2026-10-01**. Worktree `chart-landscape`, branch `chart/landscape-and-gaps`, base commit `8c1c9ee`.
Author context: master's instruction was *"Do the extensive analysis for each and every feature in the charts, draw research from all the famous/popular trading apps and their implementation. note it down; compare our implementation and understand the gap and also align the implementation to our need/requirement in stockmind actual behavior."*

**How to read this document.**

| Phase | What it is | What it is NOT |
| --- | --- | --- |
| Phase 1 | The merged landscape from three upstream research clusters — 23 platform surfaces, every citation carried forward, every cluster's own attribution and verification caveats preserved. | Not a feature wishlist. A `Y` here means a vendor documents it, nothing more. |
| Phase 2 | A **counted** inventory of what Rāma's chart actually has, read off the code in this commit, with the half-features named by which half exists. | Not a summary of the ledger. Where the ledger and the code disagree the code wins and the disagreement is recorded. |
| Phase 3 | The gap matrix. One row per feature, with how many researched platforms carry it, whether we carry it, **whether it is relevant to StockMind at all**, engine dependency, effort and priority. | Not a backlog ordered by what other platforms have. |
| Phase 4 | The alignment pass. What is **ruled out with a written reason**, and what StockMind **uniquely requires** that almost no commercial platform ships. Then a phased roadmap where every item names a verification method. | Not aspirational. Each design states where its data comes from and how the claim gate classes it. |
| NOT VERIFIED | Everything that could not be checked in this environment, stated before the ready-to-paste blocks rather than after. | — |
| SECTION 123 / row 143 | Ready-to-paste spec section and ledger row, in the established format. | — |
| Phase 5 plan | The bounded, **renderer-only** implementation plan for this tranche. No Python change, because the engine cannot be exercised here and an unverifiable change must not be attempted. | — |

**The governing rule, restated because every design below is measured against it** (project Sections 101 and 103): the renderer may draw any **pure function of the visible bars**; anything forward-looking, model-derived or advisory must come from the engine and be **labelled as such**. `electron/lib/claimGate.cjs` classifies every assertion as `grounded` / `reflex` / `prose` / `unattributed` and **refuses to emit the unattributed class**. A chart feature that draws a model's opinion with the same visual weight as arithmetic is a **defect, not a feature**.

**The alignment anchor.** StockMind is not a brokerage terminal. Master, verbatim: *"Corporates have their algos and setup but our setup is to level the field for retail traders."* Broker integration: *"Not yet."* The strategy goal is combos near and above 80% success with minimum risk for maximum profit **including trading charges for the number of trades suggested and actually taken** — and the 80% **filter** was refused with arithmetic master accepted: 40 wins of 1% against 10 losses of 5% is an 80% win rate with −0.20% expectancy. **Win rate is always reported, never filtered.** Market: Indian equities primarily (NSE/BSE, IST 09:15–15:30, one 375-minute session) plus US. Data: free providers, capped per interval, on-disk history that only grows.

---

# PHASE 1 — THE MERGED LANDSCAPE

Three upstream cluster files are folded in here. They remain the authoritative detail; this phase merges them, keeps every citation, and — importantly — **keeps each cluster's own statement of how much it could verify**, because the three differ enormously on that point and merging them without that distinction would launder an unverified recollection into a fact.

Source files, all in this directory:
- [`landscape-cluster-A.md`](./landscape-cluster-A.md) — charting leaders and professional desktops, 468 lines, 44 axes × 8 platforms.
- [`landscape-cluster-B.md`](./landscape-cluster-B.md) — Indian retail brokers and the Indian analytics layer, 626 lines, 55 axes × 10 platforms. **The most relevant cluster**, because it is the market master actually trades.
- [`landscape-cluster-C.md`](./landscape-cluster-C.md) — charting-first web tools, 405 lines, 45 axes × 5 platforms.

## 1.1 Verification status per cluster — read before using any row

| Cluster | Retrieval | Consequence for this document |
| --- | --- | --- |
| **A** (TradingView, Thinkorswim, MetaTrader 5, NinjaTrader 8, Sierra Chart, IBKR TWS, Bloomberg, Koyfin) | Every non-`?` row was read off a **live official vendor page** over HTTPS during the research session. ~255 inline links, vendor help centres and user guides only — no blogs, forums or review sites. | **Usable as evidence.** Counts are either vendor-stated (attributed) or derived by counting documented entries (derivation stated so it can be re-checked). |
| **B** (Zerodha Kite on both engines, Upstox, Groww, Dhan, FYERS, Angel One, ICICI Direct, Trendlyne, Sensibull) | Live HTTPS retrieval of official vendor pages, vendor sitemaps and vendor `llms.txt` indexes. Discovery was done by **crawling sitemaps and `robots.txt` directly**, because DuckDuckGo, Bing and Mojeek all returned consent/anomaly pages from that environment. | **Usable as evidence, with one flag that must travel with every row:** several Indian broker rows rest on *marketing* pages rather than support documentation and are marked `Y (claim)` in the source. A claim is recorded as the vendor's claim and never promoted to verified behaviour. |
| **C** (StockCharts, Barchart, Investing.com, TrendSpider, Finviz) | **FAILED. Outbound network access was blocked in that workspace** — DNS resolved but every HTTPS request died at the TLS handshake (`SEC_E_ILLEGAL_MESSAGE`), and plain HTTP failed too. | **NOT evidence.** Every Cluster C row is prior product knowledge with an explicit per-row confidence (`high` / `med` / `low` / `unconfirmed`) and links pointing at the *canonical home of the claim* rather than a URL that was checked. Cluster C is used below for **design ideas and for counting**, never as proof, and its open verification queue is carried into the NOT VERIFIED section of this document. |
| **Bloomberg Terminal** | **Failed outright.** Every request to `bloomberg.com/professional/*` returned HTTP 403; real terminal documentation (`HELP HELP`, `BU <GO>`) is subscriber-gated. | **All 44 axes unconfirmed.** Bloomberg is treated as *out of evidence*, not as a zero, and is excluded from every presence count in Phase 3. |
| Published dates | **Only IBKR prints one** — "Last updated on October 8, 2025" on its chart topics. TradingView, Thinkorswim, MetaQuotes, NinjaTrader, Sierra Chart, Koyfin, ChartIQ and **every Indian broker** print a copyright year only. | The strongest available claim for all of those is "current as of the 2026-10-01 retrieval". No date is guessed anywhere. |
| Licensing | No source is quoted beyond unavoidable short UI labels and setting names. Everything is a summary. | **Content was rephrased for compliance with licensing restrictions.** |

Legend used throughout Phase 1: `Y` present (read in official documentation, except Cluster C — see above), `Y (claim)` asserted on a vendor product/marketing page only, `N` the vendor publishes an enumerated list for that axis and the feature is not in it, `N (no doc)` the vendor's own searchable corpus contains nothing on the axis, `P` partial/restricted/plan-gated, `?` unconfirmed — **not asserted either way**.

## 1.2 The 23 platform surfaces, and the one architectural fact that drives most of each one's rows

| # | Surface | Cluster | The fact that explains its feature set | Canonical source |
| --- | --- | --- | --- | --- |
| 1 | **TradingView** (Supercharts, web + desktop) | A | **The layout is the unit of persistence, and it is server-side.** A layout holds charts, settings, drawings and indicators and has its own URL; watchlists and alerts deliberately live *outside* it. One decision explains the sync, persistence and sharing models. | [Layouts, charts, drawings, indicators and their interaction](https://www.tradingview.com/support/solutions/43000692404-layouts-charts-drawings-indicators-and-their-interaction/) |
| 2 | **Thinkorswim** (Schwab) | A | **Drawings live in named per-symbol "drawing sets", not per chart.** A chart subscribes to a set, so the same markup appears on every chart of that symbol. | [Using Drawings](https://toslc.thinkorswim.com/center/howToTos/thinkManual/charts/Using-Drawings) |
| 3 | **MetaTrader 5** | A | **Almost everything beyond the base chart is delegated to MQL5.** 3 chart types, 21 timeframes, 38 indicators, 46 analytical objects — and a Market/Code Base expected to supply the rest. | [Price Charts, Technical and Fundamental Analysis](https://www.metatrader5.com/en/terminal/help/charts_analysis) |
| 4 | **NinjaTrader 8** | A | **The bar type is a first-class parameterised object**, and the help guide treats non-time bars as a *correctness* concern: it warns that bar construction changes backtest fidelity. | [Bar Types](https://ninjatrader.com/support/helpGuides/nt8/bar_types.htm) |
| 5 | **Sierra Chart** | A | **Nearly every behaviour is an exposed setting** — snapping sensitivity as a percentage, drawing-to-bar mapping as nearest-vs-containing, selection margin in pixels, replay calculation mode. | [Chart Drawing Tools](https://www.sierrachart.com/index.php?page=doc/Tools.html) |
| 6 | **IBKR TWS** | A | **The chart is configured by a parameters dialog, not by direct manipulation**; chart state is broker-account state, not a shareable document. | [Chart Parameters](https://www.ibkrguides.com/traderworkstation/chart-parameters.htm) |
| 7 | **Bloomberg Terminal** | A | Not asserted — retrieval blocked (HTTP 403). | — |
| 8 | **Koyfin** | A | **The time axis bottoms out at daily and the series is the unit of composition.** Price, P/E, fund flows, a moving average: all just series. Annotations key to a template+ticker pair. | [Historical Graph (G)](https://www.koyfin.com/help/charts-and-graphs/) |
| 9 | **Zerodha Kite — ChartIQ** | B | Default engine. Cloud-synced **"Views"** (timeframe + chart type + indicators), per-indicator Y-axis control, 20-level depth that is **not wired to the chart**. | [Save views on ChartIQ](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/how-to-save-my-chart-settings-and-indicators-on-kite-charts) |
| 10 | **Zerodha Kite — TradingView** | B | Opt-in second engine. **Parity with ChartIQ is not maintained**, so almost every Kite answer is "it depends which engine". Zerodha also states Kite cannot be connected to third-party charting applications at all. | [How to switch between charts on Kite?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/how-do-i-switch-to-tradingview-charts), [third-party charting libraries](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/third-party-charting-libraries) |
| 11 | **Upstox** | B | Sells the chart **by trader persona** (scalper / momentum / options / long-term), each bundling different features. Headline is **seconds resolution: 1s, 5s, 10s, 15s, 30s**. **Chart 360** puts CE/PE and the index on one screen. | [Upstox × TradingView](https://upstox.com/tradingview-chart/), [Chart 360](https://upstox.com/trade-on-charts/) |
| 12 | **Groww** | B | **Mobile-first and deliberately minimal**: ~9 named indicators, and the published selling point is latency — **0.6 s chart load, 0.2 s tick latency, 58.5 M orders placed on charts**. | [Groww Charts](https://groww.in/groww-charts) |
| 13 | **Dhan** | B | Treats the TradingView surface as a **trading terminal**, not an analysis window: right-click → option chain, basket orders from the chart, 20+ layouts; DEXT T3 adds a ladder mode and widget linking. | [Dhan + TradingView](https://dhan.co/tradingview/), [DEXT T3](https://dhan.co/dext-t3-trading-terminal/) |
| 14 | **FYERS** | B | The only Indian broker documenting an **order-flow chart**, a **price ladder**, **5-second bars**, **50-level depth**, **one-click alerts from the chart** — and **FIA**, an AI assistant whose actions are *chart mutations*. | [Advanced Charts](https://fyers.in/advanced-charts), [Real-time alerts](https://fyers.in/alerts), [llms.txt](https://fyers.in/llms.txt) |
| 15 | **Angel One** | B | Its richest chart story is **explicitly someone else's product**: the tradingview.com route (400+ indicators, 110+ drawing tools, 13 alert conditions, DOM) reached by linking the account. | [Angel One on TradingView](https://www.angelone.in/tradingview) |
| 16 | **ICICI Direct** | B | Names "Advanced Charts" in disclaimer text and **publishes no charting documentation at all**; `?` on ~40 of 55 axes. Only confirmed analytical capability is **Spring** (backtest + paper trading). | [Spring](https://www.icicidirect.com/futures-and-options/spring) |
| 17 | **Trendlyne** | B | Analytics layer. **Tab-per-dataset** on a stock page — the richest *event dataset* in the cluster and the weakest *chart integration* of it. The datasets are tabs, not overlays. | [Trendlyne alerts](https://trendlyne.com/alerts/) |
| 18 | **Sensibull** | B | Options analytics. Published tool list contains **no general price chart**; its charts are derived-series charts. States it **never places, modifies or cancels orders automatically**. | [Sensibull](https://sensibull.com/) |
| 19 | **StockCharts** | C | Two generations side by side: **SharpCharts** renders server-side as **images**; **ACP** is browser-side interactive. Deepest classic-TA heritage, especially Point & Figure. | [ChartSchool](https://chartschool.stockcharts.com/) |
| 20 | **Barchart** | C | A market-data house with a retail front end; **futures-native constructs are first-class** (continuation contracts, spreads, seasonality). | [Barchart](https://www.barchart.com/) |
| 21 | **Investing.com** | C | The advanced chart is **a licensed third-party library deployment**, so capability equals the licence minus what the host did not enable. Portal features (calendar, news, alerts) are its own. | [Investing.com](https://www.investing.com/) |
| 22 | **TrendSpider** | C | **Automation-first**: it sells *doing* the analysis. Automated trendline/Fibonacci detection, multi-timeframe indicators on one chart, **alerts bound to chart objects**, Raindrop charts, on-chart strategy tester. | [TrendSpider](https://trendspider.com/) |
| 23 | **Finviz** | C | Screener-first. Charts are an **output format of the screener**: static server-rendered images in bulk grids, with **pattern trendlines drawn by the server**. | [Finviz screener](https://finviz.com/screener.ashx) |

**Content was rephrased for compliance with licensing restrictions.**

## 1.3 The six structural facts that matter more than any feature row

These are the findings that change what StockMind should build, as opposed to what it could build.

### (1) Six of seven Indian brokers do not write their own chart engine, and the **library edition caps the feature set before the broker writes a line of code**

TradingView ships two editions, and the split is published:

| Edition | Includes | **Excludes** |
| --- | --- | --- |
| **Advanced Charts** (free) | Chart, drawings, indicators, marks, snapshots, chart layouts, indicator templates, extended sessions, inactivity gaps, price-scale modes | **Renko, Point & Figure, Line Break and Kagi are absent.** Multi-chart layout, crosshair/symbol/interval/time sync, Depth of Market, watchlist, news widget, order entry, order/position overlay, P&L display, **drawing templates**, chart colour templates, seconds-from-ticks — all **Trading Platform only** |
| **Trading Platform** (access-restricted) | Everything above plus up to 8 synchronised charts, chart trading, DOM, Account Manager, advanced order ticket, bid/ask lines, the four price-based chart types, drawing templates, seconds bars | — |

Source: [Trading Platform overview](https://www.tradingview.com/charting-library-docs/latest/trading_terminal/), [Saving and loading](https://www.tradingview.com/charting-library-docs/latest/saving_loading/), [Product comparison](https://www.tradingview.com/charting-library-docs/latest/product-comparison). **No broker states which edition it licensed**, so wherever a broker claims a Trading-Platform-only feature the claim is recorded as the broker's and the edition is never inferred.

**Why this matters to us.** A gap analysis that counts "Kite has no Kagi" as a *choice* misattributes a licence ceiling. It also means a long tail of axes that look like industry standards are actually one vendor's premium tier — and StockMind, built directly on `lightweight-charts` 5.2.1 with its plugin surface available, has **no such ceiling**. The extension point is ours.

Zerodha states the sharpest version of this divergence anywhere in the research: Kite uses a **built-in indicator library, not the public tradingview.com library**, so community and Pine indicators from tradingview.com are unavailable inside Kite — [Why are some TradingView indicators unavailable on Kite?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/features-available-on-trading-view-not-available-in-the-trading-view-library-at-zerodha)

### (2) The industry reference implementation **deliberately does not persist the visible range**

> A saved chart layout does **not** include the visible time range; the library always re-opens showing the most recent data. — [Saving and loading charts](https://www.tradingview.com/charting-library-docs/latest/saving_loading/)

Instead it exposes an explicit imperative API — `setVisibleRange({ from })` with an `applyDefaultRightMargin` option — to be called **after data load** — [Chart](https://www.tradingview.com/charting-library-docs/latest/ui_elements/Chart).

**This is the documented vendor explanation for the class of defect master reported three times as "default zoom not working".** The correct fix is an explicit initial-range policy applied after data load, not a persistence change — which is exactly what `chartZoom.js` now does, with a measured read-back. Thinkorswim offers the opposite option as an opt-in named **"Keep time zoom"**, which preserves time-axis scaling across detaching the window, changing symbol, adding or removing studies and changing timeframe; without it, default scaling is reapplied — [Time Axis Settings](https://toslc.thinkorswim.com/center/howToTos/thinkManual/charts/Chart-Style-Settings/timeaxis). Koyfin specifies zoom semantics differently again and the specification itself is the transferable idea: **scrolling to zoom holds the end date fixed and moves the start date**, because a research chart is anchored to "now", so zoom means *how much history*, not *which window* — [Historical Graph (G)](https://www.koyfin.com/help/charts-and-graphs/).

### (3) Persistence durability is the most inconsistently handled axis in the industry, and Kite is the cautionary tale

Zerodha publishes, in its own support articles, **the four ways a user's drawings get destroyed** on Kite web: clearing browser/app cache; switching browser, PC or mobile; exceeding the saved-layout cap (stated as usually up to 10), where the **oldest layout is evicted**; and logging into Kite with a different user ID in the same browser — [Why are the drawings getting deleted?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/drawings-getting-deleted-from-the-tradingview-chart). Meanwhile the **app** saves to **cloud**, and saved drawings become the **default layout for that specific instrument** — [How to save TradingView chart drawings on Kite app?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/how-do-i-save-tradingview-chart-drawings-on-kite-3-mobile) — with a documented quota error, *"Chart preference limit reached"*, and a **Manage layouts and drawings** dialog to clear it — [Chart preference limit reached](https://support.zerodha.com/category/trading-and-markets/alerts-and-nudges/kite-error-messages/articles/chart-preference-limit-reaches).

**Same broker, same engine, opposite durability guarantees.** The three best-specified alternative models are worth naming because they are the design space:

| Model | Who | Keyed by |
| --- | --- | --- |
| Named per-symbol **drawing sets** a chart subscribes to; edits propagate instantly to every chart on that symbol; a Default set that can be neither renamed nor deleted; **age-based cleanup** with a day threshold because too many drawings slow the application | Thinkorswim | symbol |
| Annotations saved automatically **per template-and-ticker pair** — annotate a symbol in one template, open a different template on the same symbol, and the annotation is not there | Koyfin | view + symbol |
| **Share trend line among charts**, reflecting one chart's trendline onto other open charts of the same instrument, with an optional narrowing: *share when bar size is the same* | IBKR TWS | instrument (+ optionally interval) |

Sources: [Using Drawings](https://toslc.thinkorswim.com/center/howToTos/thinkManual/charts/Using-Drawings), [Historical Graph (G)](https://www.koyfin.com/help/charts-and-graphs/), [Chart Settings](https://www.ibkrguides.com/traderworkstation/chart-settings.htm).

**Our model is already the Thinkorswim one** — per symbol, portable across every interval, because anchors are absolute epoch seconds. That decision is validated by this research rather than challenged by it.

### (4) FYERS has already shipped an AI assistant whose actions are chart mutations — and has had to publish whether it clobbers the saved layout

FYERS' `llms-full.txt` index contains KB topics titled for *"How do I get FIA to mark support and resistance on my chart"*, *"How do I ask FIA to mark RSI and MACD on my chart"*, *"How does FIA analyse my current chart and timeframe"* and — the one that matters — *"Does FIA change my saved chart layout"* — [llms.txt index](https://fyers.in/llms.txt).

**This is the closest existing precedent anywhere in the research to Rāma driving StockMind's chart.** The contract it forces is the one we must decide *before* building the feature, not after: does the assistant write into master's saved layout, into a scratch overlay, or into a **proposal master accepts**? Our answer is already partly decided and should be made explicit: `chartDrawings.js` states that a drawing is **master's own claim, never generated, never adjusted, never snapped to a "better" level on his behalf**, and Rāma's marks are drawn by other code in other colours. Formalising that as a rule — *Rāma draws into its own labelled layer, never into master's store* — closes the question FYERS had to answer retroactively.

TrendSpider, Barchart and Finviz all point the same direction from the other end: **automated analysis changes the primary control from a tool to a sensitivity setting.** TrendSpider's flagship is algorithmic pivot-finding where the user tunes a *sensitivity slider* rather than drawing; Finviz draws the machine's detected pattern lines onto hundreds of server-rendered chart images at a glance; Barchart aggregates many indicator signals into one directional percentage ("Barchart Opinion"). If Rāma is doing the analysis, the chart UI should expose **"how aggressive"** and **"show me why"**, not a bigger drawing toolbar. (Cluster C confidence: `high` for the design pattern, `unconfirmed` for any specific control.)

### (5) Alerting in India is quote-threshold, not condition-based — and the market leader explicitly cannot do better

Zerodha enumerates exactly what a Kite alert can test: OHLC; percentage (day change, intraday change); price (LTP, ATP); quantity (total buy/sell quantity); **Open Interest day high/low**; volume traded; last traded quantity. Operators `>`, `>=`, `<`, `<=`, `=`. Alerts are server-side, delivered in-app plus email, and free — [What are Kite alerts and how to use them?](https://support.zerodha.com/category/trading-and-markets/alerts-and-nudges/kite-alerts/articles/what-are-kite-alerts-and-how-do-i-use-them). Three further statements bound it: *"You can only set price alerts on Kite"* — indicator alerts require Streak — [technical-indicator alerts](https://support.zerodha.com/category/trading-and-markets/alerts-and-nudges/kite-alerts/articles/set-a-technical-indicator-based-alert-using-sentinel); the **advanced alerts** feature from the retired Sentinel product was **not carried over** — [Why can't I find the advanced alerts feature on Kite?](https://support.zerodha.com/category/trading-and-markets/general-kite/others-kite/articles/not-able-to-view-the-advanced-alerts-option); and an alert can be upgraded into **ATO (Alert Triggers Orders)**, firing a pre-built basket of **up to 20 instruments** as market orders with market-price protection — [What is ATO?](https://support.zerodha.com/category/trading-and-markets/alerts-and-nudges/kite-alerts/articles/what-is-alert-triggers-order-ato).

Against that, the three best alert models in the whole research are:

| Model | Who | The idea worth copying |
| --- | --- | --- |
| **The alert references the drawing's identity, not a frozen price** — bind an alert to a drawn or auto-detected trendline and the trigger level moves with the line | TrendSpider (`high` confidence, unverified) | This is a **schema decision**. Designing it after shipping static price alerts is a migration. |
| **Drawing alerts as a property of the drawing**, with eligibility tightly specified and the exclusions published | Thinkorswim, Sierra Chart | TOS lists exactly which drawings qualify (straight-line ones on the price subgraph), that **each line of a multi-line drawing needs its own alert**, and that the feature is disabled under tick/range aggregation, Heikin-Ashi, Equivolume, Monkey Bars, Seasonality, OnDemand, **log scale**, contract-change adjustment, thinkBack, or when a key point falls outside the visible period — [Drawing Alerts](https://toslc.thinkorswim.com/center/howToTos/thinkManual/charts/Useful-Tools/Drawing-Alerts). Sierra Chart documents a failure mode nobody else admits: alerts reading true or false incorrectly **because of comparison precision** — [Chart Drawing Tools](https://www.sierrachart.com/index.php?page=doc/Tools.html). |
| **Portfolio- and watchlist-scoped alerting**, plus fundamental-metric and research-report alerts | Trendlyne | The user never re-enumerates symbols — [Trendlyne alerts](https://trendlyne.com/alerts/) |

**Content was rephrased for compliance with licensing restrictions.**

### (6) Nobody in Indian retail does market profile or TPO, almost nobody does volume profile, only FYERS documents order flow — and Upstox has invented the **India-specific substitute**

Upstox plots **OI Profile** and **OI Build-up** on the chart, and sells Depth 30 plus a Depth Rank and a Slippage figure — [Upstox × TradingView](https://upstox.com/tradingview-chart/). FYERS publishes KB topics for reading an order-flow chart and for how buy and sell quantities are classified in it, plus 50-market depth and a price ladder — [Advanced Charts](https://fyers.in/advanced-charts). Kite has 20-level depth (Level 3) for NSE stocks but reaches it from the marketwatch or order window, **not from the chart**, even though ChartIQ's SDK exposes both `CIQ.MarketDepth` and `CIQ.Drawing.volumeprofile` — so that is an **exposure decision, not a library limit** — [20 market depth](https://support.zerodha.com/category/trading-and-markets/general-kite/kite-mw/articles/view-20-depth), [ChartIQ SDK index](https://documentation.chartiq.com/).

**For NSE/BSE F&O, open-interest structure is the locally meaningful analogue of US-style order-flow analytics.** If StockMind ever wants microstructure depth, **OI-on-chart is the higher-value and more defensible direction than importing TPO** — and we already have `derivatives.py` computing max pain, OI concentration (Herfindahl), option chains, FII/DII flows, participant-wise OI and delivery data from NSE bhavcopy. That is a Phase 4 "later" item with real foundations, not a wish.

## 1.4 Merged presence matrix — the counts

Denominator is **22 surfaces**, not 23: Bloomberg Terminal is excluded from every count because all 44 of its axes are out of evidence. Cluster C cells are counted but flagged, because they are recollection. `?` is **never** counted as absent.

| Axis | A (of 7) | B (of 10) | C (of 5) | **Total Y-or-P of 22** | The sharpest single implementation detail found |
| --- | --- | --- | --- | --- | --- |
| Candle / bar / line / area | 7 | 9 | 5 | **21** | Koyfin picks the chart type **per series**, not per chart |
| Heikin-Ashi | 4 | 2 | 4 | **10** | NinjaTrader **rounds the computed HA value to the instrument's tick size** specifically so order submission and backtest execution stay accurate |
| Renko | 4 | 1 | 3 | **8** | Sierra Chart ships **three Renko families** (`rk`, Flex `fr`, Aligned `ar`) plus a Flex-inverse variant. Zerodha publishes the correctness caveat nobody else does: bricks **inside the currently selected period are recalculated as ticks arrive and can retrace**; only completed periods are permanent |
| Kagi | 2 | 0 | 2 | **4** | NT8 documents the rule most implementations get wrong: on reversal the line changes direction but **keeps its colour** until the previous Kagi bar's extreme is taken out |
| Point & Figure | 3 | 0 | 3 | **6** | StockCharts draws **45-degree bullish/bearish trendlines automatically** and publishes vertical/horizontal price objectives |
| Line break | 1 | 0 | 2 | **3** | TradingView: the four price-based types work on intraday intervals but **not on tick-based ones** |
| Range bars | 4 | 0 | 1 | **5** | Sierra Chart documents **six range variants** including true-range, fill-gaps and open=close. NT8 disambiguates the two senses of "tick" (a trade vs one minimum price increment) and names the **Ruler** as the verification method |
| Volume / tick / trade-count bars | 4 | 0 | 0 | **4** | Sierra Chart adds **delta-volume per bar** and **price-changes per bar** |
| Seconds resolution | 0 | 2 | 0 | **2** | Upstox 1s/5s/10s/15s/30s; FYERS 5s. Both Indian, both sold to scalpers |
| Proprietary / semantic bar type | 0 | 0 | 2 | **2** | StockCharts **Elder Impulse** colours each bar from an EMA-slope + MACD-histogram agreement rule; TrendSpider **Raindrop** draws each period as two volume-weighted price distributions. Both encode *state* into bar shape rather than inventing a new geometry |
| Drawing-tool inventory published or countable | 4 | 0 | 0 | **4** | TradingView 110+ claimed / **72 individually documented**; Thinkorswim **22 in 4 families**; MT5 **46** — with a documentation defect worth recording, since its own parent page says **44**; Sierra Chart ~40 enumerated |
| Magnet / snap-to-OHLC | 3 | 0 | 1 | **4** | Three different designs: TradingView makes it a **modifier key** (hold to toggle either way, and it applies while editing); MT5 makes it a **distance tolerance**; Sierra Chart exposes **AutoSnap sensitivity as a percentage**, an include-open/close switch, separate on-creation and on-adjustment switches, and nearest-vs-containing bar mapping |
| Drawing templates | 3 Y + 3 P | 0 | 1 Y + 2 P | **9** | TradingView applies a template to **several tools of the same type at once**. Sierra Chart implements templates as **numbered tool configurations** with a Control Bar button that selects tool *and* configuration in one action |
| Drawing clone | 5 | 0 | 1 | **6** | MT5 clone is a gesture (Ctrl + drag by the central marker); group move is Alt + drag; **deletion is undoable** |
| **Indicator parameters user-editable** | **7** | **7** | **4 Y + 1 P** | **19** | **The most universal feature in the entire research.** StockCharts does it even on a server-rendered image, because parameters are *form state*, not client state. Finviz is the only dissenter and offers **presets over parameters** |
| Indicator templates / presets | 4 | 3 | 3 | **10** | Kite's ChartIQ **"Views"** are cloud-synced by design. Koyfin's graph template captures the date range, frequency, log/linear **and the adjusted-prices basis**, and may be given a command-bar shortcut |
| Multi-pane + pane management | 6 | 5 | 4 | **15** | Kite surfaces a **Maximise pane** control that appears only once more than one indicator is on the chart. NinjaTrader makes the **panel splitter itself a styleable line** |
| Second-symbol comparison | 5 | 4 | 4 | **13** | **IBKR automatically turns on dividend adjustment when a comparison ticker is added**, because an unadjusted comparison would mislead. Koyfin's **Group Axis** merges only series that share units |
| Comparison drawn in **%** | 2 | 2 | 2 | **6** | Zerodha states it outright: percentage from the starting price to the current price — a *relative-performance* overlay. And publishes two costs: **live ticks stop while comparison is active**, and comparison is **web-only** |
| Spread / ratio charts | 1 Y + 2 P | 0 Y + 1 P | 2 | **6** | TradingView accepts four operators in symbol search and discloses that **intraday spreads are recompiled from 1-minute OHLC**, which is why intraday and daily spread values differ. Thinkorswim's composite symbols allow **addition and subtraction between components only** — so a *ratio of two symbols is not expressible*. StockCharts' ratio symbols make a ratio chartable, indicator-able and alert-able with **no special-casing** |
| Bar replay / playback | 4 | 1 Y (claim) | 0 Y + 2 P | **7** | **Replay is a connection, not a chart mode** in NinjaTrader: every window replays synchronously. Sierra Chart is the only one treating replay *fidelity* as a configurable contract — Standard / Calculate-same-as-real-time / **Accurate Trading System Back Test Mode** / calculate-at-every-tick, with market depth recordable and replayable. TradingView can replay every chart in a layout at the same point in time across different symbols and timeframes |
| Alerts created from the chart | 6 | 1 Y (claim) | 1 Y + 3 P | **11** | See §1.3(5) |
| Alert bound to a drawing's identity | 2 | 0 | 1 | **3** | The schema decision. TOS publishes its full eligibility and exclusion list; Sierra Chart publishes a comparison-precision failure mode |
| Session / extended-hours shading | 1 Y + 2 P | 0 | 1 | **4** | TradingView ships an actual **tint over the extended-hours region**, recolourable or removable, and hides the control (but not the setting) when the symbol has no ETH data. NinjaTrader's is **generic, not session-aware**: a list of **Time Highlighters** with start, end, colour and opacity that the *user* constructs. IBKR draws only a **dotted separator between trading days** |
| Holiday / no-trade gap handling | 2 | 0 | 5 | **7** | TradingView **hides periods with no trading activity by default**; whitespace gaps are opt-in via `inactivity_gaps`, which adds an off-by-default user checkbox, and gaps are only drawn **inside** the session. NinjaTrader exposes it as **Equidistant bar spacing** on/off, and **Break at EOD** for whether a non-time bar may close incomplete at a session boundary |
| Volume profile — visible range | 3 | 0 | 0 Y + 2 P | **5** | TradingView's VRVP picks its source timeframe by walking 1, 5, 15, 30, 60, 240, 1D **until the window holds fewer than 5000 bars**; futures and spread charts step one timeframe down; second-based intervals always use 1-second data |
| Volume profile — fixed range / anchored | 2 | 1 (library) | 0 | **3** | TradingView ships it as **both an indicator and a drawing tool**. Sierra Chart's is a drawing tool with an *erase-all-drawn-profiles* command |
| Market profile / TPO | 2 | 0 | 0 | **2** | Thinkorswim's **Monkey Bars** is specified unusually precisely: digits 1–9 then 0 per aggregation period, the next ten repeating in a different colour with a key in the upper-left; the longest row is the **Monkey Bar** with documented tie-breaks (nearest the mid-range, then the lower); the band holding a configured share of activity is **The Playground**; and the volume subgraph is **switched off** in this mode |
| Order-flow footprint | 3 | 1 | 0 | **4** | NT8's **Order Flow Volumetric Bars** render per-level delta as a colour gradient whose granularity is a **Shading sensitivity** property defaulting to **20 levels**, with diagonal imbalance detection against a configurable ratio — and the guide is careful to say this is **a classification of activity, not a signal** |
| Depth-of-market ladder | 4 | 4 | 0 Y + 1 P | **8** | Sierra Chart's DOM has a **dedicated working-orders column** where orders are modified and cancelled by configurable pointer actions. Dhan is the only one with a ladder as a **named workspace mode** |
| Corporate-action adjustment **declared on the chart** | 3 Y + 2 P | 2 | 0 Y + 2 P | **9** | **IBKR states the mechanic**: on the day before the dividend date the dividend amount is subtracted from the close. TradingView states the *intent*: a dividend-adjusted chart shows total return. Koyfin's adjusted/unadjusted toggle is **captured in the saved template** |
| Split / dividend / bonus / rights markers | 2 | 2 | 2 | **6** | Kite's is the most honestly bounded: **from the ex-date onwards**, history only back to **2014**, **not available in multi-chart mode**, the hide-preference **is not saved to the default layout**, and marks **cannot be hidden at all on the app**. Separately, Zerodha publishes that **historical candle values can change after a refresh** — i.e. adjustment lands asynchronously. IBKR colour-codes: **splits magenta, dividends yellow** |
| Earnings markers | 1 | 0 Y + 2 P | 2 | **5** | Thinkorswim's time axis can **auto-expand so upcoming corporate actions fit on screen**, capped at **1000 bars** |
| News on chart | 1 | 1 (claim) | 1 | **3** | TradingView puts it on an **Events tab** beside independent switches for dividends, splits and earnings |
| Economic-calendar markers on chart | 1 | 1 (claim) | 1 Y + 1 P | **4** | TradingView can additionally plot economic series **as data**, not only as markers |
| Auto pattern recognition | 2 Y + 1 P | 1 (claim) | 3 | **7** | TradingView delivers detectors as **ordinary indicators** (Indicators → Technicals → Patterns). Finviz makes pattern detection a **screener filter** and draws the detected trendlines **onto the server-rendered image**, so the user sees the machine's lines on hundreds of charts with zero interaction cost |
| Auto support / resistance | 1 Y + 1 P | 2 | 2 Y + 2 P | **8** | TradingView ships **Auto key levels** and **Auto trendlines** as built-in studies. Kite instead documents **CPR** and standard pivots in depth — a distinctly Indian-retail study, and treating it as first-class is a market-expectation signal |
| Multi-chart layouts, saved | 6 | 5 | 4 | **15** | TradingView: **1 to 16 charts per layout, capped by tier**; a layout is a server-side document with its own URL, and the delete dialog **enumerates what will be lost**. Thinkorswim's Charts Grid forces **every row to have the same cell count**; Flexible Grid does not |
| Cross-chart sync (crosshair / interval / time) | 2 | 2 (claim) | 1 | **5** | TradingView syncs **five independent properties** and allows **partial sync via emoji groups**. Sierra Chart links by **link number** and distinguishes Global Cursor from **Symbol Cursor**, with *centre bars to global cursor* and *jump to end of all charts* |
| Drawings persist per symbol across symbol change | 5 | 0 Y + 1 P | 2 | **8** | See §1.3(3) |
| Chart image export | 4 | 0 | 5 | **9** | TradingView's snapshot menu ships **download** and **copy** by default; copy-link, open-in-tab and tweet are opt-in and require the integrator to **run their own snapshot server** — which is precisely why no Indian broker has share links. Finviz's lesson is sharper: **charts are images, so export is trivially the URL**, and that is what made Finviz charts ubiquitous in forum posts. **A stable image endpoint beats an export button** |
| Data export (CSV) | 2 Y + 1 P | 1 | 1 Y + 2 P | **7** | TradingView exports the symbol series **and indicator outputs**, and publishes two honest constraints: only loaded data is exportable, and **the export is exactly the visible window**. Barchart's is **metered** with daily quotas. Sierra Chart's is not an export at all — history is **stored locally in a text format the user is told they may edit** |
| Keyboard shortcut coverage, documented | 3 Y + 3 P | 2 Y + 2 P | 1 Y + 2 P | **13** | Thinkorswim is **fully remappable with a Chart category of its own**, and a conflict offers **Reassign**, which strips the binding from its previous owner. Sierra Chart changes the bar period by **typing on the chart** — `15m`, `10s`, `100t`, `5-10rv` — and documents the trap that this stops working while a drawing-modification tool is active. TradingView's library notes that **the shortcut-help dialog on tradingview.com is not part of the library** — integrators must build their own |
| Measurement tool | 3 | 2 | 3 | **8** | TradingView's is a **modifier, not a tool**: hold Shift, click start bar, click end bar. Sierra Chart has a **Chart Calculator** drawing tool plus a Tool Values Window whose position and size are **remembered per chart** and which can auto-show as a tool activates |
| Log scale | 2 Y + 3 P | 3 | 2 Y + 2 P | **12** | IBKR explains it in percentage terms with a worked example. Two platforms publish **log-scale exclusions**: TradingView cannot set alerts while log scale is enabled, and TOS disables drawing alerts under it |
| Percent scale | 2 | 0 | 2 | **4** | Only four of 22. Delivered as **Percentage View** in TOS and `Alt+P` in the TradingView library |
| Inverted scale | 1 | 3 | 0 | **4** | TradingView puts Invert in the **price-scale context menu**; the library binds `Alt+I` |
| Price scale auto vs **locked** | 4 | 0 | 1 | **5** | **IBKR has the clearest affordance anywhere**: a manual vertical scale takes an explicit price range, a **yellow lock icon appears in the chart**, and clicking it restores auto-scaling. Paired with **Show # bars**, which pins the bar count so it survives time-period changes |
| Backtest / strategy visualised on the chart | 4 | 6 | 1 Y + 1 P | **12** | Two vendors publish the fidelity caveat: TradingView says strategies produce **unrealistic results on non-standard chart types** (Heikin-Ashi, Renko); NinjaTrader says backtests on P&F and Renko can diverge from real time, and offers **TickReplay** to narrow it. Zerodha's **Chart-to-Backtest** publishes its fallbacks rather than hiding them — unsupported indicators silently fall back to a price-action strategy, unsupported timeframes snap to the nearest supported one, unsupported chart types fall back to candlesticks, BSE segments excluded — and states explicitly that it **is not advice** |
| Order entry from the chart | 5 | 7 | 0 Y + 2 P | **14** | **Table stakes in Indian retail, and the quality is in the detail.** Kite: buy/sell buttons showing **top ask and top bid**, limit/stop by hovering a price and clicking a plus icon, **drag an order to re-price it — and dragging opens a confirm window unless instant placement is opted into**. Upstox: **the Y-axis of the index chart is a strike selector**, and target/stop set that way are placed as **GTT** orders, up to 8 legs. Dhan: **basket execution from the chart** |
| Position / P&L overlay on the chart | 4 | 4 | 0 Y + 2 P | **10** | Kite's P&L has **three display modes: rupee value, tick-size count, or percentage of investment** — the most thoughtful single detail in the entire research. NinjaTrader can **attach an order to an indicator line** rather than a fixed price |
| Mobile / touch client | 3 | 9 | 3 Y + 2 P | **17** | Kite's **long-press to arm the crosshair, tap anywhere to dismiss** is the cleanest documented answer to the touch conflict between inspecting a bar and panning. TradingView's library states that although the chart supports **up to eight price scales, only one can be displayed in mobile applications** |
| Published performance ceiling | 2 | 0 Y + 1 P | 0 | **3** | **Only MT5 and IBKR publish anything usable.** MT5 is the only platform exposing the ceiling as a user setting: history lives on local disk, a chart with no local history downloads **the last 512 bars**, scrolling back fetches more, and **"Max. bars on chart"** bounds it. IBKR expresses it as a *contract* instead — **Show # bars** with an enforce checkbox. TOS publishes two hard numbers without a ceiling: time-axis expansion maxes at **1000 bars**, and **too many drawings can slow the application** |

**Content was rephrased for compliance with licensing restrictions.**

## 1.5 Three further details with no equivalent elsewhere, recorded because they are directly transferable

- **Sierra Chart ships a documented Forward Projection Area** — a configurable number of forward columns, with an option to use the maximum available space — [Chart Drawing Tools](https://www.sierrachart.com/index.php?page=doc/Tools.html). That is the only native "room for the future" primitive in the research, and it is exactly the space our projection cone needs.
- **NinjaTrader publishes a daily-bar provenance warning**: intraday time bars are built from the chart's Trading Hours definition, but **daily and higher bars are built by the data provider**, recorded on electronic-trading-hours definitions, and where the provider exposes the official settlement value, **that value is used as the daily close** — [Bar Types](https://ninjatrader.com/support/helpGuides/nt8/bar_types.htm). This is the kind of disclosure our daily series should be able to make, and it is the same class of question Zerodha answers in [Why are the OHLC values on daily and hourly charts different?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/why-are-the-ohlc-values-on-daily-and-hourly-charts-different).
- **Server-rendered charts remain a legitimate answer, not a legacy embarrassment** (Cluster C, `high` confidence). SharpCharts and Finviz both render images, and Finviz uses that to show **hundreds of annotated charts per page**, which no interactive engine in the research attempts. Worth having an image-render path for watchlist grids and very long histories, with the interactive canvas reserved for the focused single chart.

---

# PHASE 2 — WHAT RĀMA'S CHART ACTUALLY HAS, COUNTED

Read off the code at commit `8c1c9ee`, not off the ledger. Line counts are `Get-Content | .Count`.

| File | Lines | Role |
| --- | --- | --- |
| `src/pages/StockMind/PriceChart.jsx` | **1,910** | The component. Series, panes, markers, price lines, cone, toolbars, pointer wiring, keyboard, readout. |
| `src/pages/StockMind/indicators.js` | **850** | 22 studies, all pure functions of the bars. `OVERLAY_DEFS`, `OVERLAY_NEEDS`, `overlaysFor`, `overlayShortfall`, `heikinAshi`. |
| `src/pages/StockMind/chartDrawings.js` | **374** | The drawing model: anchors, geometry, hit-testing, Fibonacci and measure maths, the store. Touches no chart library. |
| `src/pages/StockMind/ChartDrawingLayer.js` | **228** | The only `lightweight-charts` primitive in use. Converts data coordinates to pixels and issues canvas calls. Nothing else. |
| `src/pages/StockMind/chartTime.js` | **197** | The one place that decides which time type a chart holds, plus the display-zone boundary. |
| `src/pages/StockMind/chartZoom.js` | **195** | Density presets, clamps, the measured verification loop, `describeZoom`. |
| `src/pages/StockMind/timeframes.js` | **300** | 9 intervals, 10 ranges, per-interval provider caps, shortfall notes, date↔range reconciliation. |
| `src/pages/StockMind/glossary.js` | **1,096** | Every `?` on every control reads from here. |
| `src/pages/StockMind/InfoTip.jsx` | **83** | The `?` itself. A missing term renders **nothing** rather than a broken marker. |
| `src/pages/StockMind/positionMath.js` | **181** | `closePreview`, `closeAgainstThesis`, `riskBudget`, `whyCannotPredict`. Pure, no React/IPC/DOM. |
| `src/components/PanelBoard.jsx` | — | The resizable/maximisable workspace board the chart sits in when `fillHeight` is set. |

Library: **`lightweight-charts` 5.2.1**, pinned, no `^`/`~`. It is the only charting dependency and it is the extension point. No new dependency is proposed anywhere in this document.

## 2.1 Chart types — exactly 6

| Key | id | Label | Note in code |
| --- | --- | --- | --- |
| `1` | `candles` | Candles | — |
| `2` | `bars` | Bars | — |
| `3` | `line` | Line | Chosen because at 2,500 bars a candle is under a pixel and the OHLC information is gone |
| `4` | `area` | Area | — |
| `5` | `baseline` | Baseline | Zero line anchored on `basePrice` — master's average cost — so "am I up or down on this position" needs no arithmetic |
| `6` | `heikin` | Heikin-Ashi | Carries a `warn` string rendered **on the chart**, not in a menu tooltip: HA open and close are averages, so they are prices that never traded; read direction from it, never levels |

**Decision already locked and worth not re-litigating:** studies are computed on the **real** bars, never the Heikin-Ashi ones. An RSI of HA values is an RSI of a price that did not trade.

Absent, and correctly so for now: Renko, Kagi, Point & Figure, Line Break, range bars, volume/tick bars, seconds resolution. All need either tick data or a bar-construction layer we do not have. See Phase 3.

## 2.2 Price-scale modes — exactly 3

| id | Label | Library mode |
| --- | --- | --- |
| `normal` | `LIN` | `PriceScaleMode.Normal` |
| `log` | `LOG` | `PriceScaleMode.Logarithmic` |
| `pct` | `%` | `PriceScaleMode.Percentage` — percentage from the first visible bar |

**We have percent scale, which only 4 of 22 researched surfaces do.** We do **not** have inverted scale (4 of 22 do) and we do **not** have an explicit auto-vs-locked scale affordance (5 of 22 do, IBKR's being the clearest).

## 2.3 The 22 studies, with every hard-coded period named

`OVERLAY_DEFS` is built in two parts — 8 in the initial literal, 14 pushed by the Section 120 block. **Every period is a literal inside `make`. There is no parameter editing anywhere.** This is the exact gap that 19 of 22 researched surfaces do not have.

Price pane (`pane: 'price'`) — 12:

| id | Label | Hard-coded parameters | kind | `OVERLAY_NEEDS` | Availability |
| --- | --- | --- | --- | --- | --- |
| `sma20` | SMA 20 | period **20** | line | 20 | all |
| `sma50` | SMA 50 | period **50** | line | 50 | all |
| `sma200` | SMA 200 | period **200** | line | 200 | all |
| `ema21` | EMA 21 | period **21** | line | 21 | all |
| `bb` | Bollinger 20,2 | period **20**, **2**σ | band | 20 | all |
| `vwap` | VWAP | — (session reset) | line | 1 | **intraday only** |
| `donchian` | Donchian 20 | period **20** | band | 21 | all |
| `keltner` | Keltner 20,2×ATR20 | EMA **20**, ATR **20**, mult **2** | band | 21 | all |
| `supertrend` | Supertrend 10,3 | ATR **10**, mult **3** | series (`directionalSplit`) | 12 | all |
| `psar` | Parabolic SAR | library defaults inside `psar()` | series (`dots`) | 3 | all |
| `ichimoku` | Ichimoku 9,26,52 | **9 / 26 / 52**, displacement **26** | series (5 lines) | **78** | all |
| `pivots` | Pivots (prev bar) | — | series (5 lines) | 2 | **daily or longer only** |

Own pane (`pane: 'oscillator'`) — 10:

| id | Label | Hard-coded parameters | kind | `OVERLAY_NEEDS` | Guides / scale |
| --- | --- | --- | --- | --- | --- |
| `rsi14` | RSI 14 | period **14** | line | 15 | guides 30/70, scale 0–100 |
| `macd` | MACD | **12 / 26 / 9** inside `macd()` | macd | **34** | — |
| `atrPct` | ATR% 14 | period **14** | line | 15 | — |
| `adx` | ADX 14 +DI −DI | period **14** | series (3 lines) | 29 | guide 25 |
| `stoch` | Stochastic 14,3,3 | **14 / 3 / 3** | series (2 lines) | **18** | guides 20/80, scale 0–100 |
| `williams` | Williams %R 14 | period **14** | line | 14 | guides −80/−20, scale −100–0 |
| `cci` | CCI 20 | period **20** | line | 20 | guides ±100 |
| `mfi` | MFI 14 | period **14** | line | 15 | guides 20/80, scale 0–100 |
| `obv` | OBV | — | line | 2 | — |
| `roc` | ROC 12 | period **12** | line | 13 | guide 0 |

Pane assignment: price is pane 0; volume takes pane 1 when on; oscillators start at pane 2 (or 1 when volume is off) and each takes its own. Overlay colours come from a fixed 6-entry list, not from the theme, so two moving averages are never the same colour.

Three correctness facts in `OVERLAY_NEEDS` that are the result of earlier work and must not be "simplified" back: **`macd: 34`** (the line draws at 26, the signal needs nine more of it), **`ichimoku: 78`** (Senkou B is the 52-bar midpoint displaced **26 bars forward**, so the first one landing on a real bar needs 52+26), **`stoch: 18`** (%K needs 14+3, then %D needs three of those).

## 2.4 Drawing tools — exactly 8

| Key | id | Label | Points | Persisted |
| --- | --- | --- | --- | --- |
| `t` | `trendline` | Trend line | 2 | yes |
| `y` | `ray` | Ray | 2 | yes |
| `h` | `hline` | Horizontal | 1 | yes |
| `i` | `vline` | Vertical | 1 | yes |
| `e` | `rect` | Rectangle | 2 | yes |
| `b` | `fib` | Fibonacci | 2 | yes |
| `m` | `measure` | Measure | 2 | **no — `transient: true`, refused in the store and again at the commit point** |
| `n` | `text` | Note | 1 | yes |

Fibonacci levels: `0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618`. **0.5 is included and the code says plainly it is not a Fibonacci ratio** — it is the level traders watch. Level 0 is the **first** anchor, so dragging high-to-low measures retracements from the right end; reversing silently would disagree with every other platform.

Geometry: distance to the **segment**, not the infinite line; a ray is unbounded forward and bounded behind; a rectangle is grabbed by its **border**; a note by its anchor within `tol * 2`; a Fibonacci set by any of its level lines across the pane width; search is **newest-first**; and **an anchor the library cannot project makes a drawing unselectable rather than selectable at a guessed position** — `timeToCoordinate`'s null is honoured, never clamped.

Locking means three specific things, all asserted: a locked mark **cannot be selected**, is **skipped by undo**, and **survives a clear**.

### Where a drawing feature half-exists — by which half

| Feature | Present half | Missing half |
| --- | --- | --- |
| **Selection handles** | Handles **render**: `ChartDrawingLayer.draw` draws a 4px dot at every projected anchor of the selected drawing, and `hitTest` resolves the drawing under the pointer with a tested 6px tolerance. | **They do not move.** There is no handle hit-test, no `dragging` state, and no mutator in `chartDrawings.js` that rewrites a drawing's anchors. `PriceChart`'s `down` handler, when no tool is armed, only calls `setSelectedId` and returns. So an existing drawing can be selected, locked, deleted and undone — and **cannot be moved or reshaped**. |
| **Note text** | The note draws, persists per symbol, carries up to 280 characters, and renders with a backing plate so text on candles stays readable. | **The text comes from `window.prompt('Note:')`** — the only prompt left in the chart, and the code says so in a comment. Section 102 removed the last `window.prompt` from the close-position flow for good reasons (any string accepted, no consequence shown). There is no inline editor and no way to **edit** an existing note's text at all. |
| **Measure** | Full: price, percent, bars and elapsed time, with **bars counted from the chart's own logical scale** rather than from elapsed time, because an intraday span crosses overnight gaps where no bars exist. The reading survives the drag that produced it. | Nothing missing. This one is complete. |
| **Drawing styling** | The model carries `color` and `width` (clamped 1–6) and the renderer honours both. | **No UI sets either.** `makeDrawing` is always called without `extra.color` / `extra.width`, so every mark is the one magenta at width 2. No templates, no clone, no multi-select. |

## 2.5 Keyboard map — exactly 21 bindings, all on the chart's own focus

Never a document-level listener, so typing in the symbol field is never hijacked. Modifier-bearing keys return immediately (`ctrl`/`meta`/`alt`).

| Key | Action |
| --- | --- |
| `1` `2` `3` `4` `5` `6` | chart type |
| `l` | toggle log scale (log ↔ normal; does not reach `%`) |
| `v` | toggle volume pane |
| `r` | reset zoom to the density target |
| `f` | toggle fullscreen |
| `[` | wider candles (coarser density) |
| `]` | narrower candles |
| `t` `y` `h` `i` `e` `b` `m` `n` | arm/disarm a drawing tool |
| `Delete` / `Backspace` | remove the selected drawing |
| `z` | undo the most recent **unlocked** drawing |
| `Escape` | abandon tool and half-drawn mark; else close a menu; else leave fullscreen |

The suite asserts that no drawing-tool key collides with a chart-type, view or bracket key. **This is already ahead of most of the research:** only 6 of 22 surfaces publish a documented shortcut map at all, and TradingView's library explicitly leaves the shortcut-help dialog to the integrator.

## 2.6 Zoom — density presets, clamps, and a closed verification loop

| Density | px between candle centres | Intent |
| --- | --- | --- |
| `comfortable` | **18** | Big candles, a few weeks on screen |
| `standard` | **12** (default) | About where TradingView opens |
| `compact` | **7** | More history, less body detail |
| `dense` | **3** | Shape only; bodies not readable |

`MIN_BAR_PX` **1**, `MAX_BAR_PX` **40**, `CORRECTION_TOLERANCE` **0.12**, `RIGHT_HEADROOM_BARS` **2**.

The loop: `barSpacing` is set **at chart creation** (`timeScale: { barSpacing, minBarSpacing: 0.5 }`) and on apply; then **wait a frame**; then derive the actual width from `getVisibleLogicalRange()` and `timeScale().width()` — the axis's own width, **not** `clientWidth`, which includes the 60–70px price scale; compare against the 12% tolerance; and if it drifted, set the logical range explicitly **once** via `rangeForPxPerBar`, where `from` is allowed to go **negative** so a short series leaves the pane empty. **There is no `fitContent()` in any catch**; exactly one `timeScale().fitContent()` survives, behind the `fit all` button, and the suite counts it. `describeZoom` puts the **measured** figure in the header — `12px/bar · 75 of 4,649 bars` — because three sections were spent guessing while nothing on screen said what the zoom was.

**None of this may be regressed.** `verifyChartTime.mjs` holds 197 assertions over `chartTime.js` and `chartZoom.js` and all 197 must stay green.

## 2.7 Time — one chart, one time type

`toChartTime(raw)` returns a **`'YYYY-MM-DD'` string** for daily-and-longer bars and a **UTC epoch number** for intraday. Both types are correct: the string tells `lightweight-charts` the point is a whole day, which is what puts daily bars on a business-day scale with no weekend gaps. What was missing was anything enforcing that one chart uses one of them; `timeTypesMatch` now does, and the cone effect refuses to draw rather than throwing if they ever diverge again.

Stored values stay **true UTC**. Only the **label** converts to master's zone, via `makeTickFormatter` (which respects the library's tick-mark type so the axis is not a wall of text) and `makeTimeFormatter`. **A daily bar is never zone-converted**, because a daily bar is a calendar date in the exchange's reckoning, not an instant, and pushing `2026-09-18` through a timezone can land it on the 17th or the 19th. `zoneLabel()` prints `GMT+5:30` beside times, because a bare "09:15" could be IST or UTC and that exact ambiguity is what made the earlier defect hard to see.

**`sessionStarts(candles)` already exists and is tested:** it returns a `Map` of `'YYYY-MM-DD' → epoch seconds of that session's first stored bar`, and is **empty for a daily chart** because a daily chart needs no mapping. This is the primitive session shading needs; it does not have to be invented.

## 2.8 Intervals and ranges

9 intervals: `1m`, `2m`, `5m`, `15m`, `30m`, `60m` (intraday) and `1d`, `1wk`, `1mo`. `SESSION_MINUTES = 375` — one NSE/BSE session, 09:15–15:30. Spans are in **session minutes, not wall-clock**, so one division works for every interval.

10 ranges: `1D`, `5D`, … `2Y` (504 sessions), `5Y` (1260), `10Y` (2520), `MAX` (unbounded at the provider, capped at `MAX_BARS = 20000` over IPC).

Provider depth caps, in **sessions**: `1m: 5`, `2m: 5`, `5m: 21`, `15m: 21`, `30m: 21`, `60m: 504`, and `null` (no cap) for `1d`/`1wk`/`1mo`. `MIN_USEFUL_BARS = 10` is a **display** floor, deliberately below the engine's 20-bar computation floor. Master overrode an earlier design here: **every** range is offered, not only the servable ones, with the ones past the cap marked rather than hidden — because the control was refusing on his behalf.

## 2.9 What the chart draws that is **not** arithmetic, and how it is marked

| Layer | Source | Current visual distinction |
| --- | --- | --- |
| Master's **fills** | the ledger, via the `fills` prop | series markers; placed through `markerTime()`, so on an intraday chart a date-only fill sits at that session's **first stored bar** — derived from data on hand, never a plausible time of day Rāma invented |
| Master's **thesis** levels | `thesis` prop | price lines |
| Signal levels SL / ENTRY / T1 / T2 / T3 | `signal` prop (engine) | price lines, each with its own colour and line style |
| **Projection cone** | `cone` prop (`projection.py`) | **dashed and grey while the centre is untilted; accent only when gate-cleared.** The layer chip reads `projection (flat)`; `cone.tiltReason` is printed in full under the canvas |
| Master's **drawings** | `localStorage` | one magenta that is none of the engine's colours |

Each of the last three is independently toggleable (`layers.fills`, `layers.levels`, `layers.cone`). The accessible readout mirrors the crosshair legend in text and names which layers are on.

## 2.10 Export paths — exactly one

**PNG only**, via `chart.takeScreenshot()`, filename `<SYMBOL>-<interval>-<YYYY-MM-DD>.png`. `toBlob` with a `toDataURL` fallback; the object URL is revoked on a 4-second timer rather than immediately, because revoking before the click is processed cancels the download in Chromium. The code states plainly that **the image is the canvas only** — toolbars, the readout and the shortfall notes are DOM and are not in it.

**There is no CSV or data export.** 7 of 22 researched surfaces have one.

## 2.11 Persistence keys — exactly two

| Key | Shape | Written when |
| --- | --- | --- |
| `rama.stockmind.chart` | `{ chartType, scaleMode, overlays: string[], volume: boolean, density }` | on every change to any of the five |
| `rama.stockmind.drawings.<SYMBOL-UPPERCASE>` | `Array<{ id, tool, points: [{t, price}], text, color, width, locked, createdAt }>` | on change, not on unmount, so a crash loses nothing. Capped at `MAX_PER_SYMBOL = 200`, dropping the **oldest**, never the one just drawn. Validated on read, so a hand-edited or half-written store returns `[]` rather than throwing inside a render. `-1` is returned when the write fails (quota, private mode) — the drawings still work for the session, only persistence is lost |

Both are `localStorage`, i.e. **local device memory with no eviction policy of our own** — the Kite-web failure mode in §1.3(3) minus the layout cap. Stated here so it is a known position rather than an unexamined one.

## 2.12 Verification suites that must stay green, with current assertion counts

Run in this worktree on 2026-10-01; all green. **All six `.mjs` suites and `auditRenderer.cjs` run inside the worktree with no `node_modules`,** which is what makes this tranche verifiable here at all.

| Suite | Assertions | Covers |
| --- | --- | --- |
| `scripts/verifyChartTime.mjs` | **197** | `chartTime.js` + `chartZoom.js` |
| `scripts/verifyIndicators.mjs` | **164** | all 22 studies, the four commonly-wrong formulas, `OVERLAY_NEEDS`, both exclusions by name |
| `scripts/verifyChartDrawings.mjs` | **135** | anchors, geometry, Fibonacci, measure, the store |
| `scripts/verifyTimeframes.mjs` | **123** | intervals, ranges, caps, shortfalls, date↔range |
| `scripts/verifyPositionMath.mjs` | **107** | `positionMath.js` |
| `scripts/verifySymbols.mjs` | **70** | `symbols.js` |
| `scripts/verifyGlossary.mjs` | **48** | **referential integrity**: every `InfoTip id=` and `info=` in `src/pages/StockMind/*.js(x)` must name a real term, every `seeAlso` and screen-map callout must resolve, and **every term must be reachable from somewhere** |
| `scripts/auditRenderer.cjs` | — | stores, bridge calls, identifiers and IPC channels all resolve |

## 2.13 Backend series — confirmed shortfalls

- **`advanced_features.py` (467 lines) returns last-bar scalars and discards the arrays.** Eight generators — `ichimoku_features`, `fibonacci_features`, `supertrend_features`, `elliott_wave_features`, `market_profile_features`, `order_flow_features`, `smart_money_features`, `garch_proxy_features` — each compute a full series internally and return a flat dict of scalars via `compute_advanced_features` → `np.ndarray`. **Charting any of them needs new series-returning endpoints. It is not a wiring job.**
- **`projection.py` (398 lines) is the cone**, and it already discloses its own epistemic state: `MAX_BARS_AHEAD = 40`, `BANDS = (1.0, 2.0)`, and a centre that **tilts only when `entitled` is true** — a gate-refused model tilts by nothing and sets `tilted: false` plus a `tiltReason` saying so. The tilt, when applied, is the model's edge over even money scaled by one horizon-sigma, never an invented target.
- **`costs.py` (483 lines) has real INR charges with a dated rate history.** `RATE_HISTORY` has two eras (`2024-10-01`, `2026-04-01`), `EARLIEST_KNOWN = "2024-10-01"`, `TABLE_AS_OF = "2026-04-01"`. **Options STT went 0.0625% → 0.10% → 0.15% of premium across two changes**; futures STT 0.02% → 0.05%. `round_trip_charges` prices **each leg at its own date** and returns `ratesFrom`, `ratesChangedMidTrade`, `ratesUnknownEra`, `breakEvenPct`. `rates_on()` before `EARLIEST_KNOWN` returns a warning telling the caller to treat the figure as **unverified rather than measured**.
- **`strategy_spec.py` already implements the zero-lot refusal.** `cost_in_rupees` divides `position_size` by the lot size, and when `tradable <= 0` it increments `unlotted` and **counts it separately so it can never be read as a free trade**. It returns `tradesBelowOneLot`, `tradesSpanningRateChange`, `tradesInUnknownRateEra`, `realRoundTripPct` vs `flatModelRoundTripPct`, and a per-trade `trades[]` of `{entryDate, lots, units, grossPnl, charges, netPnl, ratesFrom}` capped at 200. **Everything the chart needs for cost-aware backtest markers already exists on the Python side.**
- **`macro.py` (556 lines) is the transmission chain, measured with a pre-registered sign.** Link kinds `CONSUMER` / `PRODUCER` / `FLOW` / `CONTROL`; `measure_link(..., sign, window, lag)` where **`sign` is +1 or −1 and is explicitly never inferred**; non-overlapping sampling stepped by the lag so the t-statistic means what it claims; `MIN_OBSERVATIONS = 30`, `MIN_PER_BUCKET = 10`, `T_THRESHOLD = 2.0`, `BUCKET_FRAC = 0.33`. Verdicts: `supported` / `not-supported` / **`contradicted`** / `insufficient` — and on a contradiction the code says *"the sign is not adjusted to fit: a claim that fails is a claim that failed"*.
- **`news.py` (864 lines)** has `classify_event` over an `EVENT_PATTERNS` table, `score_text` with negation handling, `relevance`, `aggregate`, GDELT backfill from a `GDELT_FLOOR` of 2017-01-01, a `news1d` stored interval and a `coverage()` reporter. **Event dates exist. Event markers do not.**
- **`charge_watch.py` (316 lines)** matches a charge term **and** a change term, names the authority (Union Budget, Finance Bill, SEBI, NSE circular), extracts the effective date from the text, captures the claimed percentage **only to show master what the article said, never to write a rate**, and carries `VERIFY_SOURCES` so master is never asked to trust a headline. It proposes; it does not apply.
- **`store.py`** exposes `meta()` and `inventory()`, and the chart already receives `coverage={first, last}` from `barsMeta.storedFirstBar/storedLastBar` — but **only at one of the three call sites**.
- **`derivatives.py` (917 lines)** has `max_pain`, OI concentration via Herfindahl, `option_chain`, `fii_dii_latest`, `participant_oi`, `delivery_data`. The foundations for the OI-on-chart direction of §1.3(6) exist.

### One internal inconsistency found while reading, recorded rather than fixed

`dispatcher.py` declares `LOT_SIZES = {"NIFTY": 25, "BANKNIFTY": 15, "FINNIFTY": 40, "MIDCPNIFTY": 75, "SENSEX": 10, "NIFTY50": 25}`, while `strategy_spec.py` states in two places — a validation warning and the `cost_in_rupees` docstring — that **NIFTY is 75 units**. The two disagree by a factor of three, and lot size is the denominator of the zero-lot refusal, so this is not cosmetic. **This is an engine-side defect and is NOT touched by this tranche** (the engine cannot be exercised here). It is carried into NOT VERIFIED and into the ledger row's NEXT list.

---

# PHASE 3 — THE GAP MATRIX

One row per feature. **"Platforms"** is the Y-or-P count out of **22** surfaces (Bloomberg excluded as out of evidence); Cluster C contributions are recollection, not verified. **"Relevant to StockMind?"** is the column that matters, and every `no` and `later` carries its reason. **"Engine?"** means it cannot be built renderer-only. Effort S/M/L is against this codebase, not in the abstract. Priority 1 = this tranche, 2 = next, 3 = after an engine change, 4 = ruled out or deferred indefinitely.

| Feature | Platforms (of 22) | In Rāma? | Relevant to StockMind? | Engine? | Effort | Pri |
| --- | --- | --- | --- | --- | --- | --- |
| Candle / bar / line / area / baseline | 21 | **yes** — 6 types | yes | no | — | — |
| Heikin-Ashi | 10 | **yes**, with the warning on the chart | yes | no | — | — |
| **Editable indicator parameters** | **19 — the most universal feature in the research** | **no** — all 22 studies period-locked | **yes.** A 14-period RSI on 30m bars is not the same study as on daily, and master trades both. Every researched surface except Finviz lets the user change it | no | **M** | **1** |
| Indicator templates / presets | 10 | **no** — the enabled set persists, but there are no named presets | **later.** Worth little until parameters are editable; a preset of fixed-period studies is just the current `overlays` array | no | S | 2 |
| Per-indicator Y-axis / scale control | 2 | **partial** — a study may declare a fixed `scale`, master cannot change it | later. The oscillator-pane split already solves the defect this exists to avoid | no | S | 3 |
| **Drag / reshape an existing drawing** | 6 clone + universal implicit | **partial — handles render, they do not move** | **yes.** A mark that cannot be nudged is a mark master redraws, and he is marking his own reasoning | no | **M** | **1** |
| **Inline note editor** (replace `window.prompt`) | — (universal; nobody uses a browser prompt) | **no** — `window.prompt('Note:')`, and no way to edit an existing note | **yes.** Section 102 removed the last `window.prompt` from a money path for stated reasons; this is the only one left | no | **S** | **1** |
| Drawing colour / width UI | implicit in all with drawings | **partial** — the model carries both and the renderer honours both; no UI sets either | yes | no | S | 2 |
| Drawing templates | 9 | no | later. Needs the colour/width UI first, and is Trading-Platform-only even at TradingView | no | M | 3 |
| Drawing clone / multi-select | 6 | no | later | no | M | 3 |
| Magnet / snap-to-OHLC | 4 | no | **later, and deliberately so.** `chartDrawings.js` states that master's marks are **never snapped to a "better" level on his behalf**. A *hold-to-snap modifier* (TradingView's model, not MT5's always-on tolerance) is the only form consistent with that | no | M | 3 |
| **Session shading** | 4 | **no** | **yes, for a StockMind-specific reason.** Not for extended hours — NSE retail has none. For making the **375-minute session boundary** visible on intraday bars so an overnight gap is not misread as a move, and so `sessionStarts`' already-tested mapping becomes visible | no | **M** | **1** |
| **Data-coverage shading** | 0 | **no** | **yes, and it is ours alone.** Free providers cap intraday depth at 5–21 sessions; `coverage` already arrives at one call site | no | S | 2 |
| Holiday / no-trade gap handling | 7 | **partial** — free for daily via the business-day scale; intraday epoch numbers produce real gaps | yes, and already correct in the direction that matters | no | — | — |
| Multi-pane + resize | 15 | **partial** — panes are created and assigned correctly; **master cannot resize or maximise one** | later. Pane heights are library defaults and readable; Kite's maximise-pane is the cheap version | no | M | 2 |
| Second-symbol comparison in **%** | 6 | **no** | **yes.** Relative performance against NIFTY is the single most common Indian retail question, and `%` scale already exists. But it needs a second series fetch, so it is **not** renderer-only | **yes** (a second symbol's bars) | M | 2 |
| Spread / ratio charts | 6 | no | later. StockCharts' lesson — model a ratio as a *symbol*, not a chart mode — is the right design, and it belongs in the data layer | yes | L | 3 |
| Log / percent scale | 12 / 4 | **yes, both** | yes | no | — | — |
| Inverted scale | 4 | no | later. Cheap (`PriceScaleMode.Inverted`-equivalent via `invertScale`) but answers no question master has asked | no | S | 3 |
| Price scale auto vs **locked** | 5 | no | later. IBKR's yellow-lock affordance is good; our autoscale has not been reported as a problem | no | S | 3 |
| Measurement tool | 8 | **yes**, with bars counted from the logical scale | yes | no | — | — |
| Keyboard shortcut coverage | 13 | **yes — 21 bindings, collision-asserted** | yes | no | — | — |
| Chart image export | 9 | **yes** — PNG, canvas only, stated | yes | no | — | — |
| **Data export (CSV)** | 7 | **no** | **yes.** TradingView's constraint is the honest design: **the export is exactly the visible window**. Master checking an engine figure against the bars needs this | no | S | 2 |
| Stable image endpoint for sharing | 2 (Finviz, StockCharts) | no | later. Needs a server surface; the PNG download covers the need today | yes | L | 4 |
| Multi-chart layouts, saved | 15 | **partial** — one chart, plus a resizable workspace board (`PanelBoard`) and a popout window; no saved multi-chart layout | later. The board is the local answer; a layout document is a persistence project | no | L | 3 |
| Cross-chart crosshair / interval sync | 5 | no | later. Needs multi-chart first | no | M | 3 |
| Drawings persist per symbol across symbol change | 8 | **yes** — per symbol, portable across every interval, absolute epoch anchors | yes | no | — | — |
| Bar replay / playback | 7 | no | **yes, eventually — and for a StockMind reason nobody else has.** Replay is how master would watch a *cost-aware* backtest's trades arrive one at a time with running expectancy. Sierra Chart's lesson applies: replay **fidelity** is a contract, not a speed slider | yes (trade series) | L | 3 |
| Alerts created from the chart | 11 | no | **later, and the schema decision must be taken first.** TrendSpider's model — **the alert references the drawing's identity, not a frozen price** — is the one to build; doing static price alerts first is a migration. Also needs something always running, which the desktop app is not | yes | L | 3 |
| Alert → order | 2 | no | **no.** Requires a broker API. See Phase 4(a) | — | — | 4 |
| **News markers on chart** | 3 | **no** | **yes.** Master: news *"used in combo with price for clarity"*. `news.py` has dated classified events today | **yes** (series endpoint) | M | 3 |
| **Economic / macro markers on chart** | 4 | **no** | **yes, and in a form nobody ships** — a transmission link with its pre-registered sign and lag, and a contradicted link drawn as contradicted. See Phase 4(b) | **yes** | M | 3 |
| Split / dividend / bonus markers | 6 | no | **yes.** Indian bonuses and splits are frequent, and Zerodha's article set is effectively a checklist of the failure modes. Needs a corporate-action dataset we do not have | yes | M | 3 |
| Corporate-action adjustment **declared** | 9 | **no — and we do not even know our own adjustment state** | **yes, and it is cheap once known.** Cluster C's finding stands: adjustment is poorly declared everywhere, so **a visible declared adjustment state is a genuine differentiator** | yes (provider metadata) | S | 3 |
| Earnings markers | 5 | no | later. Same dataset problem | yes | M | 3 |
| Auto pattern recognition | 7 | no | later. And if built, Finviz/TrendSpider's lesson governs: the control is a **sensitivity setting**, and every drawn line is a **model claim** that must carry its class | yes | L | 3 |
| Auto support / resistance | 8 | **partial** — `pivots` and the signal levels are computed levels; nothing is *detected* | later. Same as above | yes | M | 3 |
| Volume pane | ~universal | **yes**, own pane, toggleable on `v` | yes | no | — | — |
| Volume profile (visible / fixed range) | 5 / 3 | no | later. Pure arithmetic on visible bars, so renderer-only and genuinely useful — but it needs a horizontal-histogram primitive and master has not asked | no | L | 3 |
| Market profile / TPO | 2 | no | **no.** 2 of 22, both US-futures-oriented, and Cluster B has it nowhere. **For NSE, OI structure is the locally meaningful analogue** | — | — | 4 |
| Order-flow footprint | 4 | no | **no.** Needs tick-level aggressor data. See Phase 4(a) | — | — | 4 |
| Depth-of-market ladder | 8 | no | **no.** Needs a Level-2/Level-3 feed. See Phase 4(a) | — | — | 4 |
| Order entry from the chart | 14 | no | **no.** Broker integration is *"not yet"*. See Phase 4(a) | — | — | 4 |
| Position / P&L overlay | 10 | **partial** — fills are markers and `basePrice` anchors the baseline chart; **no P&L drawn** | **yes, in the form Kite got right**: P&L in **rupees / percent of investment**, from the ledger plus the last close, which is arithmetic on master's own declarations — the same line `positionMath.js` already holds | no | M | 2 |
| Seconds resolution / tick bars | 2 / 4 | no | **no.** No real-time tick stream. See Phase 4(a) | — | — | 4 |
| Renko / Kagi / P&F / Line Break / range bars | 8 / 4 / 6 / 3 / 5 | no | later. Pure bar construction from stored bars, so renderer-feasible for the daily case — but **both TradingView and NinjaTrader publish that backtests on these diverge from reality**, and a cost-aware backtest is the point of StockMind. Low value, real risk of misreading | no | L | 3 |
| Semantic bar colouring (Elder Impulse / Raindrop pattern) | 2 | no | **later, and it is the most interesting borrow in the research** — encode an agreement state into the bar rather than adding a line. Pure function of visible bars. But a bar colour that encodes a *model* state would be a claim wearing arithmetic's clothes, so it must be built from indicators only | no | M | 3 |
| Multi-timeframe indicator on one chart | 1 | no | later. Needs a second resampled series; genuinely useful for the 30m-vs-daily question master actually has | no | M | 3 |
| Published performance ceiling | 3 | **partial** — `MAX_BARS = 20000` bounds the IPC payload; no measured render ceiling | later. MT5's "Max. bars on chart" is the model. Nothing has been reported slow | no | S | 3 |
| Mobile / touch | 17 | **no, and correctly** — Rāma is an Electron desktop app | **no** | — | — | 4 |
| **Backtest trades on the chart with real rupee charges** | **0** | **no** | **yes — the single highest-value chart feature StockMind can have.** See Phase 4(b)(1) | yes | L | 3 |
| **Cost-aware position sizing incl. the zero-lot refusal** | **0** | **no** | **yes.** See Phase 4(b)(2) | partial | M | 2 |
| **Win rate AND expectancy for the visible window** | **0** | **no** | **yes.** See Phase 4(b)(3) | partial | M | 2 |
| **Charge-regime change markers** | **0** | **no** | **yes.** See Phase 4(b)(6) | yes (rate dates) | S | 3 |
| **Claim class drawn on every non-arithmetic layer** | **0** | **partial** — the cone's tilt state is visually encoded and its reason printed; nothing else carries a class | **yes. This is the house rule made visible.** See Phase 4(b)(8) | no | M | 2 |

---

# PHASE 4 — THE ALIGNMENT PASS

This is the phase the whole document exists for. A gap matrix measured against a brokerage terminal would tell us to build order entry, a depth ladder and a tick feed — and all three would be wrong. StockMind is measured against **master's stated intent**, not against Zerodha.

## 4(a) RULED OUT — with a written reason, so no later session re-proposes it

Each of these is **correctly absent**. They are not gaps, not backlog items, and not "later". If a future session finds one missing and files it as a defect, this table is the answer.

| Ruled out | Platforms that have it | Why it is ruled out |
| --- | --- | --- |
| **Order entry from the chart** — buy/sell buttons, click-a-price-to-place, drag-an-order-to-reprice, basket execution | **14 of 22, and 7 of 10 Indian brokers. Table stakes in this market.** | Master said broker integration is **"not yet"**. There is **no broker API, no order-routing channel, and no credential path to one**. Beyond the absence: `verifyGlossary.mjs` **asserts that no order-placement channel exists** in `electron/ipc/marketIntel.cjs` or `electron/preload.cjs` (regex over `place_?order|placeOrder|submitOrder|order_?entry|buy_?order|sell_?order`), that `strategy_codegen.py`'s generated code still states **"DOES NOT PLACE ORDERS"**, and that the glossary's `noOrders` term exists. **The help screen promises master that StockMind never places orders, and a test enforces the promise.** Building chart trading would mean deleting an assertion that exists to keep a promise. Sensibull's published guarantee — it never places, modifies or cancels orders automatically — is the posture to hold, not to grow out of. |
| **Depth-of-market ladder / Level-2 / Level-3 depth** | 8 of 22; Kite 20-level, FYERS 50-level, Upstox Depth 30 | **There is no depth feed.** `providers.py` fetches OHLCV bars from free providers; market depth is a licensed real-time product that arrives over a broker's streaming API. Drawing a ladder from bar data would mean **inventing the book**, which is the exact class of fabrication the claim gate exists to refuse. Note the evidence that this is a *feed* problem and not a *library* problem: ChartIQ exposes `CIQ.MarketDepth` and Kite still does not wire it to the chart. |
| **Order-flow footprint / volumetric bars / cumulative delta** | 4 of 22 (TOS via Bookmap, NT8, Sierra Chart, FYERS) | Needs **per-trade aggressor classification** — which side initiated each print. That is tick data with bid/ask context, available only from an exchange feed or a broker stream. `advanced_features.order_flow_features` already exists in Python and is a **proxy computed from bars**, explicitly not a footprint; drawing it as one would mislabel an estimate as a measurement. NinjaTrader's own guide is careful to say volumetric bars are *a classification of activity, not a signal* — and ours would not even be that. |
| **Real-time tick streaming / seconds-resolution bars** | 2 of 22 for seconds (both Indian, both sold to scalpers) | **There is no tick stream and no websocket.** Data arrives as periodic HTTP fetches from free providers, capped per interval — `1m` is limited to **5 sessions** of depth. A 1-second chart is not a rendering feature we lack; it is a data product we do not buy. Groww's published 0.2 s tick latency is a figure from a different architecture. |
| **Market profile / TPO** | 2 of 22, both US-futures-oriented; **zero in Cluster B** | Needs intraday granularity we have for only 5–21 sessions, and its interpretive tradition is US futures. **Cluster B's finding stands: for NSE/BSE F&O the locally meaningful analogue is open-interest structure**, which we already compute in `derivatives.py` (max pain, Herfindahl concentration, participant-wise OI). Importing TPO would be copying a US answer to an Indian question. |
| **Alert → order (Zerodha ATO, FYERS Automate)** | 2 of 22 | Requires order routing — see the first row — **and** something always running to evaluate the trigger. A desktop app the master closes is not that. The safety bar this would raise (market-price protection, explicit confirmation, no silent execution) is not one to clear casually. |
| **Server-side always-on alerts** | 11 of 22 create them from the chart, all server-side | Rāma is a **local desktop application**. An alert that only fires while the app is open is a worse product than no alert, because master would rely on it. This is deferred pending an always-on surface, not merely unbuilt. |
| **Mobile / touch client** | 17 of 22 | Rāma is Electron on the desktop. Kite's long-press-to-arm-crosshair is excellent and irrelevant. |
| **Anything requiring a paid feed, a websocket, or a broker credential** | — | Blanket rule, stated so the individual cases above do not have to be re-argued one at a time. Master's data constraint is **free providers, capped per interval, on-disk history that only grows.** A chart feature whose data source does not exist is not a gap in the chart. |
| **Chart share links / a hosted snapshot endpoint** | 2 of 22 | TradingView documents that copy-link and open-in-tab require the integrator to **run their own snapshot server** with its own retention policy — which is precisely why no Indian broker has them. We have no public server surface and no reason to acquire one for this. PNG download covers the need. |

**One thing deliberately NOT ruled out, against the grain of the above.** Position/P&L *display* is kept as relevant (Phase 3, priority 2) even though P&L overlays usually come with chart trading. The reason: P&L from **master's own recorded fills** against **the last stored close** is arithmetic on his own declarations, which is exactly the line `positionMath.closePreview` already holds. It needs no broker. Kite's three display modes — **rupees, tick-size count, percent of investment** — are the right menu; we would ship rupees and percent and skip ticks, because we have no tick size.

## 4(b) UNIQUELY REQUIRED BY STOCKMIND — and absent from almost every commercial platform

These are the features that follow from master's intent rather than from the industry. For each: **what it draws**, **where the data comes from**, and **how the claim gate classes it**. The claim-gate column is not decoration — it decides the visual weight, and a design that cannot answer it is not finished.

### (1) Backtest trades on the chart, with real rupee charges and running expectancy

| | |
| --- | --- |
| **Platforms with it** | **0 of 22.** 12 of 22 draw backtest trades; **none price them with dated statutory Indian charges.** TradingView's strategy report takes a commission setting; Zerodha's Chart-to-Backtest returns results and publishes its fallbacks but no rupee charge model. |
| **What it draws** | Entry and exit markers per trade on the price pane, paired by trade id, with the losing ones and the winning ones distinguished **after charges, not before** — so a trade that was gross-positive and net-negative draws as a loss, because that is what it was. Each marker's tooltip carries `lots × lotSize = units`, `grossPnl`, `charges`, `netPnl` and `ratesFrom`. Beneath price, a second pane carries **running net expectancy** (cumulative net P&L ÷ trades closed so far) and **running win rate**, both as step series advancing at each exit. A header strip states `N trades · W% win rate · ₹X expectancy per trade · real round trip Y% vs flat model Z%`. |
| **Where the data comes from** | `strategy_spec.cost_in_rupees()` — **already written**. It returns `trades[]` of `{entryDate, lots, units, grossPnl, charges, netPnl, ratesFrom}` (capped at 200), plus `tradesPriced`, `tradesBelowOneLot`, `tradesSpanningRateChange`, `tradesInUnknownRateEra`, `totalCharges`, `netPnl`, `roiPct`, `realRoundTripPct`, `flatModelRoundTripPct`, a `note`, and `costs.provenance()`. **Nothing new must be computed. A series-returning endpoint must be exposed over IPC.** |
| **Claim-gate class** | **`reflex`.** The charges are deterministic arithmetic over a dated rate table whose record is the evidence — `provenance()` returns the rate era, the sources and `VERIFY_AT`. The trade *list* is also `reflex`: it is a simulation over stored bars with a recorded spec hash. **The strategy's expected future performance is NOT drawn at all** — that would be a modal claim, and `claimGate` refuses a modal claim unless it cites a reflex projection record. So: trades and realised expectancy drawn as reflex; forward expectation absent. |
| **The number that makes this matter** | Measured in this session by loading `costs.py` directly: a **₹1,000 equity-delivery round trip costs ₹19.92 — 1.9925% of turnover**. The same instrument at **₹1,00,000 costs ₹240.18 — 0.2402%**. **A flat 0.18% cost model understates the small trade by more than ten times.** `strategy_eval` refuses any strategy whose edge is smaller than its measured cost, so this is not a display nicety: it is the difference between a verdict and a wrong verdict. The chart must show the figure that produced the verdict. |
| **Why nobody else does it** | Because they are brokers. A broker that drew the true round-trip cost of a ₹1,000 delivery trade beside the trade would be arguing against its own order flow. **That is the structural reason this is StockMind's feature and not Kite's**, and it is the sharpest instance of master's *"level the field for retail traders"*. |

### (2) Cost-aware position sizing on the chart, including the zero-lot refusal

| | |
| --- | --- |
| **Platforms with it** | **0 of 22.** Every platform sizes; **none draws "this trade cannot be placed at your capital".** |
| **What it draws** | On the price pane, beside the entry level: a sizing badge reading `units · lots × lotSize · ₹risk at the stop · ₹charges round trip · break-even move %`. The **break-even line** is drawn as a distinct level — entry plus the move needed to cover charges — because the distance between entry and break-even is the thing retail traders never see. **And when the risk budget sizes below one lot, the badge is replaced by a refusal**: `0 lots — ₹1,00,000 at 1% risk sizes N units, below one lot of 75. This trade cannot be placed.` Drawn in the refusal treatment, never as a zero. |
| **Where the data comes from** | `positionMath.riskBudget(capital, riskPct, basePrice, stopPrice)` already returns `{amount, perUnit, units}` and **already returns `units: null` rather than 0 when there is no stop**. The lot size comes from the engine (`strategy_spec` validation, `dispatcher.LOT_SIZES`), the charges from `costs.round_trip_charges`, and `breakEvenPct` is already in its return. The refusal logic already exists as `tradesBelowOneLot` in `cost_in_rupees`. **The renderer half — the badge and the break-even line — is renderer-only given the numbers.** |
| **Claim-gate class** | **`reflex`.** Capital and risk% are master's own inputs; the stop is master's or the engine's labelled level; the arithmetic is deterministic. The refusal is the strongest form of reflex: a stated impossibility with its inputs shown. |
| **The worked example master must be able to see** | ₹1,00,000 capital, 1% risk, NIFTY futures: the budget is ₹1,000 and the per-unit risk at a realistic stop sizes roughly **2 units against a lot size of 75**. **The trade cannot be placed.** `strategy_spec.py` already says it in words — *"4 units of a 75-unit NIFTY contract is 0 lots, and a strategy that sizes to 4 units is not tradeable at that capital at all. That is exactly the kind of thing a retail trader discovers with real money"* — and then counts it separately *"so it can never be read as a free one"*. **The chart is where that sentence should be visible.** |
| **Open defect blocking the exact figure** | `dispatcher.LOT_SIZES` says NIFTY is **25**; `strategy_spec.py` says **75**, twice. Until that is resolved the badge would state a lot size that is a coin toss. See NOT VERIFIED. |

### (3) Win rate and expectancy **together**, for the visible window

| | |
| --- | --- |
| **Platforms with it** | **0 of 22** in this form. TradingView's strategy report has percent profitable among many metrics, for the whole backtest, in a panel — not for the window on screen, and not paired by construction. |
| **What it draws** | A two-value strip in the chart header, for **exactly the bars currently visible**, that **cannot show one without the other**: `62% win rate · −0.20% expectancy per trade · 50 trades`. Rendered so the expectancy carries the stronger visual weight when the two disagree in sign — because the whole point is that a high win rate with negative expectancy is a losing system. On scroll or zoom the strip recomputes from the visible logical range, the same event `describeZoom` already listens to. |
| **Where the data comes from** | The trade list of (1) intersected with the visible range. **Win rate is a count; expectancy is a mean of net per-trade returns.** Both are pure arithmetic over a supplied trade list, so **once the trade list is on the client this strip is renderer-only.** For master's own closed positions the ledger is the source and `outcomes.stats()` is the engine-side equivalent. |
| **Claim-gate class** | **`reflex`** for both figures. Critically, **neither is ever `prose`**: a sentence like "this strategy wins most of the time" carries no checkable token and would pass the gate as prose while being the most misleading thing on the screen. The strip exists so the honest pair of numbers occupies the space that sentence would. |
| **Why it is a house requirement, not a feature** | Master asked for combos *"with success % near 80 and above"*. The filter was **refused with arithmetic** — 40 wins of 1% against 10 losses of 5% is an 80% win rate and **−0.20% expectancy** — and master accepted the refusal. **Win rate is always reported, never filtered.** A chart that shows win rate alone would quietly reinstate the filter master agreed to drop. The pairing is the enforcement mechanism. |

### (4) News events as markers, each carrying its claim-gate class

| | |
| --- | --- |
| **Platforms with it** | **3 of 22** have news on the chart at all (TradingView, Angel One via tradingview.com, TrendSpider). **None attaches an evidential class to the marker.** |
| **What it draws** | Time-scale markers at dated events from `news.py`, shaped by `classify_event`'s event kind and **coloured by evidential class, not by sentiment**: a **`grounded`** marker (the headline's own source carries the figure) draws solid with the publisher named; a **`reflex`** marker (Rāma's own aggregate — `score_text` with negation handling, `relevance`) draws hollow and is labelled as Rāma's reading; a **`prose`** item — a headline with no checkable token — draws as a small tick with no interpretation attached. **Nothing `unattributed` is drawn at all**, which is the gate's own rule applied to pixels. Hovering gives the headline, the source, the date and the class. |
| **Where the data comes from** | `news.py` — `headlines()`, `aggregate()`, `classify_event()` over `EVENT_PATTERNS`, the `news1d` stored interval, GDELT backfill from `GDELT_FLOOR` 2017-01-01, and `coverage()`. The dates exist today; a series endpoint does not. |
| **Claim-gate class** | **Per marker, and that is the feature.** The marker *is* the class. |
| **The constraint that must be honoured** | `StockMind.jsx` is asserted by `verifyGlossary.mjs` to still contain **`NOT BACKTESTABLE`** for the news panel. News markers must carry that qualification onto the chart: **a news marker beside a price move is a coincidence in time, not a cause**, and the only honest form is adjacency plus the macro machinery of (5) for anything stronger. TradingView's design hint is worth borrowing: marks are requested **for the visible range only**, so they must be queryable by time window rather than fetched wholesale. |

### (5) Macro transmission annotation, with pre-registered sign and lag — and a contradicted link drawn as contradicted

| | |
| --- | --- |
| **Platforms with it** | **0 of 22.** 4 of 22 put economic-calendar markers on a chart; **none states a hypothesis, its direction, its lag, or whether the data refuted it.** |
| **What it draws** | For a declared link relevant to the charted instrument, a band on the input's move with a **forward arrow spanning exactly the declared `lag`**, labelled `<input> → <target>, sign <+1/−1>, window <w>d, lag <l>d` and then the **verdict**: `supported` draws in the ordinary engine colour with `t=<value>` shown; **`not-supported` draws greyed with "inside the noise band"**; **`contradicted` draws in the refusal treatment with the words "the response is real but runs OPPOSITE to the declared direction"**; `insufficient` draws as an outline with the shortfall (`N aligned bars; needs M`). Master's chain — crude flow blocked → petro products flow drops → input prices rise → margins compress → shareholders jitter → sell/buy frenzy — renders as a chain of these, each with its own verdict, so a break in the chain is visible as a break. |
| **Where the data comes from** | `macro.measure_link()` — **already written and already carries every needed field**: `verdict`, `reason`, `sign`, `window`, `lag`, `alignedBars`, `observations`, `bucketSize`, `meanForwardAfterRise`, `meanForwardAfterFall`, `unconditionalMean`, `response`, `tStat`, `directionMatches`, `firstDate`, `lastDate`, and a `sampling` sentence explaining the non-overlapping stepping. Link kinds are `CONSUMER` / `PRODUCER` / `FLOW` / `CONTROL`, with `CONTROL` links included **to test the method, not to trade** — those must draw as controls, clearly. |
| **Claim-gate class** | **`reflex`** for the measurement; the **link itself** is a pre-registered hypothesis, and the sign is `+1` or `−1` and **is never inferred** — `measure_link` refuses to run without it. The contradicted case is the important one: `macro.py`'s own comment is *"the sign is not adjusted to fit: a claim that fails is a claim that failed."* **Drawing a contradicted link as if it were supported would be the single worst thing this chart could do**, and drawing it as contradicted is the single most unusual thing it can do. |
| **The multiple-comparison cost** | `measure_all` states it. Any on-chart presentation must carry it, or testing twelve links and drawing the two that passed is p-hacking with a nice renderer. |

### (6) Charge-regime change markers

| | |
| --- | --- |
| **Platforms with it** | **0 of 22.** |
| **What it draws** | A vertical rule on the time axis at every `RATE_HISTORY` boundary that falls inside the visible window, labelled with what changed: `2026-04-01 — futures STT 0.02% → 0.05%, options STT 0.10% → 0.15% (Union Budget 2026)`. Trades or master's fills that **straddle** a boundary are flagged, because their two legs were priced at different rates — which is what actually happened to them. And **everything left of `EARLIEST_KNOWN` (2024-10-01) is shaded as an unverified-rate region**, because `rates_on()` returns a warning there, not a rate. |
| **Where the data comes from** | `costs.RATE_HISTORY` (two eras today, each with a `from` date and a `source` string naming the SEBI circular or the Union Budget), `costs.EARLIEST_KNOWN`, `costs.TABLE_AS_OF` (`2026-04-01`), and per-trade `ratesChangedMidTrade` / `ratesUnknownEra`. `charge_watch.py` adds the forward half: it watches news for a charge **term** plus a change **term**, names the authority, extracts the effective date **from the text**, and captures the claimed percentage **only to show master what the article said, never to write a rate** — so a *proposed* change can draw as a dashed, pending marker carrying `VERIFY_SOURCES`. |
| **Claim-gate class** | **`grounded`** for an in-force rate change — the source string names the circular or Budget, and `VERIFY_AT` points at `zerodha.com/charges` and master's own contract note. **`reflex` with an explicit unverified flag** for the pre-2024-10-01 region. **`prose`-at-best, drawn as a proposal and never as a rate**, for anything `charge_watch` has only read in a headline. |
| **Why it is not cosmetic** | **Options STT went 0.0625% → 0.10% → 0.15% of premium across two changes.** A three-year options backtest priced at today's rates **overstated early costs by more than double**, and `strategy_eval` refuses anything whose edge is smaller than its cost — so a cost error in **either** direction invalidates a verdict. A backtest window that spans a boundary is mixing rate regimes, and the chart is the only place master would notice. |

### (7) Data-coverage shading — where bars exist versus where the window asked

| | |
| --- | --- |
| **Platforms with it** | **0 of 22** as a chart layer. The nearest relatives are MT5's `Max. bars on chart` and 512-bar initial load, IBKR's `Show # bars` contract, and TradingView's honest note that **a CSV export is exactly the visible window**. All three are about *limits*; none shades *absence*. |
| **What it draws** | Two bands on the time axis. **Asked-but-absent**: the region between the window master requested (`fromDate`/`toDate`, or the `rangeId` preset) and the first stored bar — hatched, labelled with the already-computed `shortfallNote()` text. **Beyond the provider cap**: for an intraday interval, the region older than `PROVIDER_CAP_SESSIONS[interval]` sessions — shaded, labelled with `describeLimit()`. Both read as *"this is a limit, not something Rāma declined"*, which is the wording `timeframes.js` already uses. |
| **Where the data comes from** | **Entirely client-side and already present**: `coverage={first, last}` from `barsMeta.storedFirstBar/storedLastBar`, plus `shortfallNote(interval, rangeId, candles.length)` and `describeLimit(interval)` — both already computed in `PriceChart` and rendered as text below the canvas. This is **renderer-only arithmetic**. |
| **Claim-gate class** | **`reflex`.** It states what the store holds and what the provider caps at; the record is the store's own metadata. |
| **Why it is ours** | Master's data constraint is free providers, capped per interval — `1m` depth is **5 sessions**. A trader looking at a 1-minute chart and reasoning about "the last month" is reasoning about bars that do not exist. **Every other platform in the research either buys the data or does not care.** |
| **Honest scoping note** | `coverage` is currently passed at **one of three call sites** (the StockMind tab chart), not the workspace panel or the popout. A coverage band that appears in one of three places is a half-feature, so this item is **priority 2 and not in the Phase 5 tranche** — the right first step is threading `coverage` through all three call sites, which is a `StockMind.jsx`/`PopoutPanel.jsx` change, not a chart change. |

### (8) The projection cone's own entitlement and tilt state, on the chart

| | |
| --- | --- |
| **Platforms with it** | **0 of 22.** The nearest thing in the entire research is Sierra Chart's **Forward Projection Area** — configurable blank forward columns. It reserves space for the future; it says nothing about the standing of what you draw there. |
| **What we already have (the half that exists)** | The cone **already encodes its tilt state visually**: bands and centre draw **dashed and grey while untilted**, accent only when gate-cleared; the layer chip reads `projection (flat)`; and `cone.tiltReason` is printed in full beneath the canvas — e.g. *"centre left FLAT — this horizon's model has not cleared the gate, so its direction is not allowed to move the projection. The width below is measured volatility and is unaffected by that."* The volatility half is honest independently of the model half. |
| **The half that is missing** | **A class badge on the cone itself, and the entitlement reason in the same place as the drawing.** Today the state is inferable from colour and readable in prose below; it is not **labelled on the layer**. Also missing: `barsAhead` vs `MAX_BARS_AHEAD = 40` and the `capped` flag are returned by `project()` and not shown, so master cannot tell a 40-bar cone from a truncated 60-bar request; and `summary.ordinaryRange` / `wideRange` (the ±1σ and ±2σ endpoints) are in the text but not labelled at the band ends. |
| **Where the data comes from** | `projection.project()` already returns `tilted`, `tiltReason`, `probability`, `bands: [1.0, 2.0]`, `barsAhead`, `capped`, `maxBarsAhead`, `volatility{...}`, `anchor{time, price}` and `summary{horizonSigmaPct, ordinaryRange, wideRange, centre, text}`. **The data is complete; only the labelling is missing**, so this is renderer-only. |
| **Claim-gate class** | **An untilted cone is `reflex`** — measured volatility over a stated lookback (`DEFAULT_LOOKBACK = 120`, `MIN_LOOKBACK = 30`), with the record as evidence. **A tilted cone is a modal claim**, and `claimGate` permits a modal claim **only** when it cites a reflex projection record — which is exactly what the tilt is. **The badge should therefore print the class, not a confidence.** `claimGate`'s own comment says it is *not a confidence score*, and `intelligenceEngine` already prints confidences elsewhere; a cone badge reading "78%" would be the wrong kind of number in the right place. |

### (9) What the research shows retail tools omit **because they sell order flow rather than analysis**

The pattern is consistent enough to be a design principle. Each row is a thing StockMind should carry precisely because a broker has no incentive to.

| Omitted everywhere | The evidence | What StockMind draws instead |
| --- | --- | --- |
| **The true cost of a small trade** | No platform in 22 draws a round-trip cost. Groww publishes **58.5 M orders placed on charts** as an achievement; it does not publish what they cost. | (1) and (2): real rupee charges per trade, and the break-even line. **₹19.92 on a ₹1,000 delivery round trip is 1.99%** — a figure that changes whether a strategy is worth trading at all. |
| **Expectancy** | 12 of 22 visualise backtests; TradingView publishes per-metric help articles for Sharpe and percent-profitable. **None pairs win rate with expectancy so neither can be read alone.** | (3): the paired strip, enforcing the refusal master accepted. |
| **That a trade cannot be placed at your capital** | 0 of 22. Every sizing tool returns a number. | (2): the zero-lot refusal, counted separately so it can never read as a free trade. |
| **Which rate regime a historical result was priced in** | 0 of 22. Every backtest prices at one implicit "now". | (6): charge-regime rules, straddle flags, and the pre-2024-10-01 unverified-rate region. |
| **Where the data stops** | 0 of 22 shade absence. MT5 and IBKR bound the bar count; nobody shows the hole. | (7): coverage and provider-cap bands, using `shortfallNote` and `describeLimit` text already written. |
| **Whether the model's opinion is allowed to count** | 0 of 22. Barchart aggregates indicators into a single directional percentage; nothing says whether it cleared anything. | (8): the cone's gate state as a **class**, not a confidence. |
| **Whether a stated macro cause survived testing** | 0 of 22. Economic markers are timestamps. | (5): pre-registered sign and lag, with `contradicted` drawn as contradicted. |
| **Whether the thing on screen is arithmetic or an opinion** | 0 of 22 label it. TradingView's strategy caveats and Zerodha's CTB fallbacks are the honourable exceptions, and both live in **support articles, not on the chart**. | The claim class on every non-arithmetic layer — the gap-matrix row with priority 2, and the governing rule made visible. |
| **A visible, declared corporate-action adjustment state** | 9 of 22 declare it *somewhere*; Cluster C finds it **poorly declared everywhere**, and Zerodha publishes that **historical candle values can change after a refresh**. | Deferred to priority 3 because we do not yet know our own adjustment state — but recorded here as **a cheap genuine differentiator once we do**, and it matters specifically for Indian bonuses and splits. |

## 4(c) THE PHASED, PRIORITISED ROADMAP — every item with a verification method

"Read the code and confirm it looks right" is **not** a verification method and appears nowhere below. Each item names a suite with the assertion it must add, or a specific on-screen check master can perform and report.

### Phase A — renderer-only, verifiable in this worktree. **This is the Phase 5 tranche.**

| # | Item | Verification method |
| --- | --- | --- |
| A1 | **Editable indicator parameters** for all 22 studies | `verifyIndicators.mjs`: assert every `OVERLAY_DEFS` entry declares a `params` schema whose defaults **reproduce today's hard-coded values exactly** (`sma20` default 20, `bb` 20/2, `ichimoku` 9/26/52, `stoch` 14/3/3, `macd` 12/26/9, `keltner` 20/20/2, `supertrend` 10/3, `adx` 14, `cci` 20, `roc` 12 …); assert `make(bars)` with no params is **value-identical** to `make(bars, defaults)`; assert `needsFor(id, params)` scales with the period so `sma` at 200 needs 200 and at 10 needs 10; assert out-of-range, non-integer, `null`, `''` and `'abc'` are clamped or refused and **never silently become 0**. Target: **164 → ≥215 assertions, all green.** |
| A2 | **Drag and reshape an existing drawing** | `verifyChartDrawings.mjs`: assert `handleAt()` returns the correct anchor index within tolerance and `null` just outside it; assert `moveDrawing` translates **both** anchors by the same delta and `reshapeDrawing` moves **only** the named one; assert a **locked** drawing is refused by both; assert a reshape that leaves an anchor unprojectable is refused rather than stored; assert anchors remain **absolute epoch seconds** after a move, so a drawing reshaped on 30m still places on daily — the round trip the suite already asserts for creation. Target: **135 → ≥180, all green.** |
| A3 | **Inline note editor**, replacing the last `window.prompt` | `verifyChartDrawings.mjs`: assert `setText` trims, caps at 280, and that an **empty** text on an existing note is a refusal rather than an empty note; assert a note's text survives save/load. Source-level assertion in the same suite style: **`PriceChart.jsx` contains no `window.prompt`** — the same shape as the existing assertions that count `fitContent` call sites. On screen: press `n`, click, type, `Enter` commits and `Escape` abandons; double-click an existing note to edit it. |
| A4 | **Session shading** on intraday charts | New `scripts/verifyChartSessions.mjs` wired into `npm run verify` as `verify:sessions`: assert `sessionBands()` returns `[]` for a daily series (where `sessionStarts` is empty by design) and one band per session for intraday; assert the band ends at the **last stored bar of that session**, not at a clock time, so a half-session is drawn as a half-session; assert alternating bands never overlap and are ordered; assert a single-bar session yields a zero-width band that is **omitted rather than drawn**; assert a series with a 3-day gap produces 3 bands, not one spanning the gap. On screen: a 30m NIFTY chart should show alternating faint bands with boundaries at the overnight gaps. |

### Phase B — renderer-only or near, but needing a call-site change or a second fetch. Next tranche.

| # | Item | Verification method |
| --- | --- | --- |
| B1 | Thread `coverage` through **all three** `PriceChart` call sites, then draw the **data-coverage and provider-cap bands** | `verifyChartSessions.mjs` (extended) for the band arithmetic: assert the asked-but-absent band is empty when the store covers the window, spans exactly the missing region when it does not, and that the cap band appears only for intervals with a non-null `PROVIDER_CAP_SESSIONS`. `auditRenderer.cjs` must stay clean. On screen: a 1m chart asked for 1M should hatch everything older than 5 sessions. |
| B2 | **Win-rate + expectancy strip** for the visible window | New pure module + suite: assert the two are computed from the same trade subset and that **the function cannot return one without the other** (a single return shape, asserted); assert an empty window returns `null` for both rather than `0%`/`0` — *"0% win rate"* is a claim the data does not make; assert the 40×1% / 10×5% case yields **80% and −0.20%**, which is the arithmetic master accepted. |
| B3 | **Position / P&L on the chart** in rupees and percent of investment | Extend `verifyPositionMath.mjs`: the sign must come from the position, not the exit side (already asserted for `closePreview`); assert the unrealised figure against the last stored close matches `closePreview` at that price; assert `null` for a position with no recorded average cost. |
| B4 | **Drawing colour / width UI**; **indicator presets** once A1 lands | `verifyChartDrawings.mjs`: width clamped 1–6, an unknown colour string refused rather than stored. `verifyIndicators.mjs`: a preset round-trips through `localStorage` and an unknown study id in a stored preset is dropped, not thrown on. |
| B5 | **CSV export of the visible window** | New assertions in the suite that owns the serialiser: the row count equals the visible bar count exactly (TradingView's honest constraint, adopted deliberately); the header names the symbol, interval and **the zone the timestamps are printed in**; enabled study outputs are included; `null` renders as empty, never as `0`. |
| B6 | **Pane maximise** (Kite's cheap version of pane management) | On screen only, and said so: a double-click on a study pane maximises it and restores. No arithmetic to assert. **Stated as unverifiable here rather than given a fake suite.** |

### Phase C — engine-dependent. Not attempted until the engine can be exercised.

| # | Item | Verification method |
| --- | --- | --- |
| C1 | **Series-returning engine endpoints** for the ~8 `advanced_features` generators that currently discard their arrays | Python-side assertion that the series' **last value equals the scalar the current function returns** — which makes the change provably non-breaking. Then `auditRenderer.cjs` for the new IPC channel. |
| C2 | **Backtest trades on the chart with real rupee charges + running expectancy** (4b.1) | Python: assert `cost_in_rupees` over a fixture that straddles `2026-04-01` prices the two legs at different rates and sets `ratesChangedMidTrade`; assert the **₹1,000 delivery round trip is ₹19.92 / 1.9925%** and the ₹1,00,000 one is ₹240.18 / 0.2402% (both **measured in this session**, so they are regression anchors, not estimates). Renderer: assert a gross-positive/net-negative trade renders as a loss. |
| C3 | **Cost-aware sizing badge + zero-lot refusal** (4b.2) | **First resolve the lot-size contradiction** (`dispatcher` 25 vs `strategy_spec` 75) and assert one source of truth. Then: ₹1,00,000 at 1% risk on NIFTY futures must produce the refusal, not a rounded-up lot. |
| C4 | **Charge-regime markers** (4b.6) | Assert a marker at every `RATE_HISTORY` boundary and a shaded region before `EARLIEST_KNOWN`; assert a `charge_watch` proposal draws as **pending** and can never write a rate — `charge_watch.propose` already refuses to. |
| C5 | **News markers with claim class** (4b.4) | Assert every marker carries a class and that **no `unattributed` item is ever returned to the renderer**, reusing `verifyClaimGate.cjs`'s vocabulary. Assert markers are queryable **by visible range**, per TradingView's documented marks model. |
| C6 | **Macro transmission annotation** (4b.5) | `macro.measure_link` already returns every field; assert the renderer maps `contradicted` to the refusal treatment and **never** to the supported one, and that `CONTROL` links are drawn as controls. Assert the multiple-comparison note from `measure_all` is always present when more than one link is drawn. |
| C7 | **Corporate-action markers and a declared adjustment state** | Needs a corporate-action dataset. Verification starts with asserting we can **state** our adjustment basis; a marker without a declared basis is worse than no marker. |
| C8 | **Comparison symbol in `%` scale** | Assert the second series is fetched for the same window and rendered on the percentage scale from the **first visible bar**, and that Zerodha's two published costs do not apply to us (no live ticks to stop, no web/app split). |
| C9 | **Replay over a cost-aware backtest** | Sierra Chart's lesson adopted: assert the replay **mode** is declared, and that a replayed trade's charges are the dated ones for its own date, not today's. |

### Phase D — deferred indefinitely, with the reason in Phase 4(a)

Order entry; depth ladder; order-flow footprint; tick/seconds bars; TPO; alert→order; always-on server alerts; mobile; hosted snapshot endpoint; anything needing a paid feed, a websocket or a broker credential.

---

# ⚠ NOT VERIFIED — read this before acting on anything above

**An admitted gap beats a plausible claim.** Everything in this section is something this document asserts on weaker evidence than the rest, or could not check at all. It is placed before the ready-to-paste blocks deliberately.

## N.1 Nothing in this document was seen on a screen

No chart was rendered. Every statement about what the chart *looks like* is read off source. In particular:

- **The RSI-in-its-own-pane fix (Section 120) and the drawing layer (Section 121) have never been seen drawn.** Ledger rows 140 and 141 say so themselves. This document repeats it rather than quietly treating them as working.
- **The zoom (Section 122) has never been seen on screen.** The measured figure in the header is the diagnostic; if it disagrees with the density master picked, the console carries `[PriceChart] zoom unverified:` with both numbers.
- Whether a drawn line lands **under the cursor** is a claim about `priceToCoordinate` / `timeToCoordinate` and cannot be checked here.
- `fillHeight`, pane heights, menu placement, the fullscreen layout and the accessible readout's actual screen-reader behaviour are all unverified.

## N.2 `vite build` cannot be run in this worktree

`node_modules` **is** installed in the main workspace (`c:\CodeBase\Velvet_UI\Velvet\Rama_AGI\node_modules`, including `lightweight-charts`), but it is **not** installed in `.worktrees\chart-landscape`, and the Phase 5 work happens in the worktree. Measured in this session:

| Command, run in the worktree | Result |
| --- | --- |
| `node scripts/verifyChartTime.mjs` | **197 passed, 0 failed** |
| `node scripts/verifyIndicators.mjs` | **164 passed, 0 failed** |
| `node scripts/verifyChartDrawings.mjs` | **135 passed, 0 failed** |
| `node scripts/verifyTimeframes.mjs` | **123 passed, 0 failed** |
| `node scripts/verifyPositionMath.mjs` | **107 passed, 0 failed** |
| `node scripts/verifySymbols.mjs` | **70 passed, 0 failed** |
| `node scripts/verifyGlossary.mjs` | **48 passed, 0 failed** |
| `node scripts/auditRenderer.cjs` | clean — stores, bridge calls, identifiers and IPC channels all resolve |
| `vite build` | **cannot run — no `node_modules` in the worktree.** Not attempted, not claimed. |
| the full `npm run verify` chain | **not run** — the `.cjs` suites in it require installed dependencies |

So the Phase 5 verification bar is: **the seven `.mjs` suites plus `auditRenderer.cjs`, all green, run from the worktree.** `vite build` must be run after merge, from the main workspace, and **this document does not claim it passes.**

## N.3 Everything that needs the Python engine

`numpy` is **not installed** for the Python 3.14.4 on this machine, so `from engine import ...` fails at `dispatcher.py`'s `import numpy as np`. `costs.py` was loaded **directly by file path** to get the charge figures, which is why those two numbers are measured and nothing else Python-side is.

| Unverified, engine-side | Status |
| --- | --- |
| `strategy_spec.cost_in_rupees` end-to-end over real trades | **Never run here.** Its return shape is read off source. Phase 4(b)(1) and the C2 verification depend on it. |
| `projection.project()` output | **Never run here.** The fields listed in Phase 4(b)(8) are read off source. |
| `macro.measure_link` on real series | **Never run here.** Every field in Phase 4(b)(5) is read off source. The `contradicted` path has not been observed firing. |
| `news.py` event dates, GDELT backfill, `coverage()` | **Never run here.** Needs network and `pandas`. |
| `advanced_features.py` — the claim that all eight generators discard their arrays | Read off source (467 lines, 8 generators, `compute_advanced_features` flattening to an `np.ndarray`). **Not executed.** |
| `derivatives.py` NSE bhavcopy ingestion | **Never run here.** Needs network. |
| Whether the engine has **ever completed a run on master's machine** | `chartZoom.js`'s own comment says it has not. Treated as true and is the reason sparse series are a design input rather than an edge case. |

### The one concrete engine defect found by reading, and NOT fixed

**`dispatcher.LOT_SIZES` says `NIFTY: 25`. `strategy_spec.py` says NIFTY is 75 units, in two places** — the validation warning (*"NIFTY is 75 units"*) and the `cost_in_rupees` docstring (*"4 units of a 75-unit NIFTY contract is 0 lots"*). They disagree by a factor of three. **Lot size is the denominator of the zero-lot refusal**, so this is not cosmetic: it changes whether a trade is reported as placeable. Not touched, because the engine cannot be exercised here and a blind edit to a sizing constant is exactly the wrong kind of change. **Carried into the ledger row's NEXT list.**

## N.4 Research facts that could not be confirmed

### Cluster C in its entirety is unverified

**No Cluster C claim was read off a live page.** Outbound HTTPS was blocked (`SEC_E_ILLEGAL_MESSAGE` at the TLS handshake). Every row carries its own confidence (`high` / `med` / `low` / `unconfirmed`) and that confidence travels with every count in Phase 1.4 and Phase 3. The specific open questions, carried forward verbatim in substance from that file's own queue:

1. On a second-symbol comparison, which axis is the overlaid series drawn on, and can the user switch between shared / own / percent-normalised? (all five)
2. Does a bar-replay mode exist, and is it plan-gated? (StockCharts, Barchart, TrendSpider, Investing.com)
3. Is the economic-events marker layer enabled on Investing.com's advanced chart? — would be the best macro-on-chart precedent if so
4. Full drawing-tool inventory and count per platform (deliberately not estimated)
5. Magnet / snap availability and modes
6. Declared corporate-action adjustment policy, and whether an unadjusted series is selectable
7. Which non-time chart types are actually in each chart-type dropdown
8. Volume-profile tooling: visible vs fixed range, and value-area/POC semantics
9. Documented keyboard-shortcut maps
10. Published dates for every cited page — **currently `unconfirmed (no network access)` for all five**
11. Broker integrations, and whether positions/P&L render on the chart
12. Any stated or observable bar-count performance ceiling

### Bloomberg Terminal: all 44 axes out of evidence

Every request to `bloomberg.com/professional/*` returned **HTTP 403**; real documentation is subscriber-gated. **Nothing is asserted, including things widely believed about the product.** Bloomberg is excluded from every count in this document. Filling the cell needs terminal access or a Bloomberg-published PDF from an egress its edge does not block. **Treated as out of evidence, never as a zero.**

### Cluster B limitations that affect specific rows

| Gap | Effect |
| --- | --- |
| **FYERS KB article bodies** | `support.fyers.in` is a client-rendered Zoho Desk portal returning the same 26 KB shell for every article URL. FYERS rows confirm a documented topic **exists** (order-flow chart, hotkeys, advanced scales, multi-chart layouts, FIA chart actions) from the vendor's own `llms-full.txt` index — **not the behaviour described inside.** The FIA precedent in §1.3(4), which this document leans on, is **topic titles only**. |
| **ICICI Direct** | No charting documentation published anywhere. `?` on ~40 of 55 axes. A vendor documentation gap, not a research shortcut. |
| **Groww** | A 956-article support sitemap with **not one** article matching chart, indicator, alert, candle or technical. Every Groww row rests on one product page. |
| **Dhan** | `help.dhan.co` / `support.dhan.co` resolve to nothing. Rows rest on two product pages. |
| **Which TradingView edition each broker licensed** | **No broker states it.** Where a broker claims a Trading-Platform-only feature, the claim is the broker's and the edition is never inferred. This weakens every Cluster B row for a Trading-Platform-only axis. |
| **Search engines** | DuckDuckGo (HTML and Lite), Bing and Mojeek all returned anomaly/consent pages. All discovery was by crawling sitemaps, `robots.txt` and `llms.txt`, which **biases coverage toward vendors publishing a crawlable corpus** — exactly why Zerodha and FYERS are best covered and Groww and ICICI Direct worst. |
| **`Y (claim)` rows generally** | Upstox, Groww, Dhan, FYERS and Angel One publish feature claims on **marketing pages** with little chart documentation. Every such row is a vendor claim and is **never** promoted to verified behaviour. |

### Counts in Phase 1.4 are floors, not totals

Several are derived by counting documented entries (help-centre sitemap slugs, reference-list bullets, table rows) rather than vendor-stated. Where a vendor states a number it is attributed; where it was derived the derivation is stated in the source cluster file so it can be re-checked. **A count of 72 documented TradingView drawing tools against a claimed 110+ is a floor and a claim, not two facts.** The MT5 **44-vs-46** inconsistency is the vendor's own, in its own pages, and both numbers are recorded rather than one being picked.

### Published dates

**Only IBKR prints one: "Last updated on October 8, 2025."** Every other vendor in all three clusters prints a copyright year only. The strongest available claim for them is "current as of the 2026-10-01 retrieval". **No date is guessed anywhere in this document.**

## N.5 Claims in this document that are design judgement, not evidence

Said plainly so a later session can disagree with them on the merits:

- **That session shading is worth building for the 375-minute boundary** rather than for extended hours. Only 4 of 22 surfaces shade sessions at all, and **no Indian broker documents it** — because NSE retail has no extended-hours trading. The argument is that the *overnight gap* is the thing worth seeing on intraday bars, not the pre-market. That is a judgement about master's reading, not a researched requirement.
- **That percent-comparison is more valuable than inverted scale or a scale lock**, based on relative performance against NIFTY being the common Indian retail question. Reasonable; unmeasured.
- **That OI-on-chart beats TPO for NSE.** This follows Cluster B's own finding #8 and our existing `derivatives.py`, but it is an inference, not something a vendor states.
- **That a hold-to-snap modifier is the only magnet form consistent with "master's marks are never adjusted on his behalf."** A defensible reading of an existing locked decision, not a new one — but it is a reading.
- **That three `wf-coder` features is the right decomposition of the Phase 5 tranche.** Reasoned from file boundaries and suite boundaries, below.

---

# PHASE 5 PLAN — the bounded, RENDERER-ONLY first tranche

**Scope rule for this tranche, and it is absolute: NO PYTHON CHANGE.** The engine cannot be exercised in this environment (`numpy` is absent; see N.3), so an engine-dependent change is **unverifiable** and must not be attempted. Every item below is a pure function of the visible bars or of master's own stored inputs, and every item is verifiable by a `.mjs` suite that runs in this worktree with no `node_modules`.

**Tranche contents, and why these four.** The recommended tranche is adopted unchanged, with one scoping decision recorded: **data-coverage shading is NOT in it** (it was a candidate), because `coverage` reaches only one of the three `PriceChart` call sites and a band that appears in one place of three is a half-feature; threading it through `StockMind.jsx` and `PopoutPanel.jsx` first is Phase B item B1. Session shading **is** in, because `sessionStarts()` already exists, is already tested, and needs nothing from any call site.

| # | Item | Why it earns its place |
| --- | --- | --- |
| 1 | **Editable indicator parameters** | 19 of 22 researched surfaces have it — **the most universal feature in the entire research** — and all 22 of our studies are period-locked. Named as the top remaining gap by ledger rows 140, 141 **and** 142. |
| 2 | **Drag and reshape an existing drawing** | **The cheapest large win.** `hitTest`, `distanceToSegment`, `distanceToRay`, `nearRectEdge` and `project`/`unproject` already exist and are covered by 135 assertions. Handles already render. Only the mutators and the drag state are missing. |
| 3 | **Inline note editor** | The last `window.prompt` in the chart, and Section 102 removed the previous one from a money path for stated reasons. Also the only way to ever **edit** an existing note. Small, and it finishes item 2's story. |
| 4 | **Session shading** | Pure arithmetic on visible bars, uses the already-tested `sessionStarts()`, and makes the 375-minute NSE session boundary visible so an overnight gap is not misread as a move. |

**The additive contract for all four** (invariant I11 — upgrades never remove a capability and always provide a fallback):

- Every new `PriceChart` prop is **optional with a default that reproduces today's behaviour exactly**. All three existing call sites — `StockMind.jsx` tab chart, `StockMind.jsx` workspace panel, `PopoutPanel.jsx` — must keep working **unchanged**. None of them is edited in this tranche.
- Every new function argument is **optional**, and omitting it must be **value-identical** to today. This is asserted, not assumed.
- `OVERLAY_NEEDS` stays exported with exactly its current values; the new `needsFor()` is additive and must agree with it on defaults.
- `chartTime.js` and `chartZoom.js` are **not modified**. `verifyChartTime.mjs`'s **197 assertions must still pass unchanged.**
- No new dependency. `lightweight-charts` 5.2.1 stays pinned.
- No `console.log` — `console.warn` / `console.error` only. No placeholders, no TODOs, no stubs. Comments explain **why** and record defects, in the existing voice.

---

## Item 1 — Editable indicator parameters for all 22 studies

### Files

| File | Change |
| --- | --- |
| `src/pages/StockMind/indicators.js` | **modify** — add a `params` schema per `OVERLAY_DEFS` entry; change every `make` to accept an optional params object; add `defaultsFor`, `resolveParams`, `needsFor`, `labelFor`; extend `overlayShortfall` with an optional 4th argument |
| `src/pages/StockMind/PriceChart.jsx` | **modify** — new `overlayParams` state, persisted in the existing prefs key; pass params into `def.make`; per-study numeric fields in the existing indicators menu; live labels |
| `src/pages/StockMind/glossary.js` | **modify** — add the `indicatorPeriod` term |
| `scripts/verifyIndicators.mjs` | **modify** — new assertions |

### Approach

**The fallback IS the current literal.** Every `make` becomes `(b, p) => sma(b, intParam(p?.period, 20))`, where `intParam(v, fallback)` is a local helper in `indicators.js`. So `def.make(candles)` — the call `PriceChart` makes today — produces **byte-identical output**, and the diff is provably non-behavioural until a parameter is actually changed.

`intParam` must honour the lesson that has now appeared **four times** in this project (`Number(null) === 0` in `modelRoles`, Section 112; `int(s.get("lotSize") or 1)` swallowing an explicit 0, Section 115; `clampPxPerBar(null)` returning a 1px smear, Section 122):

> **Absent is not zero.** `null`, `undefined`, `''`, `NaN` and a non-numeric string all mean *use the default*. Zero means zero and is therefore **out of range** for every period in this module, and must be clamped or refused — never silently accepted as "no smoothing".

`params` schema per entry: `[{ key, label, kind: 'int'|'float', min, max, step, default }]`. Minimums are chosen per study rather than globally: a 1-period SMA is legal-but-pointless, a 1-period RSI is division by a zero-length window, and Bollinger's σ multiplier is a float where every period is an int.

`OVERLAY_NEEDS` becomes **the defaults row of a function, not the whole truth**. New `needsFor(id, params)` computes the bar requirement from the live parameters, mirroring the three hard-won corrections exactly:

| Study family | `needsFor` formula | Must equal `OVERLAY_NEEDS` at defaults |
| --- | --- | --- |
| `sma`, `cci`, `williams`, `bb` | `n` | 20, 20, 14, 20 ✓ |
| `ema` | `n` | 21 ✓ |
| `rsi`, `atrPct`, `mfi`, `roc` | `n + 1` | 15, 15, 15, 13 ✓ |
| `donchian`, `keltner` | `n + 1` / `max(emaN, atrN) + 1` | 21, 21 ✓ |
| `supertrend` | `atrN + 2` | 12 ✓ |
| `macd` | `slow + signal − 1` | 26 + 9 − 1 = **34** ✓ |
| `stoch` | `k + smoothK + d − 2` | 14 + 3 + 3 − 2 = **18** ✓ |
| `ichimoku` | `senkouB + displacement` | 52 + 26 = **78** ✓ |
| `adx` | `2n + 1` | 29 ✓ |
| `obv`, `psar`, `pivots`, `vwap` | constant 2, 3, 2, 1 | ✓ |

`overlayShortfall(id, barCount, intradayInterval, params)` — the 4th argument is optional and omitted means defaults, so the existing three call sites in `PriceChart` are untouched by signature.

`labelFor(def, params)` returns `'SMA 50'` when the period is 50, so the menu, the legend and the accessible readout all say what is actually drawn. **A label that still reads "SMA 20" while drawing a 50-period average is a worse defect than no parameter editing at all**, which is why this is part of the same item and not a follow-up.

`PriceChart` state: `overlayParams` as `{ [id]: { [key]: number } }`, persisted inside the **existing** `rama.stockmind.chart` key as a new optional `overlayParams` field. `loadPrefs` already tolerates an unknown shape and returns `null` on a parse failure, so an old stored preference loads with **no params and therefore today's defaults** — the fallback path is the upgrade path. On read, each stored value goes through `resolveParams`, so a hand-edited or stale store cannot put an out-of-range period into a study.

UI: inside the existing indicators menu, an **enabled** study expands to show one compact numeric input per parameter (the existing `.input` class), with the `OVERLAY_NEEDS` consequence shown live — *"needs 200 bars, there are 180"* — reusing `overlayShortfall`'s own sentence. A single `?` beside the parameter row, `<InfoTip id="indicatorPeriod" />`.

### Glossary entry required (or `verifyGlossary.mjs` fails)

```
indicatorPeriod: {
  term: 'Indicator period', group: 'overlays',
  short: 'How many bars a study averages over. Yours to set, and the label follows it.',
  long: '...explains that a period is a window length in BARS, so the same number means a '
    + 'different span on every interval — a 14-period RSI is 14 days on daily bars and 7 hours '
    + 'on 30-minute ones; that a longer period needs more history before the study can draw '
    + 'anything at all, which is why the bar requirement moves with the setting; and that '
    + 'Rama never changes a period on your behalf.',
  seeAlso: ['overlay', 'interval', 'bars'],
},
```

Constraints the suite enforces and this entry must satisfy: `short` ≤ 130 characters and ending in a full stop; `long` longer than `short` and ≤ 700 characters; at least eight substantive words in `long` that are not in the term's own name; the display name unique across all terms; `group` one of the declared 12; every `seeAlso` id resolving. The term is reachable via its own `InfoTip`, so the orphan check passes.

### Verification — wires into `npm run verify:indicators` (already in the `verify` chain)

New assertions in `scripts/verifyIndicators.mjs`, in its existing `check(label, ok, detail)` style:

1. **Every one of the 22 entries declares a `params` array** (possibly empty, for `obv`/`psar`/`pivots`/`vwap`), and every entry in it has `key`, `label`, `kind`, `min`, `max`, `step`, `default`.
2. **The defaults reproduce the current literals exactly**, asserted per study by name: `sma20.period === 20`, `sma50 === 50`, `sma200 === 200`, `ema21 === 21`, `bb === {period:20, mult:2}`, `rsi14 === 14`, `macd === {fast:12, slow:26, signal:9}`, `donchian === 20`, `keltner === {ema:20, atr:20, mult:2}`, `supertrend === {atr:10, mult:3}`, `ichimoku === {tenkan:9, kijun:26, senkouB:52}`, `atrPct === 14`, `adx === 14`, `stoch === {k:14, smoothK:3, d:3}`, `williams === 14`, `cci === 20`, `mfi === 14`, `roc === 12`.
3. **`make(bars)` is value-identical to `make(bars, defaultsFor(id))`** for all 22 — deep-compared, not length-compared. **This is the assertion that proves the change is additive.**
4. **`needsFor(id, defaultsFor(id)) === OVERLAY_NEEDS[id]` for all 22**, which pins the three corrected thresholds (`macd: 34`, `ichimoku: 78`, `stoch: 18`) against the new formula rather than against a copied number.
5. **`needsFor` moves with the parameter**: `sma` at 10 needs 10 and at 300 needs 300; `macd` at `{12,26,9}` needs 34 and at `{5,13,4}` needs 16; `ichimoku` at `{9,26,52}` needs 78 and at `{7,22,44}` needs 66; `stoch` at `{5,2,2}` needs 7.
6. **A changed period actually changes the output**: `sma` at 10 and at 50 differ in both length and value on the same fixture — so the parameter is proven to reach the arithmetic rather than only the label.
7. **`intParam` / `resolveParams` refuse the absent-is-not-zero trap**: `null`, `undefined`, `''`, `NaN`, `'abc'`, `{}` and `[]` all yield the **default**, never `0` and never the minimum. Asserted individually, because this exact shape has shipped as a defect three times.
8. **Clamping both ways**: a period above `max` clamps to `max`, below `min` clamps to `min`, a float where an int is declared is rounded, and `'20'` as a string is honoured as 20 (form fields supply strings).
9. **`labelFor`** returns the stock label at defaults — `labelFor(sma20, {})` is exactly `'SMA 20'` — and the changed label otherwise.
10. **`overlayShortfall` with no 4th argument is identical to today**, and with a raised period reports the raised requirement.
11. **Both exclusions survive by name**: `vwap` still intraday-only, `pivots` still daily-or-longer, whatever their params. (The existing suite already asserts these by name rather than by a net count, after a net count was found able to pass while both were broken.)

**Target: 164 → ≥ 215 assertions, all green.** `verifyGlossary.mjs` must stay at 48+ and green — it will fail loudly if `indicatorPeriod` is missing or malformed.

---

## Item 2 — Drag and reshape an existing drawing

### Files

| File | Change |
| --- | --- |
| `src/pages/StockMind/chartDrawings.js` | **modify** — add `HANDLE_TOL`, `handleAt`, `moveDrawing`, `reshapeDrawing`, `replacePoints` |
| `src/pages/StockMind/PriceChart.jsx` | **modify** — drag state in the existing `pointer` ref and the existing `down`/`move`/`up` handlers |
| `scripts/verifyChartDrawings.mjs` | **modify** — new assertions |

### Approach

**All the arithmetic goes in `chartDrawings.js`, pure and tested; `PriceChart` only wires the pointer.** That is the split Section 121 earned and it is why this item is cheap: if a mark lands wrong, the arithmetic and the pixel conversion are two different bugs to look for.

New pure functions:

- `handleAt(drawing, at, project, opts)` → the **index** of the anchor under the pointer, or `null`. Tolerance defaults to `HANDLE_TOL = 8`, slightly wider than `hitTest`'s 6 **so grabbing a handle beats grabbing the body**, which is the behaviour every platform has and nobody documents. A **locked** drawing returns `null` — locking already means *cannot be selected*, and it must now also mean *cannot be moved*. An anchor the chart cannot project returns `null`, never a clamped guess, exactly as `hitTest` already does.
- `moveDrawing(drawing, dTime, dPrice)` → a new drawing with **every** anchor translated by the same delta. Returns the **original object unchanged** for a locked drawing and for a non-finite delta, so a caller can never store a half-moved mark.
- `reshapeDrawing(drawing, index, point)` → a new drawing with **only** anchor `index` replaced. Refuses a locked drawing, an out-of-range index, and a point whose time or price is not finite.
- Both go through the same validation `makeDrawing` uses, and both **preserve `id`, `text`, `color`, `width`, `locked` and `createdAt`** — a move is not a new drawing, and losing `createdAt` would silently reorder master's own history.

**Anchors stay absolute epoch seconds through a move.** This is the decision from Section 121 and the move path must not quietly break it: the delta arrives from `unproject` in the **chart's** time type, and is converted via `toEpoch` before it touches the store. The suite asserts the round trip the creation path already asserts — a drawing reshaped on a 30m chart still places on daily.

`PriceChart` wiring, inside the existing effect, no new listener:

- `down` with **no tool armed**: first `handleAt` on the currently selected drawing → if hit, begin a **reshape** drag on that index; else `hitTest` → if hit, select it **and** begin a **move** drag; else deselect. The current behaviour (select or deselect) is the `else` branch, so nothing is removed.
- `handleScroll` / `handleScale` are disabled **only for the duration of the drag**, the same contract the draw drag already uses and for the same reason — a drag that both reshapes a line and pans the chart produces neither.
- `move` applies `moveDrawing` / `reshapeDrawing` to a **working copy**; `up` commits once. `Escape` mid-drag restores the pre-drag drawing, because a half-dragged mark is not master's claim.
- The cursor becomes `move` over a body and `nwse-resize` over a handle, so the chart's behaviour is predictable before the button goes down.
- Persistence is unchanged: the existing save-on-change effect covers it, so a crash mid-session loses nothing.

### Verification — wires into `npm run verify:drawings` (already in the `verify` chain)

New assertions in `scripts/verifyChartDrawings.mjs`, using its existing `check`/`near` helpers and its in-memory `localStorage` stand-in:

1. **`handleAt` hits each anchor and misses between them**: a trendline's two anchors are each found within `HANDLE_TOL`, and a probe at the segment midpoint returns `null` — because grabbing the middle must move the whole line, not an end.
2. **`handleAt` tolerance exceeds `hitTest`'s**, asserted numerically (`HANDLE_TOL > 6`), so handle-beats-body is a property rather than an ordering accident in the component.
3. **A locked drawing yields `null` from `handleAt`** and is returned **unchanged** by both `moveDrawing` and `reshapeDrawing` — three assertions, matching the three existing locking assertions.
4. **`moveDrawing` translates every anchor by the same delta**, asserted on a 2-point trendline, a 1-point horizontal and a 2-point Fibonacci.
5. **`reshapeDrawing` moves only the named anchor** and leaves the other bit-identical.
6. **Identity is preserved**: `id`, `text`, `color`, `width`, `locked` and `createdAt` survive both operations.
7. **An out-of-range index, a negative index, a non-finite price and a null time are each refused** — the drawing comes back unchanged rather than corrupted.
8. **Anchors are still absolute epoch seconds after a move**, and the moved drawing still `placed()`s as a date string on daily and an epoch number on intraday — the same round trip the suite already asserts for creation.
9. **A Fibonacci set reshaped by its first anchor re-derives every level**: `fibLines` after the reshape matches the arithmetic from the new anchor pair, so level 0 is still the **first** anchor.
10. **A move survives save → load**: the moved anchors are what come back, and the store's read-time validation accepts them.
11. **A measure is never moveable**, because it is never stored — `transient: true` is refused in the store and again at the commit point, and the move path must not create a third way in.

**Target: 135 → ≥ 180 assertions, all green.**

---

## Item 3 — Inline note editor, replacing the last `window.prompt`

### Files

| File | Change |
| --- | --- |
| `src/pages/StockMind/chartDrawings.js` | **modify** — add `setText(drawings, id, text)` and `MAX_NOTE_CHARS` |
| `src/pages/StockMind/PriceChart.jsx` | **modify** — a small positioned editor replacing the `window.prompt` call; double-click an existing note to edit |
| `src/pages/StockMind/glossary.js` | **modify** — add the `chartNote` term |
| `scripts/verifyChartDrawings.mjs` | **modify** — new assertions |

### Approach

`window.prompt` is removed from `PriceChart.jsx` entirely. In its place: arming `n` and clicking places a **draft** note at the clicked anchor and opens a one-line text input positioned at that anchor's pixel coordinates (from the same `project` the layer already exposes). `Enter` commits, `Escape` abandons the draft **and the tool**, and clicking away commits a non-empty note or abandons an empty one.

**An empty note is never created** — that rule already exists in the `window.prompt` branch (`if (tool === 'text' && !text) { setTool(null); return; }`) and is preserved exactly.

Editing an existing note: **double-click** opens the same editor seeded with its current text. `setText` with an empty string on an **existing** note is a **refusal, not a deletion** — deletion is `Delete`, and silently converting an edit into a delete would lose master's own words. `MAX_NOTE_CHARS = 280` is exported so the model and the input agree on one number instead of two.

The editor is a plain focused `<input>`, not a modal: it must not steal the chart's keyboard handler for the rest of the session, which is exactly the failure a prompt cannot have and an inline editor can. `Escape` handling inside the input stops propagation so it abandons the note rather than also leaving fullscreen.

### Glossary entry required

```
chartNote: {
  term: 'Note on the chart', group: 'chart',
  short: 'A sentence pinned at a point on the chart — why you did something.',
  long: '...explains that a note is anchored to a time and a price, so it travels with the bar '
    + 'it is about across every zoom, pan and interval change rather than sitting at a fixed '
    + 'place on the screen; that notes are kept per instrument and are never generated, edited '
    + 'or summarised by Rama; and that an empty note is refused rather than stored, because an '
    + 'empty marker on a chart is something you will have to click to discover means nothing.',
  seeAlso: ['candles', 'instrument'],
},
```

Same `verifyGlossary.mjs` constraints as item 1. Reachable via its own `InfoTip` beside the drawing-tools menu.

### Verification — `npm run verify:drawings` and `npm run verify:glossary`

1. **`setText` trims and caps at `MAX_NOTE_CHARS`**, and the cap is asserted against the model's own constant rather than a literal `280` in the test.
2. **An empty or whitespace-only text on an existing note is refused** — the note comes back with its original text.
3. **`setText` on a non-existent id is a no-op**, returning the list unchanged.
4. **`setText` on a locked note is refused.**
5. **`makeDrawing('text', [...], { text: '' })` still returns a drawing with `text: null`**, and the component's empty-note refusal is what prevents it being created — the existing behaviour, asserted so it is not lost.
6. **Text survives save → load**, including a 280-character note and a note containing quotes and a newline.
7. **Source-level assertion, in the same style as the existing `fitContent` call-site count**: `src/pages/StockMind/PriceChart.jsx` contains **no `window.prompt`**. This is the assertion that makes the removal permanent.

**On screen (master's check, stated as unverifiable here):** press `n`, click a candle, type, `Enter`. The note should appear with a backing plate. Double-click it; the text should be editable in place. `Escape` on a new note should leave nothing behind.

---

## Item 4 — Session shading

### Files

| File | Change |
| --- | --- |
| `src/pages/StockMind/chartSessions.js` | **new** — pure: `sessionBands(candles, opts)`, `describeBands` |
| `src/pages/StockMind/ChartSessionLayer.js` | **new** — a second `lightweight-charts` series primitive, `zOrder: 'bottom'` |
| `src/pages/StockMind/PriceChart.jsx` | **modify** — attach the layer, a `sessions` entry in the existing `layers` toggle state, a chip beside the existing fills/levels/projection chips |
| `src/pages/StockMind/glossary.js` | **modify** — add the `sessionBand` term |
| `scripts/verifyChartSessions.mjs` | **new** — the suite |
| `package.json` | **modify** — add `verify:sessions` and append it to the `verify` chain |

### Approach

`sessionBands(candles)` consumes the **already-converted** candles and reuses the already-tested `sessionStarts()` from `chartTime.js` — **it does not re-derive session boundaries, and it must not.** For each session it returns `{ ymd, from, to, index }`, where `from` is that session's first stored bar and `to` is its **last stored bar**, not a clock time. That distinction is the whole correctness of the feature:

> **A half-session must draw as a half-session.** Painting to 15:30 when the store holds bars only to 11:45 would be drawing a session that did not happen — the same class of error as synthesising 26 future timestamps to make Ichimoku's cloud look complete, which Section 120 refused.

**A daily or longer chart returns `[]`.** `sessionStarts` is empty by design there (its times are already dates), and alternating bands on a daily chart would shade calendar days, which means nothing. The function returns an empty array rather than guessing; the chip hides itself when there are no bands.

Bands **alternate** so the boundary is the information, not the colour: even-indexed sessions get a faint tint, odd ones nothing. A **zero-width** band — a session with one stored bar — is **omitted rather than drawn**, because a 1px stripe reads as a rendering artefact. A multi-day gap produces **separate** bands, never one spanning the gap; that is the assertion that proves the feature is doing the thing it exists for.

`ChartSessionLayer.js` mirrors `ChartDrawingLayer.js` deliberately: a series primitive (not a pane primitive) attached to the price series, `project` via `timeScale().timeToCoordinate`, `useBitmapCoordinateSpace` for the fill, and **`zOrder: () => 'bottom'`** so bands sit under candles, volume and every drawing. It reads live state on every draw, exactly as the drawing layer does. It is the **second** primitive Rāma has, and it is thin for the same stated reason: the arithmetic is in a tested module and the pixel conversion is here, so a misplaced band is one bug or the other, never both.

Toggleable via the existing `layers` state (`layers.sessions`), persisted alongside the other chart preferences, **default on for intraday and irrelevant for daily**. The chip reads `sessions` and is hidden when `sessionBands` returns `[]`.

### Glossary entry required

```
sessionBand: {
  term: 'Session band', group: 'chart',
  short: 'A faint band per trading day on intraday bars, so the overnight gap is visible.',
  long: '...explains that the NSE and BSE cash session runs 09:15 to 15:30 IST, 375 minutes, '
    + 'and that intraday bars from different days sit side by side on the chart with nothing '
    + 'between them — so a gap that happened overnight can be read as a move that happened in '
    + 'minutes; that each band starts and ends at a REAL STORED BAR rather than at a clock '
    + 'time, so a part-loaded day is drawn as a part-loaded day; and that daily bars get no '
    + 'bands, because there a day is already one candle.',
  seeAlso: ['interval', 'candles'],
},
```

### Verification — new `scripts/verifyChartSessions.mjs`, wired into `npm run verify`

`package.json`: add `"verify:sessions": "node scripts/verifyChartSessions.mjs"` and append `&& node scripts/verifyChartSessions.mjs` to the `verify` chain, **immediately after `verifyChartDrawings.mjs`** so the chart suites stay together.

Assertions, in the existing suite style (its own `check`, fixtures built in-file, no `node_modules`):

1. **A daily series returns `[]`** — three fixtures: all date strings, one bar, and an empty array.
2. **A one-session intraday series returns exactly one band**, with `from` equal to the first bar's time and `to` equal to the **last** bar's time.
3. **A three-session series returns three bands**, in time order, with no overlap — asserted as `band[i].to <= band[i+1].from` across the set.
4. **A 3-day gap in the middle produces 3 bands, not one spanning the gap** — the headline assertion.
5. **A session holding one bar yields a zero-width band that is omitted**, so the returned count is less than the session count and the discrepancy is deliberate.
6. **Indices alternate from 0** and the parity is stable under a leading partial session, so the tint does not flip when earlier history loads.
7. **UTC is preserved**: the band times are the stored epoch seconds unchanged, never shifted by a local offset — the Section 118 rule, asserted here too because this module consumes those times. A fixture built around the 09:15 IST open (03:45 UTC) must band it in the same session as the 15:30 IST close (10:00 UTC), and a bar at 18:30 UTC must land in the **next** session.
8. **`sessionBands` is a pure function of its input**: called twice on the same array it returns deep-equal output and does not mutate the input (asserted by comparing a snapshot of the input before and after).
9. **Junk is survived, not thrown on**: `null`, `undefined`, `[]`, an array of `null`s, a mixed array of strings and numbers, and bars with `NaN` times all return `[]` rather than throwing — **this function runs inside a renderer and must never take the chart down with it**, the same rule the drawing store's read-time validation follows.
10. **`describeBands`** returns a one-line summary for the accessible readout — `'3 sessions shaded, 18 Sep to 20 Sep'` — and `''` when there are no bands, never a sentence about zero sessions.

**Target: a new suite at ≥ 40 assertions, green, and `npm run verify`'s chart suites unchanged in count except where this plan says otherwise.**

---

## The verification bar for the whole tranche

Run **from the worktree** (`c:\CodeBase\Velvet_UI\Velvet\Rama_AGI\.worktrees\chart-landscape`), where all of these work without `node_modules`:

```
node scripts/verifyChartTime.mjs       # MUST stay 197, green — chartTime.js and chartZoom.js untouched
node scripts/verifyIndicators.mjs      # 164 -> >=215, green
node scripts/verifyChartDrawings.mjs   # 135 -> >=180, green
node scripts/verifyChartSessions.mjs   # new, >=40, green
node scripts/verifyGlossary.mjs        # 48+, green — fails if any new InfoTip id lacks a term
node scripts/verifyTimeframes.mjs      # 123, green
node scripts/verifyPositionMath.mjs    # 107, green
node scripts/verifySymbols.mjs         # 70, green
node scripts/auditRenderer.cjs         # clean
node --check on any .cjs touched       # (none expected in this tranche)
```

**`vite build` cannot be run in the worktree and must not be claimed.** It is run after merge, from the main workspace where `node_modules` is installed. Say so plainly in the commit body and in the ledger row.

## Commit discipline for the tranche

Project convention, non-negotiable: write the message to a file, commit with `git commit -F <absolute path>`, then **delete the file in a separate command**. Format `type(scope): description`. Push to **both** `dev` and `source` (invariant I13) — **at merge time, not per feature.** Suggested commits, one per item, each self-contained and leaving the suites green:

```
feat(chart): indicator periods are master's to set, and the label follows
feat(chart): existing drawings can be moved and reshaped
fix(chart): the last window.prompt leaves the chart — notes are edited in place
feat(chart): the session boundary is visible, and a part-loaded day looks like one
```

## What this tranche deliberately does NOT do

- **No Python change.** Unverifiable here.
- **No call-site change.** `StockMind.jsx` and `PopoutPanel.jsx` are untouched, which is what makes the additive contract checkable.
- **No `chartTime.js` or `chartZoom.js` change.** 197 assertions stay green, and the measured-zoom header is not regressed.
- **No new dependency.**
- **No magnet / snap**, even though it would make reshaping feel better. `chartDrawings.js` states that master's marks are never snapped to a "better" level on his behalf; a hold-to-snap modifier is the only form consistent with that, and it is a separate decision for master to make rather than one to slip in alongside a drag.

---

# READY-TO-PASTE BLOCK (a) — spec section

> Paste verbatim into `RAMA_AGI_MASTER_SPEC.md`. **This document does not write to the spec** — a second workflow is editing it concurrently.

---

## SECTION 123 — THE CHART LANDSCAPE, THE GAP MATRIX, AND THE SEVEN THINGS NOBODY SELLS

*Written before implementing, per Section 28's working agreement.*

Master: *"From the so far experience we can understand charts is not simple implementation, so do these: 1. Do the extensive analysis for each and every feature in the charts, draw research from all the famous/popular trading apps and their implementation. note it down; compare our implementation and understand the gap and also align the implementation to our need/requirement in stockmind actual behavior."*

Four sections (110, 119, 120, 122) each changed the chart and each ended with master reporting something still wrong. **The pattern across all four is the same: a decision was taken without knowing what the rest of the industry had decided, so each fix was a guess at a settled question.** This section ends the guessing. The full research, the counted inventory, the gap matrix and the implementation plan live in `docs/research/CHART_LANDSCAPE.md` with the three source cluster files beside it; what follows is the decision record.

### 123.1 What was researched, and what the evidence is actually worth

**23 platform surfaces across three clusters.** Cluster A — TradingView, Thinkorswim, MetaTrader 5, NinjaTrader 8, Sierra Chart, IBKR TWS, Bloomberg, Koyfin — read off live official vendor documentation, ~255 inline citations, no blogs or forums. Cluster B — Kite on **both** its engines, Upstox, Groww, Dhan, FYERS, Angel One, ICICI Direct, Trendlyne, Sensibull — the same method plus vendor sitemaps and `llms.txt` indexes, and **the cluster that matters most, because it is the market master trades**. Cluster C — StockCharts, Barchart, Investing.com, TrendSpider, Finviz — **failed: outbound HTTPS was blocked at the TLS handshake, so not one Cluster C claim was read off a live page.** Every Cluster C row carries its own confidence level and is used for design ideas and counting, never as proof. **Bloomberg returned HTTP 403 on every path and all 44 of its axes are out of evidence — excluded from every count, treated as out of evidence rather than as a zero.** **Only IBKR prints a revision date** (2025-10-08); every other vendor in all three clusters prints a copyright year, so the strongest claim for them is "current as of the 2026-10-01 retrieval". No date is guessed. **Content was rephrased for compliance with licensing restrictions.**

### 123.2 THE SIX STRUCTURAL FINDINGS, which matter more than any feature row

**(1) SIX OF SEVEN INDIAN BROKERS DO NOT WRITE THEIR OWN CHART ENGINE, AND THE LIBRARY EDITION CAPS THE FEATURE SET BEFORE THE BROKER WRITES A LINE OF CODE.** TradingView publishes the split: Advanced Charts (free) **excludes Renko, Point & Figure, Line Break and Kagi outright**, and multi-chart layout, crosshair/interval/time sync, DOM, order entry, position and P&L overlay, **drawing templates** and seconds-from-ticks are all **Trading Platform only**. No broker states which edition it licensed, so a broker claiming a Trading-Platform-only feature is recorded as the broker's claim and the edition is never inferred. **Consequence for us: a long tail of apparent industry standards is one vendor's premium tier, and StockMind — built directly on `lightweight-charts` 5.2.1 with its plugin surface available — has no such ceiling.** Zerodha states the sharpest version: Kite uses a built-in indicator library, **not** the public tradingview.com one, so community and Pine indicators are unavailable inside Kite.

**(2) THE REFERENCE IMPLEMENTATION DELIBERATELY DOES NOT PERSIST THE VISIBLE RANGE.** A saved TradingView layout does not include the visible time range; the library always re-opens on the newest data and exposes `setVisibleRange({from})` as an explicit **post-load** call. **This is the documented vendor explanation for the class of defect master reported three times as "default zoom not working" — and it confirms Section 122's fix as the correct shape rather than a workaround:** an explicit initial-range policy applied after data load, with a measured read-back. Thinkorswim offers the opposite as an opt-in named **"Keep time zoom"**; Koyfin specifies zoom as *how much history* — scrolling holds the end date fixed and moves the start date — because a research chart is anchored to now. **DECISION: `chartZoom.js`'s measured, verified, no-`fitContent` loop stands, and `describeZoom`'s measured figure in the header stays. Neither is to be regressed.**

**(3) PERSISTENCE DURABILITY IS THE INDUSTRY'S MOST INCONSISTENT AXIS, AND KITE IS THE CAUTIONARY TALE.** Zerodha publishes, itself, the **four ways a user's drawings get destroyed** on Kite web — cache clear, device/browser change, exceeding a layout cap of about ten where **the oldest is evicted**, and a different user id in the same browser — while the Kite **app** saves to **cloud per instrument** with a documented *"Chart preference limit reached"* quota error. **Same broker, same engine, opposite durability guarantees.** The three best alternatives are Thinkorswim's named **per-symbol drawing sets** with age-based cleanup, Koyfin's **per template-and-ticker** annotations, and IBKR's **share-trendline-among-charts** with an optional same-bar-size narrowing. **DECISION: our model — per symbol, portable across every interval via absolute epoch anchors (Section 121) — is the Thinkorswim one and is validated by this research rather than challenged by it. It is not to be changed to a per-interval or per-layout model.**

**(4) FYERS HAS ALREADY SHIPPED AN AI ASSISTANT WHOSE ACTIONS ARE CHART MUTATIONS, AND HAS HAD TO PUBLISH WHETHER IT CLOBBERS THE SAVED LAYOUT.** Its KB index carries topics titled for *"get FIA to mark support and resistance on my chart"*, *"ask FIA to mark RSI and MACD"*, *"how does FIA analyse my current chart and timeframe"* and — the one that matters — *"does FIA change my saved chart layout"*. **This is the closest precedent anywhere to Rāma driving StockMind's chart, and it forces a contract we must set before the feature rather than after. DECISION, made explicit now: RĀMA DRAWS ONLY INTO ITS OWN LABELLED LAYER AND NEVER INTO MASTER'S STORE.** Section 121 already half-states it — a drawing is master's own claim, never generated, never adjusted, never snapped to a "better" level on his behalf, and Rāma's marks are drawn by other code in other colours. The other half is now written: anything Rāma wants to put on the chart is a **separate layer with its own toggle and its own claim class**, or a **proposal master accepts**, never a write into `rama.stockmind.drawings.*`. From the other end, TrendSpider, Finviz and Barchart all point the same way: **automated analysis changes the primary control from a tool to a sensitivity setting.** If Rāma is doing the analysis, the chart should expose *"how aggressive"* and *"show me why"*, not a bigger drawing toolbar.

**(5) ALERTING IN INDIA IS QUOTE-THRESHOLD, NOT CONDITION-BASED, AND THE MARKET LEADER EXPLICITLY CANNOT DO BETTER.** Zerodha enumerates exactly what a Kite alert can test (OHLC, day/intraday percent, LTP/ATP, buy/sell quantity, OI day high/low, volume, last traded quantity; five operators), states *"you can only set price alerts on Kite"*, and confirms the **advanced alerts feature from the retired Sentinel product was not carried over**. Against that: **TrendSpider binds an alert to a drawing's identity so the trigger level moves with the line**; Thinkorswim publishes a complete eligibility and exclusion list for drawing alerts (straight-line drawings on the price subgraph only, **each line of a multi-line drawing needs its own alert**, disabled under tick/range aggregation, Heikin-Ashi, Equivolume, Monkey Bars, Seasonality, OnDemand, **log scale**, contract-change adjustment, and when a key point is off-screen); Sierra Chart documents alerts reading true or false incorrectly **because of comparison precision**. **DECISION: condition-based alerting is a real and identifiable gap in the market leader's product and therefore a genuine differentiator — but the schema decision comes first. If we build alerts, an alert references a DRAWING'S IDENTITY and a rule evaluated against its current geometry, never a frozen price.** Shipping static price alerts first would be a migration. It is also deferred on a second ground: an alert that only fires while a desktop app is open is a worse product than no alert, because master would rely on it.

**(6) NOBODY IN INDIAN RETAIL DOES TPO, ALMOST NOBODY DOES VOLUME PROFILE, ONLY FYERS DOCUMENTS ORDER FLOW — AND UPSTOX HAS INVENTED THE INDIA-SPECIFIC SUBSTITUTE: OI PROFILE AND OI BUILD-UP ON THE CHART.** Kite has 20-level depth and reaches it from the marketwatch, **not the chart**, even though ChartIQ's SDK exposes `CIQ.MarketDepth` and `CIQ.Drawing.volumeprofile` — so that is an exposure decision, not a library limit. **DECISION: for NSE/BSE F&O the locally meaningful analogue of US order-flow analytics is OPEN-INTEREST STRUCTURE, which `derivatives.py` already computes — max pain, Herfindahl concentration, option chains, FII/DII flows, participant-wise OI, delivery data. If StockMind ever wants microstructure depth, OI-on-chart is the higher-value and more defensible direction, and TPO is not to be imported.**

### 123.3 WHAT WE HAVE, COUNTED

**6 chart types** (candles, bars, line, area, baseline, Heikin-Ashi — with the HA warning on the chart, not in a tooltip). **3 price-scale modes** (linear, log, percent — and **only 4 of 22 researched surfaces have percent**). **22 studies**, all pure functions of the visible bars, **every period hard-coded**. **8 drawing tools** on the project's first `lightweight-charts` primitive, per-symbol, absolute-epoch-anchored, portable across every interval. **21 keyboard bindings**, collision-asserted — **only 6 of 22 surfaces publish a shortcut map at all**. **4 density presets** with a measured verification loop and the figure in the header. **9 intervals**, **10 ranges**, per-interval provider caps, shortfall notes. PNG export. **2 persistence keys.** **7 `.mjs` suites at 844 assertions total** (197 + 164 + 135 + 123 + 107 + 70 + 48), plus `auditRenderer.cjs`.

**Three half-features, named by which half**, because "partial" is not a finding: **selection handles RENDER but do not MOVE** — `hitTest` resolves a drawing at 6px and the layer draws a 4px dot at every anchor of the selected one, and there is no handle hit-test, no drag state and no mutator, so an existing mark can be selected, locked, deleted and undone and **cannot be reshaped**; **note text comes from `window.prompt`**, the only prompt left in the chart after Section 102 removed the last one from a money path, with no way to edit an existing note at all; and **the drawing model carries `color` and `width` and the renderer honours both while no UI sets either**, so every mark is one magenta at width 2.

### 123.4 THE ALIGNMENT PASS — what is RULED OUT, with the reason recorded so no later session re-proposes it

**Order entry from the chart** — 14 of 22, **and 7 of 10 Indian brokers; table stakes in this market**. Ruled out because master said broker integration is **"not yet"**, and because `verifyGlossary.mjs` **asserts that no order-placement channel exists** in `marketIntel.cjs` or `preload.cjs`, that `strategy_codegen.py` still states **"DOES NOT PLACE ORDERS"**, and that the glossary's `noOrders` term exists. **The help screen promises master that StockMind never places orders and a test enforces the promise; building chart trading would mean deleting an assertion that exists to keep it.** Sensibull's published guarantee — never places, modifies or cancels orders automatically — is the posture to hold. **Depth-of-market ladder / Level-2 / Level-3** — 8 of 22. No depth feed; drawing a ladder from bar data would mean **inventing the book**. **Order-flow footprint** — 4 of 22. Needs per-trade aggressor classification, i.e. tick data with bid/ask context; `advanced_features.order_flow_features` is a bar-derived **proxy** and drawing it as a footprint would mislabel an estimate as a measurement. **Real-time tick streaming and seconds bars** — 2 of 22, both Indian. No tick stream, no websocket; `1m` depth is capped at **5 sessions**. **Market profile / TPO** — 2 of 22, zero in Cluster B — see 123.2(6). **Alert → order** (Zerodha ATO firing a basket of up to 20, FYERS Automate) — needs routing *and* something always running. **Server-side always-on alerts** — 11 of 22 — same reason. **Mobile/touch** — 17 of 22; Rāma is Electron on the desktop. **Hosted snapshot/share endpoint** — 2 of 22; TradingView documents that copy-link requires the integrator to run their own snapshot server, which is exactly why no Indian broker has one. **Blanket rule, so these do not have to be re-argued one at a time: anything requiring a paid feed, a websocket or a broker credential is not a gap in the chart. Master's data constraint is free providers, capped per interval, on-disk history that only grows.**

**One thing deliberately NOT ruled out against that grain:** position and P&L **display**, because P&L from master's own recorded fills against the last stored close is arithmetic on his own declarations — the line `positionMath.closePreview` already holds — and needs no broker. Kite's **three P&L display modes (rupees, tick-size count, percent of investment)** are the most thoughtful single detail in the whole research; we would ship rupees and percent and skip ticks, having no tick size.

### 123.5 THE SEVEN THINGS NOBODY SELLS — uniquely required by StockMind, and present in **0 of 22** researched surfaces

The pattern behind all seven: **a broker has no incentive to draw the true cost of trading.** Groww publishes 58.5 M orders placed on charts as an achievement and does not publish what they cost. This is the sharpest operational form of master's *"level the field for retail traders"*.

**(1) BACKTEST TRADES WITH REAL RUPEE CHARGES AND RUNNING EXPECTANCY.** 12 of 22 draw backtest trades; **none prices them with dated statutory Indian charges**. Draws: entry/exit markers paired by trade id, with winners and losers distinguished **after charges, not before** — a gross-positive, net-negative trade draws as a **loss**, because that is what it was — plus a pane carrying running net expectancy and running win rate as step series, and a header strip `N trades · W% win rate · ₹X expectancy · real round trip Y% vs flat model Z%`. Data: `strategy_spec.cost_in_rupees()`, **already written**, returning per-trade `{entryDate, lots, units, grossPnl, charges, netPnl, ratesFrom}` plus `tradesBelowOneLot`, `tradesSpanningRateChange`, `tradesInUnknownRateEra`, `realRoundTripPct` vs `flatModelRoundTripPct` and `costs.provenance()`. Claim class **`reflex`** — deterministic arithmetic over a dated rate table whose record is the evidence; **the strategy's expected FUTURE performance is not drawn at all**, because that is a modal claim and `claimGate` refuses one unless it cites a reflex projection record. **MEASURED THIS SESSION by loading `costs.py` directly: a ₹1,000 equity-delivery round trip is ₹19.92 — 1.9925% — against ₹240.18 — 0.2402% — at ₹1,00,000. A flat 0.18% model understates the small trade by more than ten times, and `strategy_eval` refuses any strategy whose edge is smaller than its measured cost. This is the difference between a verdict and a wrong verdict, and the chart must show the figure that produced it.**

**(2) COST-AWARE POSITION SIZING INCLUDING THE ZERO-LOT REFUSAL.** Every platform sizes; **none draws "this trade cannot be placed at your capital"**. Draws: a sizing badge (`units · lots × lotSize · ₹risk at the stop · ₹charges round trip · break-even move %`) and a **break-even level line**, because the distance from entry to break-even is the thing retail never sees — **and when the budget sizes below one lot, a REFUSAL replaces the badge, never a zero.** `positionMath.riskBudget` already returns `units: null` rather than 0 when there is no stop, and `cost_in_rupees` already counts `tradesBelowOneLot` separately *"so it can never be read as a free one"*. Claim class **`reflex`** — master's own capital and risk, his or the engine's labelled stop, deterministic arithmetic; the refusal is the strongest form of reflex, a stated impossibility with its inputs shown. `strategy_spec.py` already says it in words — *"4 units of a 75-unit NIFTY contract is 0 lots… exactly the kind of thing a retail trader discovers with real money"* — **and the chart is where that sentence should be visible.**

**(3) WIN RATE AND EXPECTANCY TOGETHER, FOR THE VISIBLE WINDOW.** Draws a two-value strip that **cannot show one without the other**, recomputed from the visible logical range on every scroll and zoom, with the expectancy carrying the heavier weight when the two disagree in sign. **This is a house requirement, not a feature:** master asked for combos near and above 80% success, the filter was refused with arithmetic he accepted — **40 wins of 1% against 10 losses of 5% is an 80% win rate and −0.20% expectancy** — and **win rate is always reported, never filtered**. A chart showing win rate alone would quietly reinstate the filter he agreed to drop; **the pairing is the enforcement mechanism.** Neither figure may ever be rendered as prose: *"this strategy wins most of the time"* carries no checkable token, would pass the gate as `prose`, and would be the most misleading thing on the screen.

**(4) NEWS EVENTS AS MARKERS CARRYING THEIR CLAIM CLASS.** 3 of 22 put news on a chart; **none attaches an evidential class**. A **`grounded`** marker (the source carries the figure) draws solid with the publisher named; a **`reflex`** marker (Rāma's own `score_text` aggregate with negation handling) draws hollow and labelled as Rāma's reading; a **`prose`** headline draws as a bare tick with no interpretation; **nothing `unattributed` is drawn at all** — the gate's own rule applied to pixels. Data: `news.py`'s `classify_event` over `EVENT_PATTERNS`, the `news1d` interval, GDELT backfill from a 2017-01-01 floor, `coverage()`. **`verifyGlossary.mjs` asserts `StockMind.jsx` still says `NOT BACKTESTABLE` for news, and that qualification must travel onto the chart: a news marker beside a price move is adjacency in time, not cause.** TradingView's marks model is the design hint — marks are requested **for the visible range only**, so they must be queryable by time window rather than fetched wholesale.

**(5) MACRO TRANSMISSION ANNOTATION WITH A PRE-REGISTERED SIGN AND LAG, AND A CONTRADICTED LINK DRAWN AS CONTRADICTED.** 4 of 22 put economic markers on a chart; **none states a hypothesis, its direction, its lag, or whether the data refuted it.** Draws a band on the input's move with a forward arrow spanning exactly the declared lag, labelled `<input> → <target>, sign ±1, window Wd, lag Ld`, then the verdict: `supported` in the ordinary engine colour with its t-statistic; **`not-supported` greyed, "inside the noise band"**; **`contradicted` in the refusal treatment, "the response is real but runs OPPOSITE to the declared direction"**; `insufficient` as an outline with the shortfall. Master's own chain — crude flow blocked → petro products flow drops → input prices rise → margins compress → shareholders jitter → frenzy — renders as a chain of these, **so a break in the chain is visible as a break.** Data: `macro.measure_link()`, already written, already carrying every field, with `sign` **+1 or −1 and explicitly never inferred**, non-overlapping sampling stepped by the lag so the t-statistic means what it claims, `MIN_OBSERVATIONS 30`, `MIN_PER_BUCKET 10`, `T_THRESHOLD 2.0`, and `CONTROL` links included to test the method rather than to trade. **`macro.py`'s own words: "the sign is not adjusted to fit: a claim that fails is a claim that failed." Drawing a contradicted link as if it were supported would be the single worst thing this chart could do; drawing it as contradicted is the single most unusual thing it can do.** The multiple-comparison cost from `measure_all` must travel with any on-chart presentation, or testing twelve links and drawing the two that passed is p-hacking with a nice renderer.

**(6) CHARGE-REGIME CHANGE MARKERS.** A vertical rule at every `RATE_HISTORY` boundary in the visible window, labelled with what changed and by whose authority (`2026-04-01 — futures STT 0.02% → 0.05%, options STT 0.10% → 0.15%, Union Budget 2026`); trades or fills that **straddle** a boundary flagged, because their two legs really were priced at different rates; and **everything before `EARLIEST_KNOWN` 2024-10-01 shaded as an unverified-rate region**, because `rates_on()` returns a warning there, not a rate. `charge_watch.py` adds the forward half as a **dashed, pending** marker carrying `VERIFY_SOURCES` — it matches a charge term **and** a change term, names the authority, extracts the effective date from the text, and captures the claimed percentage **only to show master what the article said, never to write a rate**. Classes: **`grounded`** for an in-force change (the source names the circular or Budget, `VERIFY_AT` points at the charges page and master's own contract note), **`reflex` with an explicit unverified flag** before 2024-10-01, **`prose`-at-best drawn as a proposal and never as a rate** for anything only read in a headline. **Why it is not cosmetic: options STT went 0.0625% → 0.10% → 0.15% of premium across two changes, so a three-year options backtest priced at today's rates overstated early costs by more than double — and a cost error in EITHER direction invalidates a verdict.**

**(7) DATA-COVERAGE SHADING — where bars exist versus where the window asked.** 0 of 22 shade absence; the nearest relatives (MT5's `Max. bars on chart` and 512-bar initial load, IBKR's `Show # bars` contract, TradingView's honest note that a CSV export is exactly the visible window) are all about *limits*. Two bands: **asked-but-absent**, between the requested window and the first stored bar, labelled with the already-computed `shortfallNote()`; and **beyond the provider cap**, older than `PROVIDER_CAP_SESSIONS[interval]` sessions, labelled with `describeLimit()` — both worded as *"a limit, not something Rāma declined"*, which is the phrasing `timeframes.js` already uses. **Entirely client-side and renderer-only.** Class **`reflex`**. **Why it is ours: `1m` depth is 5 sessions, and a trader reasoning about "the last month" on a 1-minute chart is reasoning about bars that do not exist. Every other platform either buys the data or does not care.**

**Plus (8), which is the governing rule made visible:** the **projection cone's own entitlement state as a CLASS**. The half that exists: the cone already draws **dashed and grey while untilted and accent only when gate-cleared**, the chip reads `projection (flat)`, and `cone.tiltReason` is printed in full beneath the canvas. The half that is missing: a **class badge on the layer itself**, plus `barsAhead` against `MAX_BARS_AHEAD = 40` and the `capped` flag (both returned and unshown, so master cannot tell a 40-bar cone from a truncated 60-bar request), and the ±1σ/±2σ endpoints labelled at the band ends rather than only in prose. **An untilted cone is `reflex` — measured volatility over a stated lookback. A tilted cone is a MODAL claim, and `claimGate` permits one only when it cites a reflex projection record, which is exactly what the tilt is. So the badge prints the CLASS, not a confidence:** `claimGate`'s own comment says it is not a confidence score, `intelligenceEngine` already prints confidences elsewhere, and a cone badge reading "78%" would be the wrong kind of number in the right place. The nearest thing in the entire research is Sierra Chart's **Forward Projection Area** — configurable blank forward columns. **It reserves space for the future and says nothing about the standing of what you draw there.**

### 123.6 DECISIONS TAKEN IN THIS SECTION

1. **The gap matrix is aligned to StockMind, not to a brokerage terminal.** Every ruled-out item carries a written reason (123.4) so a later session re-proposing it has an answer rather than a silence.
2. **`chartZoom.js` and `chartTime.js` are settled and are not to be regressed.** The research confirms both as correct shapes rather than workarounds. `verifyChartTime.mjs`'s **197 assertions** are the enforcement.
3. **Rāma draws only into its own labelled layer, never into master's drawing store** — the contract FYERS had to answer retroactively, settled before our feature exists.
4. **Win rate is never rendered without expectancy**, in any chart surface, ever. The pairing enforces the refusal master accepted.
5. **A claim class is a class, not a confidence.** Any badge on a non-arithmetic layer prints `grounded` / `reflex` / `prose`, and nothing `unattributed` is drawn at all.
6. **OI-on-chart, not TPO**, if microstructure depth is ever wanted. `derivatives.py` already has the foundations.
7. **The first implementation tranche is renderer-only**, because the engine cannot be exercised in this environment and an engine-dependent change would be unverifiable: **editable indicator parameters; dragging and reshaping existing drawings; an inline note editor replacing the last `window.prompt`; session shading.** Plan in `docs/research/CHART_LANDSCAPE.md` under PHASE 5 PLAN, with per-item files, the additive contract, and the new `.mjs` assertions.
8. **Data-coverage shading is deferred one tranche** — not on merit, but because `coverage` reaches only one of three `PriceChart` call sites and a band appearing in one place of three is a half-feature. Threading it through is the first item of the next tranche.

### 123.7 NOT VERIFIED

**Nothing in this section was seen on a screen.** The RSI-pane fix (120), the drawing layer (121) and the measured zoom (122) have still never been observed drawn — the rows say so and this section repeats it rather than treating them as working. **`vite build` cannot be run in the research worktree** (`node_modules` is installed in the main workspace and not in `.worktrees/chart-landscape`), so the tranche's bar is the seven `.mjs` suites plus `auditRenderer.cjs`, all of which **do** run there with no dependencies — measured green at 197 / 164 / 135 / 123 / 107 / 70 / 48. **`numpy` is not installed for this machine's Python 3.14.4, so `from engine import …` fails at `dispatcher.py`; `costs.py` was loaded directly by file path, which is why the two charge figures are measured and nothing else Python-side is.** `strategy_spec.cost_in_rupees`, `projection.project`, `macro.measure_link`, `news.py` and `derivatives.py` are read off source and **never executed here** — including the claim that all eight `advanced_features` generators discard their arrays. **Cluster C is entirely unverified** (TLS blocked) and its twelve open questions remain open, including published dates for all five platforms. **Bloomberg is out of evidence on all 44 axes.** **FYERS KB bodies could not be read** — the FIA precedent this section leans on is **topic titles only**, from the vendor's own machine-readable index. ICICI Direct publishes no charting documentation; Groww's 956-article support corpus contains **not one** chart article; several Upstox/Dhan/FYERS/Angel One rows are **marketing claims** and are never promoted to verified behaviour; **no broker states which TradingView edition it licensed**. **ONE CONCRETE ENGINE DEFECT FOUND BY READING AND DELIBERATELY NOT FIXED: `dispatcher.LOT_SIZES` says `NIFTY: 25` while `strategy_spec.py` says 75 in two places — a factor of three on the denominator of the zero-lot refusal, so it changes whether a trade is reported as placeable.** Not touched, because the engine cannot be exercised here and a blind edit to a sizing constant is exactly the wrong kind of change.

### 123.8 NEXT

Phase A is the renderer-only tranche above. Phase B, next: thread `coverage` through all three `PriceChart` call sites then draw the coverage and provider-cap bands; the win-rate/expectancy strip; position P&L in rupees and percent; drawing colour/width UI and indicator presets; CSV export of **exactly the visible window**; pane maximise. Phase C needs the engine: series-returning endpoints for `advanced_features` (asserted by requiring the series' last value to equal today's scalar, which makes the change provably non-breaking); backtest trades with real charges; the sizing badge **after resolving the lot-size contradiction**; charge-regime markers; news markers with class; macro transmission annotation; corporate-action markers with a declared adjustment basis; comparison symbol in `%`; replay over a cost-aware backtest with its fidelity mode declared. Phase D is 123.4 and stays deferred.

---

# READY-TO-PASTE BLOCK (b) — ledger row 143

> Paste as a single row into Section 28's ledger table, after row 142.

```
| 143 | The chart landscape researched, the gap matrix, and the alignment pass | done | Section 123. Master: *"Do the extensive analysis for each and every feature in the charts, draw research from all the famous/popular trading apps and their implementation… compare our implementation and understand the gap and also align the implementation to our need/requirement in stockmind actual behavior."* **FOUR SECTIONS (110, 119, 120, 122) EACH CHANGED THE CHART AND EACH ENDED WITH MASTER REPORTING SOMETHING STILL WRONG, because each decision was a guess at a question the industry had already settled.** **RESEARCHED: 23 platform surfaces in three clusters, written to `docs/research/CHART_LANDSCAPE.md` with three source cluster files beside it (1,499 lines of raw research).** Cluster A (TradingView, Thinkorswim, MT5, NinjaTrader 8, Sierra Chart, IBKR TWS, Bloomberg, Koyfin) and Cluster B (Kite on **both** engines, Upstox, Groww, Dhan, FYERS, Angel One, ICICI Direct, Trendlyne, Sensibull) were read off **live official vendor documentation**, ~255 citations, no blogs or forums; **Cluster C (StockCharts, Barchart, Investing.com, TrendSpider, Finviz) FAILED — outbound HTTPS blocked at the TLS handshake, so NOT ONE Cluster C claim was read off a live page** and every row carries its own confidence; **Bloomberg returned HTTP 403 on every path, so all 44 of its axes are OUT OF EVIDENCE and excluded from every count — out of evidence, never a zero.** **Only IBKR prints a revision date (2025-10-08); everyone else prints a copyright year, so no date is guessed.** **THE SIX STRUCTURAL FINDINGS, which matter more than any feature row. (1) SIX OF SEVEN INDIAN BROKERS DO NOT WRITE THEIR OWN CHART ENGINE AND THE LIBRARY EDITION CAPS THE FEATURE SET BEFORE THE BROKER WRITES A LINE OF CODE** — TradingView's free Advanced Charts **excludes Renko/P&F/Line-Break/Kagi outright**, and multi-chart, crosshair sync, DOM, order entry, position/P&L overlay, drawing templates and seconds-from-ticks are **Trading Platform only**; no broker states which edition it licensed, so a broker claiming a premium-tier feature is recorded as the broker's claim. **A long tail of apparent industry standards is one vendor's paywall, and `lightweight-charts` 5.2.1 gives us no such ceiling.** **(2) THE REFERENCE IMPLEMENTATION DELIBERATELY DOES NOT PERSIST THE VISIBLE RANGE** — a saved TradingView layout excludes it and the library re-opens on the newest data, exposing `setVisibleRange` as an explicit POST-LOAD call. **That is the documented vendor explanation for the defect master reported three times as "default zoom not working", and it confirms Section 122's measured read-back loop as the correct shape rather than a workaround.** Thinkorswim offers the opposite as an opt-in named "Keep time zoom"; Koyfin specifies zoom as *how much history*, holding the end date fixed. **DECISION: `chartZoom.js` and `chartTime.js` are settled and are NOT to be regressed; the 197 assertions are the enforcement.** **(3) PERSISTENCE DURABILITY IS THE INDUSTRY'S MOST INCONSISTENT AXIS AND KITE IS THE CAUTIONARY TALE** — Zerodha publishes the FOUR ways a user's drawings get destroyed on web (cache clear, device change, a ~10-layout cap where **the oldest is evicted**, a different user id in the same browser) while the APP saves to cloud per instrument with a documented quota error: **same broker, same engine, opposite guarantees.** **DECISION: our per-symbol, interval-portable, absolute-epoch model (Section 121) IS Thinkorswim's drawing-set model and is validated rather than challenged — not to be changed to per-interval or per-layout.** **(4) FYERS HAS ALREADY SHIPPED AN AI ASSISTANT WHOSE ACTIONS ARE CHART MUTATIONS AND HAS HAD TO PUBLISH WHETHER IT CLOBBERS THE SAVED LAYOUT** — KB topics exist for *"get FIA to mark support and resistance"*, *"mark RSI and MACD on my chart"* and *"does FIA change my saved chart layout"*. **This is the closest precedent anywhere to Rāma driving StockMind, so the contract is settled NOW rather than retroactively: RĀMA DRAWS ONLY INTO ITS OWN LABELLED LAYER AND NEVER INTO MASTER'S STORE** — Section 121 half-stated it (a drawing is master's own claim, never generated, adjusted or snapped on his behalf) and the other half is now written. From the other end TrendSpider, Finviz and Barchart agree: **automated analysis changes the primary control from a TOOL to a SENSITIVITY SETTING** — if Rāma does the analysis the chart should expose *"how aggressive"* and *"show me why"*, not a bigger toolbar. **(5) ALERTING IN INDIA IS QUOTE-THRESHOLD AND THE MARKET LEADER EXPLICITLY CANNOT DO BETTER** — Zerodha enumerates its seven testable quantities and five operators, states *"you can only set price alerts on Kite"*, and confirms the Sentinel advanced-alerts feature **was not carried over**; against that TrendSpider **binds an alert to a DRAWING'S IDENTITY so the trigger level moves with the line**, Thinkorswim publishes a complete eligibility+exclusion list (straight-line drawings only, each line its own alert, disabled under log scale among eleven other states), and Sierra Chart documents alerts failing **on comparison precision**. **DECISION: condition-based alerting is a real gap in the leader's product and a genuine differentiator, but THE SCHEMA DECISION COMES FIRST — an alert references a drawing's identity, never a frozen price; shipping static price alerts first would be a migration. Deferred additionally because an alert that only fires while a desktop app is open is worse than none.** **(6) NOBODY IN INDIAN RETAIL DOES TPO, ALMOST NOBODY DOES VOLUME PROFILE, ONLY FYERS DOCUMENTS ORDER FLOW — AND UPSTOX INVENTED THE INDIA-SPECIFIC SUBSTITUTE, OI PROFILE AND OI BUILD-UP ON THE CHART.** Kite's 20-level depth is reachable from the marketwatch and **not the chart** although ChartIQ's SDK exposes `CIQ.MarketDepth` — an exposure decision, not a library limit. **DECISION: for NSE F&O the local analogue of order-flow analytics is OPEN-INTEREST STRUCTURE, which `derivatives.py` already computes (max pain, Herfindahl concentration, option chain, FII/DII, participant OI, delivery) — OI-on-chart, and TPO is not to be imported.** **COUNTED INVENTORY OF OURS, read off code not the ledger: 6 chart types, 3 scale modes (percent included — only 4 of 22 surfaces have it), 22 studies with EVERY PERIOD HARD-CODED, 8 drawing tools on the project's first library primitive, 21 collision-asserted keyboard bindings (only 6 of 22 surfaces publish a shortcut map at all), 4 density presets with a measured header figure, 9 intervals, 10 ranges, PNG export, 2 persistence keys, 7 `.mjs` suites at 844 assertions (197+164+135+123+107+70+48).** **THREE HALF-FEATURES NAMED BY WHICH HALF, because "partial" is not a finding: selection handles RENDER and do not MOVE** (hit-testing resolves at 6px and the layer draws a dot at every anchor; there is no handle hit-test, no drag state and no mutator, so a mark can be selected, locked, deleted and undone and **cannot be reshaped**); **note text comes from `window.prompt`**, the only one left after Section 102 removed the last from a money path, with **no way to edit an existing note at all**; and **the model carries `color` and `width` and the renderer honours both while NO UI SETS EITHER**, so every mark is one magenta at width 2. **THE ALIGNMENT PASS — RULED OUT WITH A WRITTEN REASON so no later session re-proposes it: order entry from the chart (14 of 22, and 7 of 10 Indian brokers — TABLE STAKES IN THIS MARKET), ruled out because broker integration is "not yet" AND because `verifyGlossary.mjs` ASSERTS no order-placement channel exists in `marketIntel.cjs`/`preload.cjs`, that `strategy_codegen.py` still says "DOES NOT PLACE ORDERS", and that the glossary's `noOrders` term exists — THE HELP SCREEN PROMISES MASTER STOCKMIND NEVER PLACES ORDERS AND A TEST ENFORCES THE PROMISE, so building chart trading would mean deleting an assertion that keeps it; depth-of-market ladder (no depth feed — drawing one from bars would mean INVENTING THE BOOK); order-flow footprint (needs per-trade aggressor data, and `advanced_features.order_flow_features` is a bar-derived PROXY that would be mislabelled as a measurement); tick/seconds streaming (no stream, no websocket, `1m` capped at 5 sessions); TPO; alert→order; always-on server alerts; mobile; a hosted snapshot endpoint. BLANKET RULE so these are not re-argued one at a time: anything needing a paid feed, a websocket or a broker credential is not a gap in the chart.** Deliberately NOT ruled out against that grain: **position/P&L DISPLAY**, because P&L from master's own fills against the last stored close is arithmetic on his own declarations — the line `positionMath` already holds — and Kite's three display modes (rupees, tick count, percent of investment) are the best single detail in the research; we would ship rupees and percent and skip ticks, having no tick size. **THE SEVEN THINGS NOBODY SELLS, present in 0 OF 22, each designed with its data source and claim class: (1) backtest trades with REAL RUPEE CHARGES and running expectancy — 12 of 22 draw trades, NONE prices them with dated statutory Indian charges; a gross-positive net-negative trade draws as a LOSS; `strategy_spec.cost_in_rupees` already returns per-trade `{lots, units, grossPnl, charges, netPnl, ratesFrom}` plus `tradesBelowOneLot`/`tradesSpanningRateChange`/`tradesInUnknownRateEra`/`realRoundTripPct`; class `reflex`, and the strategy's FUTURE performance is not drawn at all because `claimGate` refuses a modal claim without a reflex projection record. MEASURED THIS SESSION by loading `costs.py` directly: a ₹1,000 delivery round trip is ₹19.92 = 1.9925%, against ₹240.18 = 0.2402% at ₹1,00,000 — A FLAT 0.18% MODEL UNDERSTATES THE SMALL TRADE BY MORE THAN TEN TIMES, and `strategy_eval` refuses any strategy whose edge is below its measured cost. (2) cost-aware sizing with the ZERO-LOT REFUSAL — every platform sizes, none draws "this trade cannot be placed at your capital"; a badge plus a BREAK-EVEN LINE, and below one lot a REFUSAL replaces the badge, never a zero; `riskBudget` already returns `units: null` not 0 without a stop, and `cost_in_rupees` already counts unlotted trades separately "so it can never be read as a free one". (3) WIN RATE AND EXPECTANCY TOGETHER for the visible window, in one return shape that CANNOT SHOW ONE WITHOUT THE OTHER — a house requirement, not a feature: the 80% filter was refused with arithmetic master accepted (40 wins of 1% against 10 losses of 5% is 80% and −0.20%), WIN RATE IS ALWAYS REPORTED NEVER FILTERED, and a chart showing win rate alone would quietly reinstate the filter he agreed to drop. (4) news markers CARRYING THEIR CLAIM CLASS — grounded solid with the publisher, reflex hollow and labelled as Rāma's reading, prose a bare tick, and NOTHING UNATTRIBUTED DRAWN AT ALL; `verifyGlossary` asserts `StockMind.jsx` still says NOT BACKTESTABLE and that qualification must travel onto the chart, because a marker beside a move is adjacency, not cause. (5) MACRO TRANSMISSION with pre-registered sign and lag and A CONTRADICTED LINK DRAWN AS CONTRADICTED — `macro.measure_link` already carries every field with `sign` ±1 and NEVER INFERRED, non-overlapping sampling stepped by the lag, t-threshold 2.0, and CONTROL links included to test the method not to trade; `macro.py`'s own words are "the sign is not adjusted to fit: a claim that fails is a claim that failed", and drawing a contradicted link as supported would be the worst thing this chart could do while drawing it as contradicted is the most unusual thing it can do; the multiple-comparison cost must travel with it or twelve links tested and two drawn is p-hacking with a nice renderer. (6) CHARGE-REGIME MARKERS — options STT went 0.0625% → 0.10% → 0.15% of premium across two changes, so a three-year options backtest at today's rates OVERSTATED early costs BY MORE THAN DOUBLE and a cost error in EITHER direction invalidates a verdict; a rule at every `RATE_HISTORY` boundary, straddling trades flagged because their legs really were priced differently, everything before `EARLIEST_KNOWN` 2024-10-01 shaded as an UNVERIFIED-RATE region, and `charge_watch` proposals drawn DASHED AND PENDING because it captures a claimed percentage only to show master what the article said, NEVER to write a rate. (7) DATA-COVERAGE SHADING — 0 of 22 shade absence; `1m` depth is 5 SESSIONS, so a trader reasoning about "the last month" on a 1-minute chart is reasoning about bars that do not exist, and the bands reuse `shortfallNote()` and `describeLimit()` text already written. PLUS the cone's ENTITLEMENT STATE AS A CLASS: the half that exists is dashed-and-grey-while-untilted with `tiltReason` printed; the half missing is a badge on the layer, `barsAhead` against `MAX_BARS_AHEAD` 40 with the `capped` flag, and the ±1σ/±2σ endpoints labelled — and THE BADGE PRINTS THE CLASS, NOT A CONFIDENCE, because `claimGate` says it is not a confidence score and a cone reading "78%" would be the wrong kind of number in the right place. The nearest thing in all 23 surfaces is Sierra Chart's Forward Projection Area, which RESERVES SPACE FOR THE FUTURE AND SAYS NOTHING ABOUT THE STANDING OF WHAT YOU DRAW THERE.** **VERIFIED: the seven `.mjs` suites run GREEN INSIDE THE RESEARCH WORKTREE WITH NO `node_modules` — 197 / 164 / 135 / 123 / 107 / 70 / 48 — and `auditRenderer.cjs` is clean; `costs.py` was loaded directly by file path and the ₹19.92 / 1.9925% and ₹240.18 / 0.2402% figures are MEASURED, not estimated. No source file was modified by this section.** **NOT VERIFIED: nothing was seen on a screen — the RSI-pane fix (120), the drawing layer (121) and the measured zoom (122) have still never been observed drawn. `vite build` CANNOT run in the worktree (`node_modules` is in the main workspace only) and is not claimed. `numpy` is absent for this machine's Python 3.14.4 so `from engine import …` fails at `dispatcher.py`; `strategy_spec.cost_in_rupees`, `projection.project`, `macro.measure_link`, `news.py` and `derivatives.py` are READ OFF SOURCE AND NEVER EXECUTED HERE, including the claim that all eight `advanced_features` generators discard their arrays. CLUSTER C IS ENTIRELY UNVERIFIED with twelve open questions including published dates for all five platforms; BLOOMBERG IS OUT OF EVIDENCE ON ALL 44 AXES; FYERS KB BODIES COULD NOT BE READ, so the FIA precedent this section leans on is TOPIC TITLES ONLY; ICICI Direct publishes no charting documentation and Groww's 956-article corpus contains NOT ONE chart article; several Upstox/Dhan/FYERS/Angel One rows are MARKETING CLAIMS never promoted to verified behaviour; and NO BROKER STATES WHICH TRADINGVIEW EDITION IT LICENSED. ONE CONCRETE ENGINE DEFECT FOUND BY READING AND DELIBERATELY NOT FIXED: `dispatcher.LOT_SIZES` says `NIFTY: 25` while `strategy_spec.py` says 75 IN TWO PLACES — a factor of three on the DENOMINATOR OF THE ZERO-LOT REFUSAL, so it decides whether a trade is reported as placeable; untouched because the engine cannot be exercised here and a blind edit to a sizing constant is exactly the wrong kind of change.** **NEXT: (A) the RENDERER-ONLY tranche, planned in `CHART_LANDSCAPE.md` under PHASE 5 PLAN with per-item files, an additive contract keeping all three `PriceChart` call sites untouched, and the new `.mjs` assertions — (1) EDITABLE INDICATOR PARAMETERS for all 22 studies, the most universal feature in the whole research at 19 of 22 and the top remaining gap in rows 140, 141 AND 142, with the current literal as every fallback so `make(bars)` stays value-identical, a `needsFor()` that reproduces the three hard-won thresholds (`macd` 34, `ichimoku` 78, `stoch` 18) from formulas rather than copied numbers, and `intParam` honouring ABSENT-IS-NOT-ZERO for the FOURTH time in this project (112, 115, 122); (2) DRAGGING AND RESHAPING existing drawings, the cheapest large win since the hit-testing is already tested and the handles already draw, with `handleAt` tolerance deliberately ABOVE `hitTest`'s so grabbing a handle beats grabbing the body, locked marks refused by all three mutators, and anchors asserted to stay absolute epoch seconds THROUGH a move; (3) an INLINE NOTE EDITOR removing the last `window.prompt`, with an empty edit a REFUSAL rather than a deletion and a source-level assertion that the prompt is gone; (4) SESSION SHADING on a new second library primitive at `zOrder: 'bottom'`, reusing the already-tested `sessionStarts()`, with each band ending at a REAL STORED BAR so a half-session draws as a half-session — the same refusal as Section 120's decision not to synthesise 26 future timestamps for Ichimoku. Targets: indicators 164→≥215, drawings 135→≥180, a new `verifyChartSessions.mjs` at ≥40 wired in as `verify:sessions`, `verifyChartTime` UNCHANGED at 197, new glossary terms `indicatorPeriod`/`chartNote`/`sessionBand` or `verifyGlossary` fails. (B) next tranche: thread `coverage` through ALL THREE call sites then draw the coverage bands (deferred one tranche only because a band in one place of three is a half-feature); the win-rate+expectancy strip; P&L in rupees and percent; drawing colour/width UI and indicator presets; CSV export of EXACTLY the visible window; pane maximise. (C) engine-dependent, not attempted until the engine can be exercised: series-returning endpoints for `advanced_features` (asserted by requiring the series' last value to equal today's scalar, which makes the change provably non-breaking); backtest trades with real charges; the sizing badge AFTER RESOLVING THE LOT-SIZE CONTRADICTION; charge-regime markers; news markers with class; macro transmission; corporate-action markers with a declared adjustment basis; comparison symbol in `%`; replay with its fidelity mode declared. (D) 123.4 stays deferred.** |
```






