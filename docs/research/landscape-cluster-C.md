# Chart Feature Landscape — Cluster C: charting-first web tools

Scope: **StockCharts**, **Barchart**, **Investing.com**, **TrendSpider**, **Finviz**.
Purpose: feature inventory for the StockMind charting gap analysis.
Status: **draft, pending live-source verification** (see §1).

---

## 1. Methodology and verification status — read first

| Item | Detail |
| --- | --- |
| Research session constraint | **Outbound network access is blocked in this workspace.** DNS resolves, but every HTTPS request fails at the TLS handshake (`SEC_E_ILLEGAL_MESSAGE` via `curl`, "SSL connection could not be established" via `Invoke-WebRequest`); plain HTTP also fails. Verified by direct test at the start of this session. |
| Consequence | **No claim below was read off a live page during this session.** Every row is sourced from prior knowledge of these products' documented behaviour, and is marked with a confidence level. |
| Confidence scale | `high` = long-standing, prominently documented product behaviour; `med` = believed correct but detail-level wording may be stale; `low` = recollection only, treat as a hypothesis; `unconfirmed` = not asserted at all. |
| Published dates | The task asked for publication dates where the search result gives one. No search results were obtainable, so every date is recorded as `unconfirmed (no network access)`. No dates have been guessed. |
| Source links | Links point at the **canonical home of the claim** (official help centre / official product page) and not at a deep page whose URL could not be checked. Where a deep URL is given, it follows a URL pattern I am confident is real; where I am not confident, the source cell names the publisher instead of fabricating a path. |
| Verification follow-up required | Before any StockMind design decision is taken from this document, re-run every `med` and `low` row against the cited official source from a machine with egress. Rows marked `unconfirmed` are open research tasks, not absences. |
| Licensing | No source text is quoted. All descriptions are summaries in my own words. **Content was rephrased for compliance with licensing restrictions.** |

### Legend used in the matrices

| Symbol | Meaning |
| --- | --- |
| `Y` | Present |
| `N` | Absent |
| `P` | Partial / restricted (plan-gated, limited variant, or workaround only) |
| `?` | Unconfirmed — not asserted either way |

---

## 2. Platform one-liners and why each is in Cluster C

| Platform | Position in this cluster | Architectural fact that shapes every feature row | Canonical source | Confidence |
| --- | --- | --- | --- | --- |
| StockCharts | Long-running US charting subscription service; strongest classic-TA heritage (Point & Figure, ChartSchool education). | Two generations run side by side: **SharpCharts**, which renders charts **server-side as images**, and **ACP** (Advanced Charting Platform), a newer browser-side interactive chart. Feature answers differ per engine, so rows below name the engine. | [StockCharts ChartSchool](https://chartschool.stockcharts.com/), [StockCharts Support](https://support.stockcharts.com/) | high |
| Barchart | Market-data house (futures/commodities first) with a retail web front end. | Charting is one surface over a very broad in-house data set; **futures-native constructs** (continuation contracts, spreads, seasonality) are first-class, equity niceties less so. | [Barchart](https://www.barchart.com/) | high |
| Investing.com | Mass-market financial portal; charts are a feature of a news/calendar product. | The "advanced" chart is **a third-party charting library deployment (TradingView's)**, so chart capability largely equals what that library exposes minus the features the host does not license. Portal-side features (calendar, news, alerts) are Investing.com's own. | [Investing.com](https://www.investing.com/) | high (that it is a TradingView-based deployment), med (exact licensed feature set) |
| TrendSpider | Automation-first charting; sells *doing* the analysis rather than drawing surface. | Flagship differentiators are **automated trendline / Fibonacci detection, multi-timeframe indicators, drawing-anchored dynamic alerts, Raindrop charts, and an on-chart strategy tester**. | [TrendSpider](https://trendspider.com/) | high |
| Finviz | Screener-first; charts are an output format of the screener. | Classic charts are **static server-rendered images** rendered in bulk grids, with **pattern-detection overlays drawn by the server**. An interactive chart exists on the paid tier. This makes Finviz the cluster's "many charts at once, little interaction" extreme. | [Finviz](https://finviz.com/) | high |

**Content was rephrased for compliance with licensing restrictions.**

---

## 3. Cross-platform summary matrix (presence only)

Detail, sources and confidence for each cell are in §4–§8. Use this table for orientation only.

| # | Axis | StockCharts | Barchart | Investing.com | TrendSpider | Finviz |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Candles / OHLC / line / area | Y | Y | Y | Y | Y |
| 2 | Heikin-Ashi | Y | Y | Y | Y | ? |
| 3 | Renko | Y | Y | Y | ? | N |
| 4 | Kagi | Y | ? | Y | ? | N |
| 5 | Point & Figure | Y | Y | Y | ? | N |
| 6 | Three-line-break | Y | ? | Y | ? | N |
| 7 | Range bars | ? | ? | P | ? | N |
| 8 | Proprietary bar type | Y (Elder Impulse) | ? | N | Y (Raindrop) | N |
| 9 | Drawing tool inventory breadth | Y (broad) | Y (moderate) | Y (broad, inherited) | Y (broad) | P (minimal) |
| 10 | Magnet / snap to OHLC | ? | ? | Y | ? | N |
| 11 | Drawing templates / clone | P | ? | P | Y | N |
| 12 | Indicator parameters user-editable | Y | Y | Y | Y | P |
| 13 | Indicator templates / presets | Y (ChartStyles) | Y | P | Y | P |
| 14 | Multi-pane + pane resize | Y | Y | Y | Y | P |
| 15 | Second-symbol comparison overlay | Y | Y | Y | Y | ? |
| 16 | Spread / ratio charts | Y (ratio symbols) | Y (futures spreads) | ? | ? | N |
| 17 | Bar replay / playback | ? | ? | P | P | N |
| 18 | Alerts created from the chart | P | P | P | Y (drawing-anchored) | N |
| 19 | Session / extended-hours shading | ? | ? | ? | Y | ? |
| 20 | Holiday / no-trade gap handling | Y | Y | Y | Y | Y |
| 21 | Volume profile — visible range | P | ? | P | ? | N |
| 22 | Volume profile — fixed range | ? | ? | ? | ? | N |
| 23 | Market profile / TPO | N | ? | N | ? | N |
| 24 | Order-flow footprint | N | N | N | N | N |
| 25 | Depth-of-market ladder | N | P | N | N | N |
| 26 | Corporate-action adjustment declared | P | P | ? | ? | ? |
| 27 | Earnings / dividend / split markers | Y | ? | P | Y | ? |
| 28 | News on chart | N | ? | ? | Y | N |
| 29 | Economic-calendar markers | N | ? | P | Y | N |
| 30 | Auto pattern recognition | P | Y | N | Y | Y |
| 31 | Auto support / resistance | P | Y | N | Y | P |
| 32 | Multi-chart layouts + saved layouts | Y | Y | ? | Y | Y (grid) |
| 33 | Watchlist↔chart linking | Y | Y | Y | Y | Y |
| 34 | Drawings persist per symbol on symbol change | ? | ? | Y | Y | N/A |
| 35 | Chart image export / publish | Y | Y | Y | Y | Y |
| 36 | Data export (CSV) | ? | Y | P | ? | P (screener) |
| 37 | Keyboard shortcut coverage | ? | ? | P | Y | P |
| 38 | Measurement tool | Y | ? | Y | Y | N |
| 39 | Log / percent / inverted scales | P | ? | Y | Y | P |
| 40 | Price scale auto vs locked | ? | ? | Y | ? | N/A |
| 41 | Crosshair sync across charts | ? | ? | ? | Y | N |
| 42 | On-chart backtest / strategy visualisation | N | P | N | Y | N |
| 43 | Order entry / position & P&L overlay | N | P | P | P | N |
| 44 | Mobile / touch | P | Y | Y | Y | P |
| 45 | Performance ceiling (bars) | server-rendered | ? | ? | ? | server-rendered |

---

## 4. StockCharts — detail

Engine matters: **SC** = SharpCharts (server-rendered image), **ACP** = Advanced Charting Platform (interactive).

| Axis | Present | Notable implementation detail | Source | Published | Confidence |
| --- | --- | --- | --- | --- | --- |
| Chart types — core | Y | Candlesticks, hollow candles, OHLC bars, line, area, available in both engines. | [ChartSchool](https://chartschool.stockcharts.com/) | unconfirmed (no network access) | high |
| Chart types — Heikin-Ashi | Y | Offered as a chart-type selection, not an overlay. | [ChartSchool](https://chartschool.stockcharts.com/) | unconfirmed (no network access) | high |
| Chart types — Renko | Y | Brick size configurable; selected from the same chart-type dropdown as candles, so period/aggregation settings interact with it. | [ChartSchool](https://chartschool.stockcharts.com/) | unconfirmed (no network access) | med |
| Chart types — Kagi | Y | Reversal amount configurable. | [ChartSchool](https://chartschool.stockcharts.com/) | unconfirmed (no network access) | med |
| Chart types — Point & Figure | Y | The cluster's deepest P&F implementation: box size and reversal are settable, **45-degree bullish/bearish support and resistance trendlines are drawn automatically**, and P&F pattern alerts plus vertical/horizontal price objectives are part of the documented method. This is the strongest single differentiator. | [ChartSchool P&F](https://chartschool.stockcharts.com/) | unconfirmed (no network access) | high |
| Chart types — three-line-break | Y | Number of break lines configurable. | [ChartSchool](https://chartschool.stockcharts.com/) | unconfirmed (no network access) | med |
| Chart types — range bars | ? | Not asserted. | — | — | unconfirmed |
| Chart types — proprietary | Y | **Elder Impulse** colour-codes each bar from an EMA-slope + MACD-histogram agreement rule — a bar type that encodes a two-indicator state rather than price shape. Useful precedent for StockMind "semantic bar colouring". | [ChartSchool](https://chartschool.stockcharts.com/) | unconfirmed (no network access) | high |
| Drawing tool inventory | Y | ACP ships trendlines, rays, horizontal/vertical lines, channels, Fibonacci retracement/arcs/fans/time zones, Andrews Pitchfork, Gann tools, Raff regression channel, quadrant lines, cycle lines, shapes, arrows, text/annotation. | [StockCharts Support](https://support.stockcharts.com/) | unconfirmed (no network access) | med |
| Drawing tool **count** | ? | No count asserted — marketing counts change per release. | — | — | unconfirmed |
| Magnet / snap-to-OHLC | ? | Not asserted. | — | — | unconfirmed |
| Drawing templates / clone | P | Chart appearance including overlays is saved as a **ChartStyle** and can be applied to any symbol; whether *annotations* travel with a ChartStyle (as opposed to being stored per saved chart) is unconfirmed. | [StockCharts Support](https://support.stockcharts.com/) | unconfirmed (no network access) | med (ChartStyles), unconfirmed (annotation reuse) |
| Indicator count | P | Marketed in the "over 100" band when overlays and indicators are counted together; ChartSchool documents each one with formula and interpretation — **the documentation depth is the asset, not the count**. | [ChartSchool](https://chartschool.stockcharts.com/) | unconfirmed (no network access) | med (band), high (doc depth) |
| Indicator parameters editable | Y | Every indicator/overlay row exposes a free-text parameter field (comma-separated), including in SharpCharts where the chart is a server-rendered image — parameters are form state, not client state. | [ChartSchool](https://chartschool.stockcharts.com/) | unconfirmed (no network access) | high |
| Indicator templates / presets | Y | ChartStyles act as the preset mechanism and can be set as the default style for new charts. | [StockCharts Support](https://support.stockcharts.com/) | unconfirmed (no network access) | high |
| Multi-pane management | Y | Indicators can be placed above or below price in separate panels. In SharpCharts, panel height is a numeric/weight setting rather than a drag handle; in ACP panes are resizable by dragging. | [StockCharts Support](https://support.stockcharts.com/) | unconfirmed (no network access) | med |
| Second-symbol comparison | Y | A "Price" overlay plots another symbol on the chart; StockCharts also provides **PerfCharts** as a dedicated percentage-performance comparison surface rather than overloading the price chart. The axis used for the overlaid symbol (shared vs. independent right scale) is unconfirmed. | [ChartSchool](https://chartschool.stockcharts.com/) | unconfirmed (no network access) | med (overlay + PerfCharts), unconfirmed (scale) |
| Spread / ratio charts | Y | **Ratio symbols are first-class syntax** (`SYMBOL:SYMBOL`), so an intermarket ratio is just another chartable symbol and can carry indicators, overlays and alerts like any ticker. Strong design precedent: make derived series symbols, not chart modes. | [ChartSchool — intermarket/ratio analysis](https://chartschool.stockcharts.com/) | unconfirmed (no network access) | high |
| Bar replay / playback | ? | Not asserted for either engine. | — | — | unconfirmed |
| Alerts from chart | P | A server-side alert facility exists (price and technical-condition alerts, expressed in the same syntax family as the scan engine) and persists server-side with email/SMS delivery; **creation directly from a chart object such as a drawn trendline is unconfirmed** and the documented route is a separate alert workbench. | [StockCharts Support](https://support.stockcharts.com/) | unconfirmed (no network access) | med (alerts exist, server-persisted), unconfirmed (chart-origin creation) |
| Session / extended-hours shading | ? | Not asserted. | — | — | unconfirmed |
| Holiday / no-trade gaps | Y | Charts are built on trading sessions, so non-trading days are not allotted space. | [ChartSchool](https://chartschool.stockcharts.com/) | unconfirmed (no network access) | high |
| Volume profile — visible range | P | A **Volume by Price** overlay draws a horizontal volume histogram at price levels over the charted range — a visible-range volume profile in effect, though presented as an overlay with a bar-count parameter rather than a profile tool with value-area/POC semantics. | [ChartSchool — Volume by Price](https://chartschool.stockcharts.com/) | unconfirmed (no network access) | high |
| Volume profile — fixed range | ? | No user-selected fixed range asserted. | — | — | unconfirmed |
| Market profile / TPO | N | No TPO/market-profile product in the documented feature set. | [ChartSchool](https://chartschool.stockcharts.com/) | unconfirmed (no network access) | med |
| Order-flow footprint | N | Out of scope for the product (no tick/L2 real-time surface). | [StockCharts](https://stockcharts.com/) | unconfirmed (no network access) | high |
| DOM ladder | N | No order book; not a brokerage. | [StockCharts](https://stockcharts.com/) | unconfirmed (no network access) | high |
| Corporate-action adjustment | P | Historical series are split-adjusted, and the support site documents the adjustment policy including dividend treatment; **the exact default (dividend-adjusted vs price-only) and whether an unadjusted view is selectable is unconfirmed**. Declared: yes, in support documentation rather than on the chart surface. | [StockCharts Support](https://support.stockcharts.com/) | unconfirmed (no network access) | med (splits), unconfirmed (dividend default / toggle) |
| Earnings / dividend / split markers | Y | Chart attributes include an events selection that flags earnings, dividends and splits beneath the price plot. | [StockCharts Support](https://support.stockcharts.com/) | unconfirmed (no network access) | med |
| News on chart | N | News is surfaced on symbol summary pages, not plotted on the chart. | [StockCharts](https://stockcharts.com/) | unconfirmed (no network access) | med |
| Economic-calendar markers | N | Not part of the charting surface. | [StockCharts](https://stockcharts.com/) | unconfirmed (no network access) | med |
| Auto pattern recognition | P | No general chart-pattern detector drawn on the price chart; the equivalents are **automatic P&F trendlines**, predefined scans (including P&F pattern scans) and the StockCharts Technical Rank — i.e. pattern logic lives in the scan engine, results are a list, not an annotation. | [ChartSchool](https://chartschool.stockcharts.com/) | unconfirmed (no network access) | med |
| Auto support / resistance | P | Only via P&F's automatic 45-degree trendlines; no swing-derived auto S/R on time-based charts. | [ChartSchool P&F](https://chartschool.stockcharts.com/) | unconfirmed (no network access) | med |
| Multi-chart layouts + saved layouts | Y | ChartLists give multi-chart views (including a thumbnail "glance" grid); ACP offers multi-chart layouts on higher tiers. Exact grid counts per tier unconfirmed. | [StockCharts Support](https://support.stockcharts.com/) | unconfirmed (no network access) | med |
| Watchlist↔chart linking | Y | A ChartList functions as the watchlist and drives the chart via next/previous navigation through the list, keeping the ChartStyle applied. | [StockCharts Support](https://support.stockcharts.com/) | unconfirmed (no network access) | med |
| Drawings persist on symbol change | ? | Annotations are stored against a saved chart; behaviour when stepping through a ChartList is unconfirmed. | — | — | unconfirmed |
| Image export / publish | Y | Charts can be saved/printed as images, linked by permalink, and **published as Public ChartLists** — a social/publishing path that is unusual in this cluster and worth noting for StockMind sharing design. | [StockCharts Support](https://support.stockcharts.com/) | unconfirmed (no network access) | high |
| Data export (CSV) | ? | Not asserted; no documented retail CSV download recalled. | — | — | unconfirmed |
| Keyboard shortcuts | ? | Not asserted. | — | — | unconfirmed |
| Measurement tool | Y | ACP includes a measure tool reporting price and bar/time delta. | [StockCharts Support](https://support.stockcharts.com/) | unconfirmed (no network access) | med |
| Log / percent / inverted scales | P | Logarithmic scaling is a documented chart attribute; **percent and inverted scales are unconfirmed**. | [ChartSchool](https://chartschool.stockcharts.com/) | unconfirmed (no network access) | high (log), unconfirmed (percent/invert) |
| Price scale auto vs locked | ? | Not asserted. | — | — | unconfirmed |
| Crosshair sync across charts | ? | Not asserted; unlikely for server-rendered SharpCharts by construction. | — | — | unconfirmed |
| On-chart backtest visualisation | N | The scan engine can run as of a historical date, but there is no strategy equity curve or trade-marker layer on the chart. | [StockCharts Support](https://support.stockcharts.com/) | unconfirmed (no network access) | med |
| Order entry / P&L overlay | N | No broker integration. | [StockCharts](https://stockcharts.com/) | unconfirmed (no network access) | high |
| Mobile / touch | P | Mobile-optimised web; depth of touch interaction on ACP (drawing manipulation by touch) unconfirmed. | [StockCharts](https://stockcharts.com/) | unconfirmed (no network access) | med |
| Performance ceiling | n/a (different model) | **SharpCharts sidesteps the client-side bar-count question entirely** by rendering a PNG server-side: the limit is the requested date range and image width, and cost is a network round trip per change, not a redraw. ACP is a client-side engine with a conventional (unconfirmed) bar ceiling. Directly relevant to StockMind: a server-render fallback path is a legitimate answer to very long histories. | [StockCharts](https://stockcharts.com/) | unconfirmed (no network access) | high (architecture), unconfirmed (ACP ceiling) |

**Content was rephrased for compliance with licensing restrictions.**

---

## 5. Barchart — detail

| Axis | Present | Notable implementation detail | Source | Published | Confidence |
| --- | --- | --- | --- | --- | --- |
| Chart types — core | Y | Candles, hollow candles, OHLC bars, line, area, plus **futures-native variants (continuation charts, nearest-contract stitching)** that no other Cluster C member treats as first-class. | [Barchart interactive chart](https://www.barchart.com/stocks/quotes/AAPL/interactive-chart) | unconfirmed (no network access) | high (core), med (continuation specifics) |
| Heikin-Ashi | Y | Chart-type selection. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | med |
| Renko | Y | Brick/box size configurable. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | med |
| Kagi | ? | Not asserted. | — | — | unconfirmed |
| Point & Figure | Y | Offered as both a chart type and as dedicated P&F quote pages with signal readouts. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | med |
| Three-line-break | ? | Not asserted. | — | — | unconfirmed |
| Range bars | ? | Not asserted. | — | — | unconfirmed |
| Seasonality chart | Y | **Seasonal/average-year charts** are a distinct chart product (price path averaged across N prior years, overlaid with the current year). A Cluster C differentiator with direct StockMind relevance for commodity/index seasonality. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | high |
| Drawing tool inventory | Y | Moderate set: trendlines, horizontal/vertical, channels, Fibonacci family, retracement/extension, text and shapes. Exact inventory and count unconfirmed. | [Barchart interactive chart](https://www.barchart.com/stocks/quotes/AAPL/interactive-chart) | unconfirmed (no network access) | med |
| Drawing tool count | ? | Not asserted. | — | — | unconfirmed |
| Magnet / snap-to-OHLC | ? | Not asserted. | — | — | unconfirmed |
| Drawing templates / clone | ? | Not asserted. | — | — | unconfirmed |
| Indicator count | P | Marketed in the "100+ studies" band; exact figure unconfirmed. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | med |
| Indicator parameters editable | Y | Study settings dialog per study, with colour/plot options. | [Barchart interactive chart](https://www.barchart.com/stocks/quotes/AAPL/interactive-chart) | unconfirmed (no network access) | high |
| Indicator templates / presets | Y | Chart configurations can be saved as named templates and reapplied; saved charts live in the user account. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | med |
| Multi-pane + resize | Y | Studies render in stacked panes below price; drag-resize behaviour unconfirmed in detail. | [Barchart interactive chart](https://www.barchart.com/stocks/quotes/AAPL/interactive-chart) | unconfirmed (no network access) | med |
| Second-symbol comparison | Y | Comparison symbols can be added to the price plot; **the scale used (shared price axis vs. percent-normalised) is unconfirmed** and is the single most important unknown in this row for StockMind parity. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | med (presence), unconfirmed (scale) |
| Spread / ratio charts | Y | **Futures spread charting is a core product** (inter-delivery and inter-commodity spreads as chartable series, consistent with Barchart's futures data heritage). Equity ratio syntax unconfirmed. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | med-high |
| Bar replay / playback | ? | Not asserted. | — | — | unconfirmed |
| Alerts from chart | P | A substantial alert system exists (price, technical-indicator condition, volume, news) and persists server-side with email/push delivery; **origination from a chart object, and trendline-cross alerts in particular, are unconfirmed** — the documented path is the alerts page. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | med (alerts), unconfirmed (chart-origin) |
| Session / extended-hours shading | ? | Pre/post-market data is published in quote pages; chart-side session shading unconfirmed. | — | — | unconfirmed |
| Holiday gaps | Y | Session-based x-axis. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | high |
| Volume profile (visible/fixed) | ? | Not asserted for either variant. | — | — | unconfirmed |
| Market profile / TPO | ? | Not asserted. Given the futures audience this is worth verifying first on a machine with egress. | — | — | unconfirmed |
| Order-flow footprint | N | No tick-level footprint surface in the retail web product. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | med |
| DOM ladder | P | Bid/ask and market-depth style tables are published for some instruments, but as a quote table, **not a click-to-trade ladder**. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | med |
| Corporate-action adjustment | P | Equity history is split-adjusted; dividend-adjustment default and the availability of an unadjusted series are unconfirmed. Declared in data documentation rather than on the chart. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | med (splits), unconfirmed (dividends) |
| Earnings / dividend / split markers | ? | Barchart publishes earnings/dividend calendars as pages; plotting them as chart flags is unconfirmed. | — | — | unconfirmed |
| News on chart | ? | Not asserted. | — | — | unconfirmed |
| Economic-calendar markers | ? | An economic calendar exists as a page; chart markers unconfirmed. | — | — | unconfirmed |
| Auto pattern recognition | Y | **A server-side chart-pattern engine is a headline feature**: classical patterns (triangles, wedges, pennants, double tops/bottoms, head-and-shoulders, channels, flags) are detected across the universe, listed with detection and target levels, and rendered with the detected lines drawn on the pattern's chart. Pattern detection is a screening product, not a drawing aid. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | high |
| Auto support / resistance | Y | Automatic S/R levels are published per symbol (pivot-derived level sets at multiple strengths) and a **"Barchart Opinion" aggregates many indicator signals into one directional percentage** — an opinionated, pre-computed TA summary. Strong precedent for a StockMind "Rāma verdict" strip. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | high |
| Multi-chart layouts + saved layouts | Y | Dashboard/workspace with chart widgets, plus saved charts per account; exact layout grid options unconfirmed. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | med |
| Watchlist↔chart linking | Y | Watchlists are a core account object and drive chart/quote navigation. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | high |
| Drawings persist on symbol change | ? | Not asserted. | — | — | unconfirmed |
| Image export / publish | Y | Chart image save/print supported; publishing/social sharing beyond a link unconfirmed. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | med |
| Data export (CSV) | Y | **Historical-data download is an explicit, plan-gated entitlement** with daily download quotas — the clearest CSV story in the cluster, and it is metered rather than unlimited. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | high (exists, plan-gated), unconfirmed (quota numbers) |
| Keyboard shortcuts | ? | Not asserted. | — | — | unconfirmed |
| Measurement tool | ? | Not asserted. | — | — | unconfirmed |
| Log / percent / inverted scales | ? | Log scaling very likely present but not asserted without verification; percent and invert unconfirmed. | — | — | unconfirmed |
| Price scale auto vs locked | ? | Not asserted. | — | — | unconfirmed |
| Crosshair sync across charts | ? | Not asserted. | — | — | unconfirmed |
| On-chart backtest visualisation | P | Pattern and opinion signals carry historical performance statistics, but there is no user-authored strategy with trade markers drawn on the chart. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | med |
| Order entry / P&L overlay | P | Portfolio tracking exists; **order entry from the chart is not part of the web product** as far as can be asserted. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | med |
| Mobile / touch | Y | Native mobile applications are published alongside the responsive site. | [Barchart](https://www.barchart.com/) | unconfirmed (no network access) | high |
| Performance ceiling | ? | Not asserted. | — | — | unconfirmed |

**Content was rephrased for compliance with licensing restrictions.**

---

## 6. Investing.com — detail

The central fact: the advanced chart is **a licensed third-party charting-library deployment**. Rows therefore split into *library-inherited* capability and *portal-native* capability, and the gaps are typically "licensed but not enabled".

| Axis | Present | Notable implementation detail | Source | Published | Confidence |
| --- | --- | --- | --- | --- | --- |
| Engine | — | Two surfaces coexist: a lightweight in-house interactive chart on quote pages and a full third-party (TradingView) advanced chart. **Feature answers depend on which surface the user is on** — a pattern StockMind should avoid or make explicit. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | high |
| Chart types — core | Y | Candles, hollow candles, bars, line, area, baseline — the library's standard set. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | high |
| Heikin-Ashi | Y | Library-inherited. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | high |
| Renko / Kagi / P&F / line-break | Y | All four are library-inherited non-time chart types with configurable box/reversal/break parameters. Whether every one is enabled in this specific deployment is `med` confidence. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | med |
| Range bars | P | The library supports range-type bars; enablement in this deployment unconfirmed. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | low |
| Drawing tool inventory / count | Y | Broad library inventory (trendline family, Fibonacci family, Gann, pitchfork, patterns incl. Elliott/harmonic shapes, shapes, text, annotations) numbering in the many dozens. **No count asserted** — deployments can trim the toolbar. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | med |
| Magnet / snap-to-OHLC | Y | Magnet mode is a standard library feature (snap drawing anchors to nearby OHLC values), typically with weak/strong variants. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | med |
| Drawing templates / clone | P | The library provides drawing-template saving and object cloning; availability here depends on whether the deployment persists user objects server-side, which is unconfirmed. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | low |
| Indicator count | Y | ~100 library built-ins. Community/custom scripts are **not** available in a third-party deployment — the key delta versus the first-party product. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | med |
| Indicator parameters editable | Y | Full per-study inputs/style dialog, library-standard. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | high |
| Indicator templates / presets | P | Library supports indicator templates; persistence in this deployment unconfirmed. | — | — | low |
| Multi-pane + resize | Y | Library panes with drag dividers and per-pane scale settings. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | high |
| Second-symbol comparison | Y | Library compare/overlay; the added series normally goes on **its own scale or a percent-normalised scale**, configurable per series. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | med |
| Spread / ratio charts | ? | Expression/spread symbol syntax is a first-party feature and is commonly **absent** from third-party deployments; not asserted. | — | — | unconfirmed |
| Bar replay | P | Replay exists in the first-party product but is **routinely not licensed in embedded deployments**; treat as absent until verified. | — | — | low |
| Alerts from chart | P | Investing.com runs its own alert system (price alerts, economic-event alerts, earnings reminders) with account-side persistence and app push. **Alerts created by right-clicking a chart level or drawn line are unconfirmed**, and portal-native alerts are stored independently of the chart's own object model. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | med (portal alerts), unconfirmed (chart-origin) |
| Session / extended-hours shading | ? | Not asserted. | — | — | unconfirmed |
| Holiday gaps | Y | Session-based x-axis with the library's session handling. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | high |
| Volume profile (visible/fixed) | P | Volume-profile studies are a premium tier of the first-party library and are usually excluded from embedded deployments; not asserted as present. | — | — | low |
| Market profile / TPO | N | Not available in the library's standard study set. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | med |
| Order-flow footprint | N | Requires tick/aggressor data not present here. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | high |
| DOM ladder | N | No order book on the charting surface. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | med |
| Corporate-action adjustment | ? | Adjustment policy is a data-feed property of the host, not the library, and is not clearly declared on the chart. Not asserted. | — | — | unconfirmed |
| Earnings / dividend / split markers | P | The library supports event flags on the price axis and the portal has the underlying earnings/dividend data; **whether flags are switched on by default is unconfirmed**. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | low-med |
| News on chart | ? | The portal is news-heavy, but plotting news markers on the chart is unconfirmed. | — | — | unconfirmed |
| Economic-calendar markers | P | Investing.com's economic calendar is its best-known asset, and the library supports an economic-events marker layer, so this is the **highest-value row to verify** — if enabled it is the cluster's best macro-on-chart implementation. | [Investing.com economic calendar](https://www.investing.com/economic-calendar/) | unconfirmed (no network access) | low-med |
| Auto pattern recognition | N | No automated detection layer; pattern drawing tools are manual. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | med |
| Auto support / resistance | N | Technical-summary pages publish pivot levels as tables, but they are not drawn automatically on the chart. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | med |
| Multi-chart layouts | ? | Not asserted; multi-chart layouts are typically a first-party-only feature. | — | — | unconfirmed |
| Watchlist↔chart linking | Y | Portfolio/watchlist objects navigate the chart. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | med |
| Drawings persist on symbol change | Y | Library behaviour: drawings are bound to the symbol (and often the interval), restored when returning to it, subject to the deployment persisting them. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | med |
| Image export / publish | Y | Library snapshot produces a shareable image/link. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | med |
| Data export (CSV) | P | Historical-data pages offer a download for signed-in users; chart-side export unconfirmed. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | med |
| Keyboard shortcuts | P | Library defaults (interval typing, drawing modifiers, undo/redo, alt-drag constraints) are inherited; a documented shortcut list on the host side is unconfirmed. | — | — | low-med |
| Measurement tool | Y | Library measure tool reports price delta, percent delta and bar/time span in one readout — **the behaviour StockMind should copy as the baseline**: shift-drag anywhere, auto-dismiss on release. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | med |
| Log / percent / inverted scales | Y | Library scale menu provides logarithmic, percentage, indexed-to-100 and invert options. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | high |
| Price scale auto vs locked | Y | Auto-scale toggle plus lock-price-to-bar-ratio and scale-dragging are library standard. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | high |
| Crosshair sync across charts | ? | Depends on a multi-chart layout existing; not asserted. | — | — | unconfirmed |
| On-chart backtest | N | No strategy engine in the deployment (first-party strategy scripting is not exposed). | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | med |
| Order entry / P&L overlay | P | Broker order entry: not asserted. Portfolio positions can be tracked in the portal, but **position/average-price lines drawn on the chart are unconfirmed**. | — | — | unconfirmed |
| Mobile / touch | Y | A major mobile app with touch-adapted charting; the mobile chart is a reduced feature set versus desktop. | [Investing.com](https://www.investing.com/) | unconfirmed (no network access) | high (app), med (reduction) |
| Performance ceiling | ? | Library-dependent; no figure asserted. | — | — | unconfirmed |

**Content was rephrased for compliance with licensing restrictions.**

---

## 7. TrendSpider — detail

The automation-first member of the cluster. Where others give you tools, TrendSpider pre-computes the analysis; this is the most directly instructive platform for a StockMind "Rāma does the TA" positioning.

| Axis | Present | Notable implementation detail | Source | Published | Confidence |
| --- | --- | --- | --- | --- | --- |
| Chart types — core | Y | Candles, bars, line, area, Heikin-Ashi. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | high |
| Chart types — proprietary | Y | **Raindrop charts**: each period is drawn as two volume-weighted price distributions (first half / second half of the period), so a single "bar" encodes where volume actually traded rather than just four prices. The clearest example in the cluster of inventing a bar type to carry more information — and a strong candidate pattern for StockMind. | [TrendSpider — Raindrop charts](https://trendspider.com/) | unconfirmed (no network access) | high |
| Renko / Kagi / P&F / line-break / range bars | ? | Some non-time chart types are supported, but **I will not assert which**; verify the chart-type dropdown directly. | — | — | unconfirmed |
| Drawing tool inventory | Y | Standard manual set (trendlines, horizontals, channels, Fibonacci family, shapes, text) on top of the automated layers. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | med |
| Drawing tool count | ? | Not asserted. | — | — | unconfirmed |
| Magnet / snap-to-OHLC | ? | Not asserted; note that **automated trendline detection reduces the need for snapping**, because the lines are machine-fitted to pivots in the first place. The design insight matters more than the row. | — | — | unconfirmed (snap), high (rationale) |
| Drawing templates / clone | Y | Chart configurations, indicator sets and drawing/alert setups are saved as reusable templates/layouts applied to other symbols. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | med |
| Indicator count | Y | Full conventional library plus **multi-timeframe variants of indicators on a single chart** (e.g. a higher-timeframe moving average plotted on a lower-timeframe chart without switching intervals). The MTF capability, not the count, is the differentiator. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | high (MTF), unconfirmed (count) |
| Indicator parameters editable | Y | Per-indicator settings including the timeframe the indicator is computed on. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | high |
| Indicator templates / presets | Y | Saved indicator sets, applied across symbols. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | med |
| Multi-pane + resize | Y | Stacked panes with resize; multi-timeframe panes of the same symbol side by side is a documented workflow. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | med |
| Second-symbol comparison | Y | Comparison overlay supported; **scale treatment unconfirmed**. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | med (presence), unconfirmed (scale) |
| Spread / ratio charts | ? | Not asserted. | — | — | unconfirmed |
| Bar replay / playback | P | Strategy results can be stepped through visually as part of the tester; a general-purpose "hide the future and replay bar by bar" training mode is **unconfirmed**. | — | — | low |
| Alerts from chart | Y | **The strongest alert model in the cluster: alerts are attached to chart objects.** An alert can be bound to a drawn or auto-detected trendline so that the trigger level moves with the line over time ("dynamic" alerts), as well as to indicator crosses, candle-close conditions and multi-condition logic. Alerts persist server-side and fire regardless of whether the browser is open, with push/SMS/email delivery. This is the single most important feature to model in StockMind's alert schema: **the alert references the drawing's identity, not a frozen price.** | [TrendSpider — dynamic alerts](https://trendspider.com/) | unconfirmed (no network access) | high |
| Session / extended-hours shading | Y | Extended-hours data can be shown with session distinction on intraday charts. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | med |
| Holiday gaps | Y | Session-based axis. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | high |
| Volume profile (visible/fixed) | ? | Not asserted. Raindrop charts and volume-at-price heat layers cover overlapping ground; verify whether a conventional visible-range profile tool exists. | — | — | unconfirmed |
| Market profile / TPO | ? | Not asserted. | — | — | unconfirmed |
| Order-flow footprint | N | No tick aggressor footprint. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | med |
| DOM ladder | N | Not a ladder-trading platform. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | med |
| Corporate-action adjustment | ? | Not asserted; adjustment policy not recalled as a declared chart-side toggle. | — | — | unconfirmed |
| Earnings / dividend / split markers | Y | Earnings markers on the chart are a documented layer, used with earnings-aware backtests and seasonality. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | med |
| News on chart | Y | A news/events layer can be surfaced against the chart timeline. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | low-med |
| Economic-calendar markers | Y | Macro/economic event markers are offered as a chart layer. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | low-med |
| Auto pattern recognition | Y | Automated detection of classical patterns and Fibonacci levels, drawn as real chart objects that can then carry alerts. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | high |
| Auto support / resistance | Y | **Automated trendline and horizontal S/R detection is the flagship**: pivots are found algorithmically, lines are fitted and ranked, and the user tunes sensitivity/number of lines rather than drawing. Note the UX consequence — the primary control surface is a *sensitivity slider*, not a pencil. | [TrendSpider — automated technical analysis](https://trendspider.com/) | unconfirmed (no network access) | high |
| Multi-chart layouts + saved layouts | Y | Multi-chart grid layouts saved as named workspaces/templates. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | med |
| Watchlist↔chart linking | Y | Watchlists drive the chart; scanner results feed watchlists feed charts as one loop. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | med |
| Drawings persist on symbol change | Y | Per-symbol persistence of drawings and their attached alerts, server-side, so a trendline alert survives symbol switching and session end. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | med-high |
| Image export / publish | Y | Chart snapshot/share links for social posting. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | med |
| Data export (CSV) | ? | Not asserted. Backtest/scanner result export is plausible but unverified. | — | — | unconfirmed |
| Keyboard shortcuts | Y | A keyboard-driven workflow is part of the product (symbol search, interval change, tool selection, alert creation). Exact bindings unconfirmed. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | med |
| Measurement tool | Y | Measure tool with price/percent/time readout. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | med |
| Log / percent / inverted scales | Y | Log and percent scaling supported; invert unconfirmed. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | med (log/percent), unconfirmed (invert) |
| Price scale auto vs locked | ? | Not asserted. | — | — | unconfirmed |
| Crosshair sync across charts | Y | Linked crosshair across charts in a multi-chart layout, which is the point of the MTF workflow. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | med |
| On-chart backtest / strategy visualisation | Y | **A strategy tester renders entries, exits and performance against the chart**, with condition builders rather than a scripting language, plus automated "bot" execution of the same strategies. Visual, no-code strategy construction is the model StockMind should study for its projection screen. | [TrendSpider — strategy tester](https://trendspider.com/) | unconfirmed (no network access) | high |
| Order entry / P&L overlay | P | Broker integrations for trade execution have been added over time; **which brokers, and whether positions and P&L are drawn on the chart, is unconfirmed**. | — | — | low |
| Mobile / touch | Y | A mobile app exists in addition to the web app; feature parity is partial. | [TrendSpider](https://trendspider.com/) | unconfirmed (no network access) | med |
| Performance ceiling | ? | Not asserted. | — | — | unconfirmed |

**Content was rephrased for compliance with licensing restrictions.**

---

## 8. Finviz — detail

The deliberate minimalist. Valuable to this study precisely because it proves how much analytical value a *non-interactive* chart can carry when the server does the thinking.

| Axis | Present | Notable implementation detail | Source | Published | Confidence |
| --- | --- | --- | --- | --- | --- |
| Engine | — | Two tiers: **static server-rendered chart images** (free, and still the backbone of the screener's chart views) and an interactive charting surface on the paid tier. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | high |
| Chart types — core | Y | Candles and line, with a small set of timeframes (intraday through monthly). Chart-type choice is intentionally narrow. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | high |
| Heikin-Ashi | ? | Not asserted. | — | — | unconfirmed |
| Renko / Kagi / P&F / line-break / range bars | N | None of the non-time chart types; out of keeping with the product's purpose. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | med |
| Drawing tool inventory / count | P | The interactive chart offers a small manual set (trendline, horizontal line, Fibonacci, text/shapes). **No count asserted.** Free static charts: no drawing at all. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | med |
| Magnet / snap-to-OHLC | N | Not part of the minimal drawing model. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | low-med |
| Drawing templates / clone | N | Not asserted as present. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | low-med |
| Indicator count | P | A short curated list (moving averages, RSI, MACD, Bollinger, ATR, volume-based), chosen rather than exhaustive. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | med |
| Indicator parameters editable | P | Static charts expose **preset choices** (e.g. selecting among standard moving-average periods) rather than free parameter entry; free-form parameter editing on the interactive chart is unconfirmed. This is the cluster's clearest "presets over parameters" stance. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | med |
| Indicator templates / presets | P | Chart settings are persisted per account on paid tiers; named templates unconfirmed. | — | — | low |
| Multi-pane + resize | P | A volume pane and at most one indicator pane on static charts; **no user pane resizing** on the static renderer by construction. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | med |
| Second-symbol comparison | ? | Not asserted. Relative-strength style comparison is handled by the screener and groups pages rather than overlays. | — | — | unconfirmed |
| Spread / ratio charts | N | Not part of the product. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | med |
| Bar replay | N | Not applicable to a static renderer; unconfirmed for the interactive tier but not asserted. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | med |
| Alerts from chart | N | Price alerts exist on the paid tier, but they are created from screener/portfolio contexts, **not from the chart surface**. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | med |
| Session / extended-hours shading | ? | Pre/after-market change is a screener column; chart shading unconfirmed. | — | — | unconfirmed |
| Holiday gaps | Y | Session-based axis. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | high |
| Volume profile / TPO / footprint / DOM | N | None. Finviz carries no microstructure surface at all. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | high |
| Corporate-action adjustment | ? | Split adjustment is presumably applied but is **not declared** on the chart; not asserted. | — | — | unconfirmed |
| Earnings / dividend / split markers | ? | Earnings date is published as data on the quote page, and the quote page chart is widely used around earnings; an explicit chart marker layer is unconfirmed. | — | — | unconfirmed |
| News on chart | N | News is a list beneath the chart, not a chart layer. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | high |
| Economic-calendar markers | N | Not present. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | med |
| Auto pattern recognition | Y | **The defining feature: pattern detection is a screener filter, and the detected pattern's trendlines are drawn directly onto the server-rendered chart image.** Horizontal S/R, trend channels, triangles, wedges, double tops/bottoms, head-and-shoulders, flags/pennants, each selectable as a screen. The user sees the machine's lines on hundreds of charts at a glance, with zero interaction cost. | [Finviz screener](https://finviz.com/screener.ashx) | unconfirmed (no network access) | high |
| Auto support / resistance | P | Delivered through the same pattern filters (horizontal support/resistance, channel) rather than as an always-on S/R layer. | [Finviz screener](https://finviz.com/screener.ashx) | unconfirmed (no network access) | med |
| Multi-chart layouts + saved layouts | Y | The screener's chart view **renders a paginated grid of many small charts at once** (all with pattern overlays), and screener presets are savable. Layout is a function of the query, not a canvas the user arranges — the inverse of every other platform here. | [Finviz screener](https://finviz.com/screener.ashx) | unconfirmed (no network access) | high |
| Watchlist↔chart linking | Y | Portfolio/screener rows link to the symbol chart; the chart grid *is* the list view. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | high |
| Drawings persist on symbol change | N/A | No persistent drawing model on static charts. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | med |
| Image export / publish | Y | **Charts are images, so export is trivially the URL** — a copy/paste-friendly property that made Finviz charts ubiquitous in forum and social posts. A real lesson for StockMind sharing: a stable image endpoint beats an export button. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | high |
| Data export (CSV) | P | Screener result export is a paid-tier entitlement; **OHLC series export is unconfirmed**. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | med |
| Keyboard shortcuts | P | Keyboard navigation through screener/chart pages exists on paid tiers (stepping symbol to symbol); a documented shortcut map is unconfirmed. | — | — | low-med |
| Measurement tool | N | No measurement interaction. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | med |
| Log / percent / inverted scales | P | Log scaling is available as a chart option; percent and invert unconfirmed. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | low-med |
| Price scale auto vs locked | N/A | Server chooses the scale; no user scale manipulation on static charts. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | med |
| Crosshair sync across charts | N | No crosshair on static images. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | high |
| On-chart backtest | N | Finviz has backtesting for screens on paid tiers, but results are presented as statistics and equity output, not as trade markers on a price chart. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | med |
| Order entry / P&L overlay | N | No brokerage integration. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | high |
| Mobile / touch | P | Responsive pages; static chart images are readable on mobile but not manipulable. Native app availability unconfirmed. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | med |
| Performance ceiling | n/a (different model) | **No client-side bar ceiling**: the server rasterises a fixed-size image, so a 20-year daily chart and a 3-month chart cost the client the same. The ceiling is pixel resolution, not bar count. | [Finviz](https://finviz.com/) | unconfirmed (no network access) | high |

**Content was rephrased for compliance with licensing restrictions.**

---

## 9. Cluster C takeaways for StockMind

Ranked by what they imply for implementation, not by how impressive they are.

| # | Finding | Evidence in this cluster | Implication for StockMind |
| --- | --- | --- | --- |
| 1 | **Alerts should reference chart objects, not frozen prices.** | TrendSpider binds an alert to a trendline so the trigger level moves with the line; every other platform in the cluster persists alerts in a separate subsystem keyed by price. | The alert schema needs a stable drawing id + a rule evaluated against the drawing's current geometry, server-side, independent of the browser. Designing this after shipping static price alerts is a migration. |
| 2 | **Derived series are better modelled as symbols than as chart modes.** | StockCharts ratio symbols (`A:B`) make a ratio chartable, indicator-able and alert-able with no special-casing. | A symbol-expression resolver in the data layer gives spread/ratio charts, relative strength and index-vs-stock comparison for one piece of work. |
| 3 | **Server-rendered charts remain a legitimate answer, not a legacy embarrassment.** | SharpCharts and Finviz both render images; Finviz uses that to show hundreds of annotated charts per page, which no interactive engine in this cluster attempts. | Worth having an image-render path for watchlist grids, shared links and very long histories, with the interactive canvas reserved for the focused single chart. |
| 4 | **Automated analysis changes the primary control from a tool to a sensitivity setting.** | TrendSpider's auto-trendlines, Finviz's pattern overlays, Barchart's pattern engine and aggregate opinion. | If Rāma is doing the analysis, the chart UI should expose "how aggressive" and "show me why", not a bigger drawing toolbar. This fits the project's stated direction better than parity on drawing-tool counts. |
| 5 | **Where a platform leans on a licensed third-party chart, capability is set by the licence, not the roadmap.** | Investing.com inherits ~100 indicators, magnet mode and scale options, but loses expressions, replay and premium volume studies. | Any decision to embed a third-party chart in StockMind should be taken with the excluded-feature list in hand up front. |
| 6 | **Microstructure (volume profile, TPO, footprint, DOM) is essentially absent across all of Cluster C.** | Only a volume-by-price style overlay appears (StockCharts), and no TPO or footprint anywhere confirmed. | These are Cluster A/B (pro terminal / broker platform) features. StockMind should not benchmark against Cluster C here; parity is already achieved by having nothing. |
| 7 | **Corporate-action adjustment is poorly declared everywhere in this cluster.** | Every adjustment row above is `P` or `?` — policy lives in support articles, not on the chart. | A visible, declared adjustment state on the chart is a cheap, genuine differentiator, and it matters for Indian-market bonuses and splits specifically. |
| 8 | **Session/extended-hours shading and explicit timezone handling are weakly documented across the cluster.** | Only TrendSpider is asserted at `med` confidence; the rest are unconfirmed. | Consistent with the project's current client-time/UTC work: there is no strong incumbent standard to copy, so get it right and declare it in the UI. |

**Content was rephrased for compliance with licensing restrictions.**

---

## 10. Open verification queue (run from a machine with network egress)

Ordered by value to the gap analysis. Each item is a specific question, not "check the docs".

| # | Question | Platform(s) | Why it matters |
| --- | --- | --- | --- |
| 1 | On a second-symbol comparison, which axis is the overlaid series drawn on, and can the user switch between shared / own / percent-normalised? | all five | Cluster C's most consistently unconfirmed row and a concrete StockMind implementation decision. |
| 2 | Does a bar-replay/playback mode exist, and is it gated by plan? | StockCharts, Barchart, TrendSpider, Investing.com | Decides whether replay is table stakes or a differentiator for StockMind. |
| 3 | Is the economic-events marker layer enabled on the advanced chart? | Investing.com | Would be the cluster's best macro-on-chart precedent if enabled. |
| 4 | Full drawing-tool inventory and count per platform. | all five | Deliberately not estimated here; needed for the gap table. |
| 5 | Magnet / snap-to-OHLC availability and modes. | StockCharts, Barchart, TrendSpider, Finviz | Cheap to implement, high perceived quality; need to know the expected default. |
| 6 | Declared corporate-action adjustment policy and whether an unadjusted series is selectable. | all five | Directly affects data-layer design and backtest correctness. |
| 7 | Which non-time chart types are actually in the chart-type dropdown. | TrendSpider, Barchart, Finviz | Renko/Kagi/P&F/line-break presence left unconfirmed above. |
| 8 | Volume-profile tooling: visible-range vs fixed-range, and value-area/POC semantics. | StockCharts, Barchart, TrendSpider | Determines whether a profile tool is a Cluster C expectation at all. |
| 9 | Documented keyboard-shortcut maps. | all five | Needed to set a coverage target rather than inventing bindings. |
| 10 | Published dates for every cited documentation page. | all five | Every date in this document is currently `unconfirmed (no network access)`. |
| 11 | Broker integrations and whether positions/P&L render on the chart. | TrendSpider, Barchart | Relevant only if StockMind pursues execution; otherwise deprioritise. |
| 12 | Any stated or observable bar-count performance ceiling. | Barchart, Investing.com, TrendSpider | The performance axis is almost entirely unfilled for the interactive engines. |

**Content was rephrased for compliance with licensing restrictions.**
