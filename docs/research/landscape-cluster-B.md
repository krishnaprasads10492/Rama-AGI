# Chart Feature Landscape — Cluster B: Indian retail brokers and the Indian analytics layer

Scope: **Zerodha Kite** (ChartIQ + TradingView builds), **Upstox** (Upstox × TradingView, Chart 360), **Groww** (Groww Charts), **Dhan** (tv.dhan.co + DEXT T3 terminal), **FYERS** (Advanced Charts, FYERS × TradingView), **Angel One** (web/app + TradingView broker integration), **ICICI Direct**, plus **Trendlyne** and **Sensibull** as the analytics-layer comparison.

Why this cluster matters most: the project owner trades **NSE/BSE cash and F&O on an IST session of 09:15–15:30**. Everything in this cluster is built against that session, that holiday calendar, that corporate-action regime and that market-depth feed. Cluster A tells us what charting *can* be; Cluster B tells us what an Indian retail trader has already been trained to expect, and therefore what StockMind is implicitly being compared against.

Research date: **2026-10-01**. Method: direct HTTPS retrieval of official vendor pages (`curl` + HTML-to-text extraction), vendor sitemaps, and vendor machine-readable summaries (`llms.txt`). No blogs, review sites, forums or YouTube were used as the basis of any row.

---

## 1. Method, and the exact meaning of each verdict

| Item | Detail |
| --- | --- |
| Retrieval | Every row not marked `?` was read off a live official vendor page in this session. The cited URL is the URL that was fetched. |
| Source preference | Vendor support portals and vendor product pages only. Where a vendor publishes no documentation for an axis, that is recorded as a finding rather than filled in from memory. |
| Published dates | **None of the Indian broker support pages carry a visible publication or revision date.** Zerodha, Upstox, FYERS, Dhan, Groww, Angel One and ICICI Direct print only a copyright year. TradingView's library docs print only a copyright year. No date is ever guessed; where a vendor prints one it is recorded. |
| Licensing | No source is reproduced at length. Everything below is a summary, apart from unavoidable short UI labels and setting names. **Content was rephrased for compliance with licensing restrictions.** |
| Marketing claims | Several rows rest on vendor *marketing* pages rather than support documentation (Upstox, FYERS, Dhan, Angel One, Groww publish feature claims on product pages but little chart documentation). These are flagged `Y (vendor claim)` so that they are not mistaken for verified behaviour. |

### Legend

| Symbol | Meaning |
| --- | --- |
| `Y` | Present, read in an official vendor page this session |
| `Y (claim)` | Asserted on a vendor product/marketing page; no support-documentation confirmation found |
| `N` | Vendor explicitly states it is absent, **or** the vendor publishes an enumerated list for that axis and the feature is not in it |
| `N (no doc)` | Vendor's own searchable documentation set contains nothing on this axis — evidence of absence, not proof |
| `P` | Partial: restricted variant, one surface only, or available only via a separate product |
| `?` | Unconfirmed. Not asserted either way. |

---

## 2. The single most important structural fact in this cluster

Six of the seven brokers do not write their own chart engine. They embed one of two commercial libraries, and **the library edition caps the feature set before the broker writes a line of code.** Any gap analysis that ignores this will misattribute a vendor limitation to a vendor choice.

| Library / edition | What it includes | What it does **not** include | Source |
| --- | --- | --- | --- |
| TradingView **Advanced Charts** (free edition) | Chart, drawings, indicators, marks, snapshots, chart layouts, indicator templates, extended sessions, inactivity gaps, price-scale modes | **Renko, Point-and-Figure, Line Break and Kagi are absent.** Multiple-chart layout, crosshair/symbol/interval/time sync, Depth of Market, watchlist widget, news widget, order entry, order/position overlay, P&L display, drawing templates, chart (colour) templates, seconds-from-ticks are all **Trading Platform only**. | [Trading Platform overview](https://www.tradingview.com/charting-library-docs/latest/trading_terminal/); [Saving and loading](https://www.tradingview.com/charting-library-docs/latest/saving_loading/) |
| TradingView **Trading Platform** (access-restricted edition) | Everything in Advanced Charts, plus up to 8 synchronised charts per layout, chart trading, DOM, watchlist, details, news, Account Manager, advanced order ticket, buy/sell buttons and bid/ask lines, Renko/P&F/Line Break/Kagi, drawing templates, seconds bars from ticks | — | [Trading Platform overview](https://www.tradingview.com/charting-library-docs/latest/trading_terminal/) |
| TradingView **drawing inventory** (both editions) | Enumerated by TradingView: trend tools incl. Anchored VWAP, Gann/Fibonacci family, geometric shapes, annotation tools, chart-pattern tools incl. Elliott and XABCD, prediction/measurement tools incl. long/short position, bars pattern, ghost feed and **Fixed range volume profile as a drawing**, plus stickers and Twemoji emojis. Actions include Measure, Zoom in, **Weak magnet / Strong magnet**, stay-in-drawing-mode, lock all, hide all. | A *visible range* volume profile is not in the drawings list. | [Drawings List](https://www.tradingview.com/charting-library-docs/latest/ui_elements/drawings/Drawings-List) |
| TradingView **persistence model** | A chart layout carries drawings, indicators, colours and settings. Indicator templates are a separate object. Storage is the integrator's responsibility — `localStorage` or a server. | **The visible time range is deliberately excluded from a saved layout**; the library is designed to re-open on the most recent data. Drawing templates and chart templates are Trading Platform only. | [Saving and loading](https://www.tradingview.com/charting-library-docs/latest/saving_loading/) |
| **ChartIQ** (Cosaic) — Zerodha Kite's default engine | Public SDK index enumerates a large drawing class family (trendline, channel, ray, crossline, pitchfork, Gann fan, Fibonacci arc/fan/projection/time-zone, Elliott wave, Gartley, regression, quadrant, Tirone, speed arc/line, time cycle, measure, measurement line, long/short position, **volumeprofile**, freeform, shapes, annotation, callout), plus `CIQ.MarketDepth`, `CIQ.ExtendedHours`, `CIQ.TFC` (trade from chart), `CIQ.UI.Multichart`, `CIQ.Workspaces`, `CIQ.SignalIQ` (study-condition signals), `CIQ.ScriptIQ` (custom studies), `CIQ.Share`, `CIQ.Shortcuts`, `CIQ.CSVReader`, `CIQ.RangeSlider`, `CIQ.ContinuousZoom`, `CIQ.VisualEarnings`, `CIQ.Marker.TimeSpanEvent`, `CIQ.Comparison`, `CIQ.CrossSection`, `CIQ.Renderer.Heatmap`. | SDK capability ≠ broker exposure. Kite exposes only a subset; see §4 and §16. | [ChartIQ SDK Documentation index](https://documentation.chartiq.com/) |

**Content was rephrased for compliance with licensing restrictions.**

### 2.1 The one TradingView fact that directly explains a known StockMind defect

> A saved chart layout does **not** include the visible time range; the library always re-opens showing the most recent data. — [Saving and loading charts](https://www.tradingview.com/charting-library-docs/latest/saving_loading/)

The industry reference implementation deliberately does not persist zoom/visible-range inside the layout object. It instead provides an explicit imperative API — `setVisibleRange({ from })` with an `applyDefaultRightMargin` option — to be called after data load. — [Chart](https://www.tradingview.com/charting-library-docs/latest/ui_elements/Chart)

**Content was rephrased for compliance with licensing restrictions.**

---

## 3. Platform roster: engine, surfaces, and the one fact that drives most of its rows

| Platform | Chart engine | Surfaces | Driving fact | Source |
| --- | --- | --- | --- | --- |
| Zerodha Kite | **Two engines, user-switchable.** ChartIQ is the default; TradingView is opt-in. Switched from the profile menu on web, Settings on app. | Kite web, Kite app | Feature parity between the two engines is **not** maintained, so almost every Kite answer is "it depends which engine you chose". Zerodha also states plainly that Kite cannot be connected to third-party charting applications; ChartIQ and TradingView inside Kite are the only options. | [How to switch between charts on Kite?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/how-do-i-switch-to-tradingview-charts); [Can third-party charting applications be connected with Kite?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/third-party-charting-libraries) |
| Upstox | TradingView library (Upstox × TradingView web platform) + **Chart 360**, an in-house options-on-chart surface | Pro Web, Upstox × TradingView, Chart 360 web and mobile | Upstox markets the chart as a **tick-by-tick engine** and sells the chart by trader persona (scalper / momentum / options / long-term), each persona bundling different chart features. Seconds-resolution charting (1s, 5s, 10s, 15s, 30s) is the headline. | [Upstox × TradingView](https://upstox.com/tradingview-chart/); [Chart 360](https://upstox.com/trade-on-charts/) |
| Groww | **In-house, mobile-first** chart renderer | Groww app (Android; iOS stated as "launching soon"), Groww Terminal / 915 Terminal on web | Groww optimised for *load and tick latency* rather than analytical breadth: it publishes 0.6 s chart load and 0.2 s tick latency as the selling point, and names roughly nine indicators. | [Groww Charts](https://groww.in/groww-charts) |
| Dhan | TradingView library at `tv.dhan.co`, **plus** a true broker integration on tradingview.com, **plus** DEXT T3 desktop terminal with its own widgets | Dhan app, Dhan Web, Options Trader app/web, tv.dhan.co, DEXT T3 desktop | Dhan treats the TradingView surface as a first-class trading terminal — option chain on right-click, basket orders, live P&L, position management, 20+ layouts — rather than as an analysis window. | [Dhan + TradingView](https://dhan.co/tradingview/); [DEXT T3](https://dhan.co/dext-t3-trading-terminal/) |
| FYERS | In-house "Advanced Charts" (seconds-capable) **plus** FYERS × TradingView | FYERS Web and app, FYERS Next (desktop), FYERS One (desktop analytics), FYERS Trader, Scalper Terminal, InstaOptions | FYERS is the only broker in this cluster that documents an **order-flow chart**, a **price ladder**, **5-second bars**, **50-level market depth** and **one-click alert creation from the chart**. It also publishes a machine-readable site index. | [Advanced Charts](https://fyers.in/advanced-charts); [Real-time alerts](https://fyers.in/alerts); [llms.txt](https://fyers.in/llms.txt) |
| Angel One | In-house web charts (vendor states 100+ indicators); **TradingView charts in the app**; separately an integrated broker on tradingview.com | Angel One web, Angel One app, tradingview.com | Angel One's richest chart story is explicitly *someone else's product*: its TradingView page describes tradingview.com capability (400+ indicators, 110+ drawing tools, 13 alert conditions, Pine Script, Strategy Tester, DOM) reached by connecting the account. | [Platforms and Tools](https://www.angelone.in/platform-and-tools); [Trade with Angel One on TradingView](https://www.angelone.in/tradingview) |
| ICICI Direct | Not disclosed on any page retrieved | Web platform, Markets app, Spring (algo backtest / paper trading) | ICICI Securities lists "Advanced Charts" as a named platform feature in its own disclaimer text but publishes **no charting documentation**. Nearly every axis is therefore `?`. | [Stocks](https://www.icicidirect.com/stocks); [Spring](https://www.icicidirect.com/futures-and-options/spring) |
| Trendlyne | Analytics layer, not a trading chart | Web, app | Structure is **tab-per-dataset** on a stock page: Charts & Report, Technicals, Price History/Seasonality, Corporate Actions, Alerts, plus a site-wide Data Downloader and Events Calendar. Alerts are email/WhatsApp, not chart-native. | [Trendlyne alerts](https://trendlyne.com/alerts/); stock page structure read from a live equity page |
| Sensibull | Options analytics layer, not a price-charting platform | Web, broker-embedded (Zerodha, Angel One, Upstox, ICICI Direct logins offered) | Sensibull's published tool list contains **no general price chart**: Strategy Builder, Option Chain, Draft Portfolios, Open Interest, Multi Straddle/Strangle Charts, FII–DII Data, Screener. Its charts are derived-series charts. | [Sensibull](https://sensibull.com/) |

**Content was rephrased for compliance with licensing restrictions.**

---

## 4. Cross-platform presence matrix

Orientation only; detail and sources are in §5 onward. KITE-C = Kite on ChartIQ, KITE-T = Kite on TradingView, UPX = Upstox, GRW = Groww, DHN = Dhan, FYR = FYERS, ANG = Angel One, ICD = ICICI Direct, TRL = Trendlyne, SNB = Sensibull.

| # | Axis | KITE-C | KITE-T | UPX | GRW | DHN | FYR | ANG | ICD | TRL | SNB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Candle / bar / line / area | Y | Y | Y | Y | Y | Y | Y | ? | Y | P |
| 2 | Heikin-Ashi | Y | Y | ? | ? | ? | ? | ? | ? | N (no doc) | N |
| 3 | Renko | Y | ? | ? | ? | ? | ? | ? | ? | N (no doc) | N |
| 4 | Kagi | ? | N | ? | ? | ? | ? | ? | ? | N (no doc) | N |
| 5 | Point & Figure | ? | N | ? | ? | ? | ? | ? | ? | N (no doc) | N |
| 6 | Line break | ? | N | ? | ? | ? | ? | ? | ? | N (no doc) | N |
| 7 | Range bars | ? | ? | ? | ? | ? | ? | ? | ? | N (no doc) | N |
| 8 | Seconds resolution | ? | ? | Y | ? | ? | Y | ? | ? | N | N |
| 9 | Drawing inventory enumerated by vendor | N (no doc) | N (no doc) | N (no doc) | N (no doc) | P | N (no doc) | Y 110+ (claim, tradingview.com) | ? | N (no doc) | N |
| 10 | Magnet / snap-to-OHLC | ? | ? | ? | ? | ? | ? | ? | ? | ? | N |
| 11 | Drawing templates | ? | N | ? | ? | ? | ? | ? | ? | ? | N |
| 12 | Drawing clone | ? | ? | ? | ? | ? | ? | ? | ? | ? | N |
| 13 | Indicator count stated by vendor | N (no doc) | N (no doc) | Y 100+ | Y ~9 named | ? | Y 100+ | Y 100+ web / 400+ via TV | ? | ? | N |
| 14 | Indicator parameters editable | Y | Y | Y | Y (claim) | Y (claim) | Y (claim) | Y (claim) | ? | ? | N |
| 15 | Indicator templates / saved views | Y | Y | ? | ? | Y (claim) | ? | ? | ? | ? | N |
| 16 | Multi-pane + maximise pane | Y | Y | ? | ? | ? | ? | ? | ? | ? | N |
| 17 | Second-symbol comparison | Y | Y | Y (claim) | ? | ? | ? | Y (claim) | ? | ? | N |
| 18 | Comparison scale used | % | % | ? | ? | ? | ? | ? | ? | ? | — |
| 19 | Spread / ratio charts | N (no doc) | N (no doc) | N (no doc) | N (no doc) | N (no doc) | N (no doc) | N (no doc) | ? | N (no doc) | P |
| 20 | Bar replay / playback | N (no doc) | N (no doc) | Y (claim) | ? | ? | ? | Y (claim, tradingview.com) | ? | N | N |
| 21 | Alert created **from the chart** | ? | ? | ? | ? | ? | Y (claim) | Y (claim, tradingview.com) | ? | N | N |
| 22 | Indicator / technical-condition alert | N | N | Y (claim) | ? | Y (claim) | Y (claim) | Y (claim, tradingview.com) | ? | P SMA only | ? |
| 23 | Trendline-cross alert | N | N | ? | ? | ? | ? | Y (claim, tradingview.com) | ? | N | N |
| 24 | Session / extended-hours shading | ? | ? | ? | ? | ? | ? | ? | ? | — | — |
| 25 | Holiday / no-trade gap handling | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| 26 | Volume profile (visible range) | ? | N | ? | ? | ? | ? | ? | ? | N | N |
| 27 | Volume profile (fixed range) | ? | Y (library) | ? | ? | Y (library) | ? | Y (claim, tradingview.com) | ? | N | N |
| 28 | Market profile / TPO | N (no doc) | N (no doc) | N (no doc) | N (no doc) | N (no doc) | N (no doc) | N (no doc) | ? | N | N |
| 29 | Order-flow footprint | N (no doc) | N (no doc) | N (no doc) | N (no doc) | N (no doc) | Y | N (no doc) | ? | N | N |
| 30 | Depth-of-market ladder | P 20-depth, not on chart | P | P Depth 30 | ? | Y DEXT ladder | Y 50-depth + price ladder | Y (claim, tradingview.com) | ? | N | N |
| 31 | Corporate-action adjustment declared | Y | Y | ? | ? | ? | ? | ? | ? | ? | — |
| 32 | Split / dividend / bonus markers on chart | Y | Y | ? | ? | ? | ? | ? | ? | P tab, not chart | N |
| 33 | Earnings markers | ? | ? | ? | ? | ? | ? | ? | ? | P tab | N |
| 34 | News on chart | N (no doc) | N (no doc) | ? | ? | ? | ? | Y (claim, tradingview.com) | ? | P tab | N |
| 35 | Economic-calendar markers on chart | N (no doc) | N (no doc) | Y (claim) Macro Data Suite | ? | ? | ? | ? | ? | P Events Calendar | P |
| 36 | Auto pattern recognition | N (no doc) | N (no doc) | Y (claim) | ? | ? | ? | ? | ? | ? | N |
| 37 | Auto support / resistance | N (no doc) | N (no doc) | Y (claim) S&D indicator | ? | ? | Y FIA, assistant-driven | ? | ? | ? | N |
| 38 | Multi-chart layouts | Y | Y up to 8 | ? | ? | Y 20+ | Y up to 8 | Y (claim) | ? | N | N |
| 39 | Saved layouts / templates | Y views, cloud | P see §13 | ? | ? | Y (claim) | Y (claim) | ? | ? | ? | N |
| 40 | Drawings survive symbol change | ? | P per-instrument on app | ? | ? | ? | ? | ? | ? | ? | — |
| 41 | Chart image export | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| 42 | Chart publish / share link | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| 43 | Data export (CSV) | N (no doc) | N (no doc) | N (no doc) | N (no doc) | N (no doc) | N (no doc) | N (no doc) | ? | Y Data Downloader | ? |
| 44 | Keyboard shortcuts documented | ? | P Alt+G | P Shift+B / Shift+S | ? | Y DEXT keyboard trading | Y hotkey KB articles exist | ? | ? | ? | N |
| 45 | Measurement tool | Y SDK | Y library | ? | ? | ? | ? | ? | ? | ? | N |
| 46 | Log scale | Y | Y | ? | ? | ? | Y (claim) | ? | ? | ? | N |
| 47 | Percent scale | ? | ? | ? | ? | ? | ? | ? | ? | ? | N |
| 48 | Inverted scale | Y | Y | ? | ? | ? | Y (claim) | ? | ? | ? | N |
| 49 | Per-indicator Y-axis control | Y | ? | ? | ? | ? | ? | ? | ? | ? | N |
| 50 | Crosshair sync across charts | ? | ? | Y (claim) chart sync | ? | ? | ? | Y (claim) | ? | N | N |
| 51 | Backtest visualised from the chart | Y Streak CTB | Y Streak CTB | Y (claim) | ? | ? | Y Automate backtest | Y (claim, tradingview.com) | Y Spring | P back-test module | N |
| 52 | Order entry from chart | Y TFC | Y TFC | Y Chart 360 | Y | Y | Y | Y (claim) | ? | N | P via broker |
| 53 | Position / P&L overlay on chart | ? | Y configurable | Y | ? | Y | ? | Y (claim) | ? | N | N |
| 54 | Mobile / touch chart | Y | Y | Y | Y mobile-first | Y | Y | Y | ? | Y | ? |
| 55 | Performance ceiling published | N | N | N | P latency figures | N | N | N | N | N | N |

**Content was rephrased for compliance with licensing restrictions.**

---

## 5. Chart types and resolutions

| Platform | Confirmed types | Renko / Kagi / P&F / Line break / Range bars | Seconds | Notable implementation detail |
| --- | --- | --- | --- | --- |
| Kite (ChartIQ) | Candlestick, Heikin-Ashi (both confirmed as the only two types the Streak backtest hook accepts), **Renko** | Renko `Y`. Kagi / P&F / Line break / Range bars `?` — not documented by Zerodha. | `?` | Zerodha documents a genuine Renko correctness caveat: bricks inside the **currently selected chart period** are recalculated as ticks arrive and can retrace back to any brick within that period; only completed periods are permanent. This is a real analytical hazard that most vendors do not disclose. — [Renko brick retracement](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/renko-bar-retracement) |
| Kite (TradingView) | Candlestick, Heikin-Ashi | Kagi / P&F / Line break are **absent from the free Advanced Charts edition** per TradingView's own docs; whether Zerodha licenses Trading Platform is not stated anywhere on Zerodha's site, so Renko on the TradingView build is `?`. | `?` | [Trading Platform overview](https://www.tradingview.com/charting-library-docs/latest/trading_terminal/) |
| Upstox | Candlestick + TradingView library types | `?` | **Y — 1s, 5s, 10s, 15s, 30s** | Seconds timeframes are sold as a scalper feature alongside "tick-by-tick charts". Upstox also claims "years of historical minutes data". — [Upstox × TradingView](https://upstox.com/tradingview-chart/) |
| Groww | Candlestick (chart-type list not published) | `?` | `?` | Vendor publishes latency, not type inventory: 0.6 s chart load, 0.2 s tick latency, 58.5 M orders placed on charts. — [Groww Charts](https://groww.in/groww-charts) |
| Dhan | TradingView library types | `?` | `?` | Dhan's differentiator is not bar type but **right-click → Option Chain from any option chart**, and AVWAP exposed as a drawing tool. — [Dhan + TradingView](https://dhan.co/tradingview/) |
| FYERS | Candlestick + "volume candles"; FYERS × TradingView page claims **15+ chart types** | `?` individually | **Y — 5-second intervals** | FYERS publishes **25+ years of historical data** for long-term pattern study on the same chart surface. — [Advanced Charts](https://fyers.in/advanced-charts); [FYERS × TradingView](https://fyers.in/trading-view) |
| Angel One | In-app TradingView charts; tradingview.com route claims **20+ chart types** | `?` individually | `?` | The 20+ types belong to tradingview.com's own product, reached by linking the Angel One account — not to Angel One's in-house web charts. — [Trade with Angel One on TradingView](https://www.angelone.in/tradingview) |
| ICICI Direct | `?` | `?` | `?` | "Advanced Charts" named as an ICICI Securities feature in site disclaimer text; no chart documentation published. — [Stocks](https://www.icicidirect.com/stocks) |
| Trendlyne | Price/seasonality graphs inside tabbed stock pages | `N (no doc)` | `N` | Not a bar-type platform. Price History / Seasonality is a separate tab from Charts & Report. |
| Sensibull | Derived-series charts only (straddle/strangle price, OI) | `N` | `N` | Published tool list contains no general price chart. — [Sensibull](https://sensibull.com/) |

**Content was rephrased for compliance with licensing restrictions.**

---

## 6. Drawing tools: inventory, magnet, templates, clone

No Indian broker publishes a drawing-tool inventory or count. The counts in circulation (110+, 50+) are **library** or **tradingview.com** numbers that the brokers quote, not broker-verified inventories.

| Platform | Inventory published? | Magnet / snap-to-OHLC | Templates | Clone | Notable detail |
| --- | --- | --- | --- | --- | --- |
| Kite (ChartIQ) | No. ChartIQ's SDK index exposes ~50 drawing classes including `volumeprofile`, `elliottwave`, `gartley`, `pitchfork`, `gannfan`, `fibarc`, `fibfan`, `fibprojection`, `fibtimezone`, `measure`, `measurementline`, `longposition`, `shortposition`, `quadrant`, `tirone`, `speedarc`, `speedline`, `timecycle`. **Which of these Kite surfaces is undocumented.** | `?` | `?` | `?` | The SDK/exposure gap is the central uncertainty for Kite's default engine. — [ChartIQ SDK index](https://documentation.chartiq.com/) |
| Kite (TradingView) | No. Library inventory applies. | Library provides **Weak magnet and Strong magnet** as named actions; Kite does not document whether it exposes them. | **`N`** — drawing templates are Trading Platform only per TradingView. | Library binds clone to Ctrl+Drag. | [Drawings List](https://www.tradingview.com/charting-library-docs/latest/ui_elements/drawings/Drawings-List); [Shortcuts](https://www.tradingview.com/charting-library-docs/latest/configuration/Shortcuts) |
| Upstox | No | `?` | `?` | `?` | Drawing capability is described only as part of the TradingView bundle. |
| Groww | No | `?` | `?` | `?` | Vendor markets drawings as "one tap" add/modify; no inventory. — [Groww Charts](https://groww.in/groww-charts) |
| Dhan | Partial — Dhan explicitly names **AVWAP as a drawing tool**, "customizable and easy to use", and says drawing tools are available free after Dhan+TradingView account setup. | `?` | Marking indicators as favourite and saving chart layouts are named; drawing templates are not. | `?` | AVWAP-as-a-drawing is the only drawing Dhan calls out by name. — [Dhan + TradingView](https://dhan.co/tradingview/) |
| FYERS | No; FYERS × TradingView page claims **50+ tools** | `?` | "Draw, annotate and save your analysis across devices" — cross-device drawing persistence is claimed. | `?` | [Advanced Charts](https://fyers.in/advanced-charts); [FYERS × TradingView](https://fyers.in/trading-view) |
| Angel One | **110+ drawing tools** claimed — but for tradingview.com, not for Angel One's own charts. AVWAP named separately. | `?` | `?` | `?` | [Trade with Angel One on TradingView](https://www.angelone.in/tradingview) |
| ICICI Direct | `?` | `?` | `?` | `?` | — |
| Trendlyne | `N (no doc)` | `N` | `N` | `N` | — |
| Sensibull | `N` | `N` | `N` | `N` | — |

**Content was rephrased for compliance with licensing restrictions.**

---

## 7. Indicators: count, editability, templates

| Platform | Count | Parameters editable | Templates / presets | Notable detail |
| --- | --- | --- | --- | --- |
| Kite (ChartIQ) | Not published by Zerodha | `Y` — Zerodha documents right-click → Edit Settings on an indicator, including Y-axis selection | **`Y` — "Views"**: time frame + chart type + indicator set saved as a named View, stored in **cloud** and synced across devices, then committed with Layout → Save preferences | The ChartIQ build has the better persistence story of Kite's two engines: Views are cloud-synced by design. — [How to save the time frame, chart style, and indicator settings as a view on ChartIQ](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/how-to-save-my-chart-settings-and-indicators-on-kite-charts) |
| Kite (TradingView) | Not published. Zerodha states Kite uses a **built-in indicator library, not the public tradingview.com library**, so community/Pine indicators from tradingview.com are unavailable inside Kite. | `Y` | Library supports indicator templates (both editions) | This is the cleanest statement of broker-vs-tradingview.com divergence found anywhere in the cluster. — [Why are some TradingView indicators unavailable on Kite TradingView charts?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/features-available-on-trading-view-not-available-in-the-trading-view-library-at-zerodha) |
| Upstox | **100+** | `Y (claim)` | `?` | Upstox ships **proprietary indicators**: a Supply & Demand indicator, plus an OI package (OI Profile, OI Build-up) plotted on the chart. — [Upstox × TradingView](https://upstox.com/tradingview-chart/) |
| Groww | **~9 named**: Bollinger Bands, Volume, Moving Average, Supertrend, EMA, RSI, VWAP, Pivot Points, MACD | `Y (claim)` — "switch through and modify them easily" | `?` | The smallest documented indicator surface in the cluster, deliberately so. — [Groww Charts](https://groww.in/groww-charts) |
| Dhan | `?` | `Y (claim)` | Favourite-marking of indicators + layout saving | — [Dhan + TradingView](https://dhan.co/tradingview/) |
| FYERS | **100+ including FYERS-exclusive indicators** | `Y (claim)` | `?` | FYERS also documents an **Open Interest indicator** and publishes guidance on reading OI against price on its charts. — [Advanced Charts](https://fyers.in/advanced-charts) |
| Angel One | **100+** on the web platform; **400+** on the tradingview.com route | `Y (claim)` | `?` | Two different numbers for two different products on the same brand. — [Platforms and Tools](https://www.angelone.in/platform-and-tools); [Angel One on TradingView](https://www.angelone.in/tradingview) |
| ICICI Direct | `?` | `?` | `?` | — |
| Trendlyne | Not a chart indicator surface; technicals are tabular | `?` | `?` | — |
| Sensibull | `N` | `N` | `N` | — |

**Content was rephrased for compliance with licensing restrictions.**

### 7.1 Kite's Streak backtest hook — the only fully enumerated indicator list in the cluster

Zerodha publishes the exact indicator set that Chart-to-Backtest accepts, which is a useful proxy for "indicators Zerodha considers first-class": Money Flow Index, ADX, Moving Averages, Williams %R, Stochastics, Moving Average Deviation, Supertrend, Bollinger Bands, PSAR, Pivot Points (Standard), Volume, MACD, CCI, VWAP, Detrended, ATR, Aroon, Aroon Oscillator, On Balance Volume, Momentum, RSI. Unsupported indicators silently fall back to a price-action strategy; unsupported timeframes snap to the nearest supported one; unsupported chart types fall back to candlesticks. Supported timeframes are 1, 3, 5, 10, 15, 30 minutes, 1 hour and day. BSE and BSE-Currency segments are excluded. — [How to use the backtest feature on Kite Charts?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/backtest-on-kite-charts)

**Content was rephrased for compliance with licensing restrictions.**

---

## 8. Panes, scales, crosshair

| Platform | Multi-pane management | Pane resize | Log | Percent | Inverted | Price-scale auto vs locked | Crosshair sync | Notable detail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kite (ChartIQ) | `Y` — a **Maximise pane** control appears beside an indicator name, and only appears once more than one indicator is on the chart | `?` (maximise/restore documented; drag-resize not) | `Y` Settings → Log Scale | `?` | `Y` Settings → Invert; **separately, per-indicator Y-axis settings** via right-click → Edit Settings | `?` | `?` | Per-indicator axis control is a real Kite/ChartIQ capability and is documented. Zerodha also publishes a dedicated article on why an indicator's axis value can differ from the price scale — evidence the dual-axis model confuses users. — [Maximise pane](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/maximise-pane); [Scales and axis](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/scales-and-axis-charts) |
| Kite (TradingView) | `Y` | `?` | `Y` Settings → Scales → Log Scale | `?` | `Y` | `?` | `?` | Kite documents only Log Scale and Left/Right axis positioning under Settings → Scales. Library-level extras (percent scale, pin-to-scale, up to 8 price scales, reset price scale) exist in the library but are **not** documented by Zerodha. — [Scales and axis](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/scales-and-axis-charts); [Price Scale](https://www.tradingview.com/charting-library-docs/latest/ui_elements/Price-Scale) |
| Upstox | `?` | `?` | `?` | `?` | `?` | `?` | **`Y (claim)` "Chart sync"**, offered across all four trader personas | Chart sync is the only cross-chart synchronisation feature any Indian broker markets by name. — [Upstox × TradingView](https://upstox.com/tradingview-chart/) |
| Groww | `?` | `?` | `?` | `?` | `?` | `?` | `?` | — |
| Dhan | `Y` 20+ layouts | `?` | `?` | `?` | `?` | `?` | `?` | — |
| FYERS | `Y` up to 8 charts | `?` | `Y (claim)` "advanced scale options" documented as a KB topic for the app | `?` | `Y (claim)` same KB topic | `?` | `?` | A KB article titled for advanced scale options on app charts exists in the FYERS index; its body is behind a client-side-rendered portal and could not be read, so the specifics are `?`. — [llms.txt index](https://fyers.in/llms.txt) |
| Angel One | `Y (claim)` multi-chart layouts, multi-monitor workspace, **"Synchronized Crosshairs & Tabs"** | `?` | `?` | `?` | `?` | `?` | `Y (claim)` | Multi-monitor is claimed for the tradingview.com desktop route. — [Angel One on TradingView](https://www.angelone.in/tradingview) |
| ICICI Direct | `?` | `?` | `?` | `?` | `?` | `?` | `?` | — |
| Trendlyne / Sensibull | `N` | `N` | `?` | `?` | `?` | `?` | `N` | — |

**Content was rephrased for compliance with licensing restrictions.**

---

## 9. Comparison / overlay of a second symbol, and spread–ratio charts

| Platform | Second-symbol overlay | Scale used for the overlay | Spread / ratio chart | Notable detail |
| --- | --- | --- | --- | --- |
| Kite (both engines) | `Y` — a **Compare** control on both ChartIQ and TradingView; removal is right-click on the comparison line → delete/Remove | **Percentage from the starting price to the current price** — explicitly stated by Zerodha, so it is a *relative-performance* overlay, not a dual-price overlay | `N (no doc)` | Two hard limitations Zerodha states outright: **live ticks stop while comparison is active**, and comparison is **web-only**, not yet on the app. A comparison that kills streaming is a significant UX compromise and worth noting as an anti-pattern. — [How to compare the relative performance of stocks and indices on Kite?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/compare-relative-performance-between-stocks-and-indices) |
| Upstox | `Y (claim)` — "Indices Smartlists: analyse indices, scrips, underlyings, and heatmaps in one view"; Chart 360 shows **CE/PE plus the index chart on one screen** | `?` | `N (no doc)` | Chart 360's comparison is purpose-built for options: strike selection happens on the **Y-axis of the underlying chart**, which then reveals Call/Put buttons and a chart icon for the respective CE/PE chart. This is the most Indian-market-specific chart interaction found in the whole study. — [Chart 360](https://upstox.com/trade-on-charts/) |
| Groww | `?` | `?` | `N (no doc)` | — |
| Dhan | `?` | `?` | `N (no doc)` | — |
| FYERS | `?` | `?` | `N (no doc)` — but FYERS publishes a *teaching* chapter on using ratio charts for relative strength, which implies the concept is supported somewhere in the product; the platform surface is unconfirmed | `?` | [Using Ratio Charts to Identify Relative Strength](https://fyers.in/school-of-stocks/chapter/intermarket-analysis-and-sector-rotation/using-ratio-charts-to-identify-relative-strength.html) |
| Angel One | `Y (claim)` "Cross-Asset Comparison — compare multiple assets on one screen" | `?` | `N (no doc)` | — [Angel One on TradingView](https://www.angelone.in/tradingview) |
| ICICI Direct | `?` | `?` | `?` | — |
| Trendlyne | `?` | `?` | `N (no doc)` | — |
| Sensibull | — | — | **`P`** — Multi Straddle/Strangle Charts are themselves synthetic-combination series, which is the options analogue of a spread chart | Listed under Advanced tools. — [Sensibull](https://sensibull.com/) |

**Content was rephrased for compliance with licensing restrictions.**

---

## 10. Bar replay, backtesting, and strategy visualisation on the chart

| Platform | Bar replay | Backtest reachable from the chart | What is visualised | Notable detail |
| --- | --- | --- | --- | --- |
| Kite (both engines) | `N (no doc)` — Zerodha's 1,443-URL support sitemap contains **no article matching "replay"** | **`Y` — Chart to Backtest (CTB)**, a Streak-powered button on the chart that converts the plotted chart and indicators into conditions and returns backtest results | Backtest results, not an on-chart equity curve (not stated) | The honest framing Zerodha publishes is worth copying: CTB is explicitly stated **not** to be advice, and the indicator/timeframe/chart-type fallbacks are published rather than hidden. — [Backtest on Kite Charts](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/backtest-on-kite-charts) |
| Upstox | **`Y (claim)` Bar replay** — offered to scalper, options-strategy and momentum personas | `Y (claim)` "Backtesting & Bar Replay — build, validate, refine strategies with historical data"; plus a Strategy Builder that visually constructs, analyses and **backtests** multi-leg option strategies | `?` | Upstox is the only Indian broker to market **bar replay** as a named chart feature. — [Upstox × TradingView](https://upstox.com/tradingview-chart/) |
| Groww | `?` | `?` | `?` | — |
| Dhan | `?` | `?` | `?` | Dhan's ScanX screener offers instant trade execution from screens, which is the adjacent capability. — [Dhan + TradingView](https://dhan.co/tradingview/) |
| FYERS | `?` | `Y` — **Automate**, a no-code rule-based order workflow builder, with a documented backtest order/price matching model | `?` | A KB article on how orders and prices are matched in the Automate backtest exists in the index, which implies published fill-model assumptions — rare and valuable. — [Automate](https://fyers.in/automate); [llms.txt index](https://fyers.in/llms.txt) |
| Angel One | `Y (claim)` via tradingview.com | `Y (claim)` Strategy Tester, Pine Script, Portfolio Simulation | `?` | All on the tradingview.com side. — [Angel One on TradingView](https://www.angelone.in/tradingview) |
| ICICI Direct | `?` | **`Y` — Spring**, described as backtesting and paper trading for algo strategies | `?` | The only confirmed ICICI Direct analytical capability in this study. — [Spring](https://www.icicidirect.com/futures-and-options/spring) |
| Trendlyne | `N` | `P` — a back-test module exists (`/fundamentals/back-test/runhistory/` appears in robots.txt), oriented to screeners rather than charts | `?` | — [robots.txt](https://trendlyne.com/robots.txt) |
| Sensibull | `N` | `P` — Strategy Builder analyses and records trades; Draft Portfolios track hypothetical positions | `?` | — [Sensibull](https://sensibull.com/) |

**Content was rephrased for compliance with licensing restrictions.**

---

## 11. Alerts: created from the chart, condition types, and persistence

This is the sharpest differentiator in Cluster B, and the axis where Zerodha — otherwise the strongest documenter — is weakest.

| Platform | Created from chart? | Conditions supported | Persistence / delivery | Notable detail |
| --- | --- | --- | --- | --- |
| **Zerodha Kite** | **Not documented from the chart.** Zerodha's documented creation paths are: instrument → More → Create Alert (web) / Set alert (app), or Orders → Alerts → New alert. | **Quote data only.** Zerodha enumerates: OHLC; percentage (day change, intraday change); price (LTP, ATP); quantity (total buy/sell quantity); **Open Interest day high/low**; volume traded; last traded quantity. Operators: `>`, `>=`, `<`, `<=`, `=`. | **Server-side, broker-hosted.** Delivery is an in-app notification on Kite web/app **plus email**. Alerts are free. | Three statements, all from Zerodha, bound the feature: (a) *"You can only set price alerts on Kite"* — technical-indicator alerts require **Streak**, which supports 80+ indicators; (b) the **advanced alerts** feature that existed in the retired Sentinel product was **not carried over** to Kite; (c) alerts can be upgraded into **ATO (Alert Triggers Orders)** — an alert that fires a linked basket of **up to 20 instruments** as market orders with market-price protection. ATO is the most interesting idea in the cluster: an alert is not a notification, it is a trigger for a pre-built basket. — [What are Kite alerts and how to use them?](https://support.zerodha.com/category/trading-and-markets/alerts-and-nudges/kite-alerts/articles/what-are-kite-alerts-and-how-do-i-use-them); [Can I set alerts based on technical indicators on Kite?](https://support.zerodha.com/category/trading-and-markets/alerts-and-nudges/kite-alerts/articles/set-a-technical-indicator-based-alert-using-sentinel); [Why can't I find the advanced alerts feature on Kite?](https://support.zerodha.com/category/trading-and-markets/general-kite/others-kite/articles/not-able-to-view-the-advanced-alerts-option); [What is Alert Triggers Orders (ATO)?](https://support.zerodha.com/category/trading-and-markets/alerts-and-nudges/kite-alerts/articles/what-is-alert-triggers-order-ato) |
| **FYERS** | **`Y (claim)` — "Create alerts directly from charts", one-click** | Price, plus **"advanced data triggers … OHLC with custom conditions"**; separately, **Automate** can create alerts and **place an order based on the alert** | Multi-device: web and mobile, "perfectly synced real-time notifications" | FYERS is the only broker in the cluster that markets chart-native alert creation as a first-class feature, and it closes the loop to order placement. — [Real-time alerts](https://fyers.in/alerts) |
| **Dhan** | `?` | **`Y (claim)` "Price & Technical Alerts"** — notification when a stock hits a price **or a technical condition** | `?` | Listed under DEXT T3's "We keep innovating" section. — [DEXT T3](https://dhan.co/dext-t3-trading-terminal/) |
| **Upstox** | `?` | **`Y (claim)` Price alerts (all personas) + Technical alerts (momentum and long-term personas)**; GTT triggers described as "optimised" by the tick-by-tick engine | `?` | Upstox separates *price alerts* from *technical alerts* as distinct marketed features. — [Upstox × TradingView](https://upstox.com/tradingview-chart/) |
| **Angel One** | `Y (claim)` — "Real-Time Alerts: set alerts based on price or indicators"; the tradingview.com route claims **13 alert conditions** across price, indicators and strategies | Price, indicator, strategy (tradingview.com) | `?` | [Angel One on TradingView](https://www.angelone.in/tradingview) |
| **Groww** | `?` | `?` | `?` | Groww's help set (956 articles) contains no alert documentation. |
| **ICICI Direct** | `?` | **`Y` GTT (Good Till Triggered)** as an order type, which is adjacent to but not the same as an alert | `?` | — [GTT order](https://www.icicidirect.com/equity-products/gtt-order) |
| **Trendlyne** | `N` — alerts are created from the Alerts section, scoped by index/sector/market-cap/portfolio/watchlist | **Price, PE, PEG, SMA, volume change, new research reports, Superstar activity, daily deals** | **Email**, with optional **WhatsApp** delivery; managed under Manage Notifications | Trendlyne is the only platform in the cluster offering **fundamental-metric alerts (PE, PEG)** and **research-report alerts**, and the only one offering WhatsApp delivery. Its alert scoping by index/sector/cap-band is also unusually expressive. — [Trendlyne alerts](https://trendlyne.com/alerts/) |
| **Sensibull** | `N` | `?` | `?` | No alert product in the published tool list. |

**Content was rephrased for compliance with licensing restrictions.**

### 11.1 Alert-model taxonomy observed in Cluster B

| Model | Who does it | Consequence |
| --- | --- | --- |
| Quote-threshold alert, created away from the chart, server-side, email + push | Zerodha Kite | Simple and reliable; cannot express "RSI crossed 70" or "price crossed my trendline" |
| Quote + OHLC-condition alert, **created on the chart**, device-synced | FYERS | Matches how traders actually think while looking at a chart |
| Price **and** technical-condition alert | Dhan, Upstox, Angel One (via TradingView) | Needs server-side indicator evaluation, not just a quote comparator |
| Alert → order (alert as automation trigger) | Zerodha ATO (basket of up to 20), FYERS Automate | Turns the alert store into an execution surface; raises the correctness bar sharply |
| Fundamental / research-event alert | Trendlyne | Different data plane entirely; email-first delivery is acceptable because latency does not matter |

**Content was rephrased for compliance with licensing restrictions.**

---

## 12. Sessions, holidays, gaps, timezone

This axis is almost entirely undocumented by Indian brokers, which is itself informative: with a single 09:15–15:30 IST session and no retail extended-hours trading, brokers have had no reason to build or document session shading.

| Platform | Session shading | Extended hours | Holiday / no-trade gap handling | Timezone handling | Notable detail |
| --- | --- | --- | --- | --- | --- |
| Kite (both) | `?` | `?` — NSE/BSE pre-open 09:00–09:15 exists and Zerodha documents pre-market and post-market *orders*, but nothing about rendering them on a chart | `?` | `?` | Zerodha publishes two articles that are really about session/aggregation semantics without naming them: why daily and hourly OHLC differ, and why intraday OHLC can differ from the exchange's published record. Both are session-boundary and aggregation issues. — [What are pre-market and post-market sessions and orders?](https://support.zerodha.com/category/trading-and-markets/trading-faqs/market-sessions/articles/what-are-pre-market-and-post-market-sessions-and-orders); [OHLC on daily vs hourly charts](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/why-are-the-ohlc-values-on-daily-and-hourly-charts-different) |
| All other Indian brokers | `?` | `?` | `?` | `?` | No vendor page retrieved addresses session shading or holiday gaps. |
| Library capability (for reference) | TradingView supports an **extended session** composed of regular/pre-market/post-market subsessions drawn as coloured areas, enabled by the `pre_post_market_sessions` featureset plus `subsession_id`/`subsessions` in symbol info, with per-subsession colour overrides and a bottom-toolbar session switcher. **Extended sessions render only on intraday resolutions.** | — | TradingView **hides periods with no trading activity by default** to keep the chart continuous. Whitespace gaps are opt-in via the `inactivity_gaps` featureset, which also adds a user checkbox in Chart settings (off by default), and gaps are only drawn **inside** the instrument's trading session. | ChartIQ exposes `CIQ.ExtendedHours` and a `timezoneJS` namespace; TradingView has a dedicated time-zone subsystem. | The default-hidden-gaps behaviour is the correct default for NSE equities and explains why no Indian broker needed to document it. — [Extended Sessions](https://www.tradingview.com/charting-library-docs/latest/connecting_data/time-and-sessions/Extended-Sessions); [Chart](https://www.tradingview.com/charting-library-docs/latest/ui_elements/Chart) |

**Content was rephrased for compliance with licensing restrictions.**

---

## 13. Microstructure: volume profile, market profile/TPO, order-flow footprint, depth ladder

Cluster B is thin here, with one clear exception.

| Platform | Volume profile (visible range) | Volume profile (fixed range) | Market profile / TPO | Order-flow footprint | Depth-of-market ladder | Notable detail |
| --- | --- | --- | --- | --- | --- | --- |
| Kite (ChartIQ) | `?` | `?` | `N (no doc)` | `N (no doc)` | **`P`** — **20-level market depth (Level 3)** for NSE stocks, but reached from the marketwatch or the order window, **not from the chart** | Zerodha states it is the only retail broker offering this Level 3 data, NSE stocks only; regular Level 2 shows 5 bids/offers. The capability exists but is not wired to the chart surface. ChartIQ's SDK does expose `CIQ.MarketDepth` and `CIQ.Drawing.volumeprofile`, so this is an exposure decision, not a library limit. — [What is the 20 market depth feature?](https://support.zerodha.com/category/trading-and-markets/general-kite/kite-mw/articles/view-20-depth); [ChartIQ SDK index](https://documentation.chartiq.com/) |
| Kite (TradingView) | **`N`** — a visible-range volume profile is not in the library's drawings list | `Y (library)` — **Fixed range volume profile** is an enumerated drawing in both library editions; whether Kite exposes it is `?` | `N (no doc)` | `N (no doc)` | `P` same 20-depth, off-chart | DOM is a Trading Platform-only widget in TradingView's model. — [Drawings List](https://www.tradingview.com/charting-library-docs/latest/ui_elements/drawings/Drawings-List); [Trading Platform](https://www.tradingview.com/charting-library-docs/latest/trading_terminal/) |
| Upstox | `?` | `?` | `N (no doc)` | `N (no doc)` | **`Y` Depth 30** plus a **Depth Rank** and a **Slippage** feature, all attributed to the tick-by-tick engine; **OI Profile** and **OI Build-up** plot open-interest structure on the chart | "OI Profile" is the options-market analogue of a volume profile and is the most microstructure-like chart overlay any Indian broker markets. — [Upstox × TradingView](https://upstox.com/tradingview-chart/) |
| Groww | `?` | `?` | `N (no doc)` | `N (no doc)` | `?` | — |
| Dhan | `?` | `Y (library)` `?` exposure | `N (no doc)` | `N (no doc)` | **`Y`** — DEXT T3 provides a **Ladder Watch** trading mode and "access the full market depth: every bid and offer stacked across price levels"; the TradingView surface exposes **option and futures chain** for liquidity/depth while charting | Dhan is the only broker with a ladder as a *named workspace mode* alongside chart trading and scalping modes. — [DEXT T3](https://dhan.co/dext-t3-trading-terminal/); [Dhan + TradingView](https://dhan.co/tradingview/) |
| **FYERS** | `?` | `?` | `N (no doc)` | **`Y`** — FYERS publishes KB topics titled for **reading the order flow chart** and for **how buy and sell quantities are classified in order flow** | **`Y`** — **50-market depth** marketed on the Advanced Charts page, plus a **price ladder** feature on FYERS Trader (KB topic) | FYERS is the only platform in Cluster B with documented order-flow analytics. Article bodies sit behind a client-rendered Zoho portal and could not be read, so the *content* is `?` while the *existence* of the feature is confirmed from the vendor's own index. — [Advanced Charts](https://fyers.in/advanced-charts); [llms.txt index](https://fyers.in/llms.txt) |
| Angel One | `?` | `Y (claim, tradingview.com)` | `N (no doc)` | `N (no doc)` | **`Y (claim)` Depth of Market (DOM)** on the tradingview.com route, described as market depth and order flow | The DOM belongs to TradingView's Trading Platform product, not Angel One's own charts. — [Angel One on TradingView](https://www.angelone.in/tradingview) |
| ICICI Direct | `?` | `?` | `?` | `?` | `?` | — |
| Trendlyne / Sensibull | `N` | `N` | `N` | `N` | `N` | Sensibull does publish **Open Interest** and **OI-based** analytics, but as its own dataset views rather than chart overlays. |

**Content was rephrased for compliance with licensing restrictions.**

---

## 14. Corporate actions, event markers, news, economic calendar

| Platform | CA adjustment declared? | Split / dividend / bonus / rights markers | Earnings markers | News on chart | Economic-calendar markers | Notable detail |
| --- | --- | --- | --- | --- | --- | --- |
| **Kite (ChartIQ)** | **`Y`, and unusually explicit** | **`Y`** — dividends, stock splits, bonus issues and rights issues, shown **from the ex-date onwards**. Path: **Events → Financial events**, then click a tag for detail (web); flag icon → Financial events (app). | `?` | `N (no doc)` | `N (no doc)` | Two published limits that matter: corporate-action marks are **not available in multi-chart mode**, and the marks only go back to **2014**. A separate article explains that historical candle values can change after a refresh — i.e. the adjustment is applied asynchronously, which is exactly the failure mode a charting module must design for. — [How to view the corporate actions on Kite charts?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/corporate-actions-on-kite-charts); [Why has the value of historical candles changed after a refresh?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/value-of-historical-candles-on-refresh) |
| **Kite (TradingView)** | `Y` | **`Y`, on by default.** Hidden via right-click → **Hide marks on bars**; re-shown by deselecting it. **The preference is not saved to the default layout.** On the app the marks **cannot be hidden at all.** | `?` | `N (no doc)` | `N (no doc)` | The "preference not persisted" detail is a concrete persistence bug-class worth avoiding. — [Corporate actions on Kite charts](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/corporate-actions-on-kite-charts) |
| Upstox | `?` | `?` | `?` | `?` | **`Y (claim)` "Macro Data Suite"** for the long-term-investor persona | Closest thing to economic-calendar integration in the cluster. — [Upstox × TradingView](https://upstox.com/tradingview-chart/) |
| Groww | `?` | `?` — Groww has a **Stock Events** product (dividends, bonus, buybacks) but it is a separate page, not documented as chart marks | `?` | `?` | `?` | — [Groww Charts](https://groww.in/groww-charts) |
| Dhan | `?` | `?` | `?` | `?` | `?` | — |
| FYERS | `?` — a KB topic exists on how bonus shares are adjusted in holdings (portfolio, not chart) | `?` | `?` | `?` | `?` | FYERS does publish a KB topic on switching a chart to daily/weekly/monthly and choosing **FII or DII** series, which is an India-specific flow-data overlay. — [llms.txt index](https://fyers.in/llms.txt) |
| Angel One | `?` | `?` | `?` | **`Y (claim)` "Live News Stream"** on the tradingview.com route | `?` | — [Angel One on TradingView](https://www.angelone.in/tradingview) |
| ICICI Direct | `?` | `?` | `?` | `?` | `?` | — |
| Trendlyne | — | **`P`** — Corporate Actions is a dedicated tab (All / Dividend / Bonus / Split / Rights / Board Meetings) on each stock page, not chart marks | **`P`** — Results tab, Earnings Calls under News, plus a site-wide **Events Calendar** | **`P`** — News tab with All / News / Earnings Calls / Corporate Announcements / Research Reports | **`P`** Events Calendar | Trendlyne has by far the richest *event dataset* in the cluster and the weakest *chart integration* of it. The datasets are tabs, not overlays. |
| Sensibull | — | `N` | `N` | `N` | `P` | — |
| Library capability (reference) | — | TradingView provides **marks on bars** (circles with one or two characters, hover/tap tooltip, plain-text only unless Trading Platform's custom web-component tooltips are used) and **marks on the time scale** (shapes above the axis, optional image URL). Both are pulled from the integrator's datafeed via `supports_marks` / `supports_timescale_marks` and `getMarks` / `getTimescaleMarks` **for the visible range only**. | — | News is a Trading Platform widget fed by RSS or the library API | — | The visible-range request model is the key design constraint: marks must be queryable by time window, not fetched wholesale. — [Marks](https://www.tradingview.com/charting-library-docs/latest/ui_elements/Marks) |

**Content was rephrased for compliance with licensing restrictions.**

---

## 15. Auto pattern recognition and auto support/resistance

| Platform | Auto candlestick / chart patterns | Auto support & resistance | Notable detail |
| --- | --- | --- | --- |
| Kite (both engines) | `N (no doc)` | `N (no doc)` — but Zerodha documents **Pivot Points (Standard)** and **Central Pivot Range (CPR)** studies, including how CPR levels are derived and why manually computed pivots can differ from the study's | CPR is a distinctly Indian-retail study; Zerodha treating it as a first-class documented study is a market-expectation signal. — [How are the pivot points derived while using CPR?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/how-are-pivot-points-derived-while-using-the-cpr); [Pivot points on Kite charts](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/pivot-points-on-kite-charts) |
| Upstox | **`Y (claim)`** — "Candlestick Patterns: automatically get key price action patterns plotted on charts" | **`Y (claim)`** — a proprietary **Supply & Demand indicator**, and "spot key support/resistance levels" named as a Chart 360 outcome | The only broker in the cluster marketing automatic pattern plotting. — [Upstox × TradingView](https://upstox.com/tradingview-chart/); [Chart 360](https://upstox.com/trade-on-charts/) |
| FYERS | `?` | **`Y`, assistant-driven** — **FIA**, the FYERS AI assistant, has published KB topics for *"How do I get FIA to mark support and resistance on my chart"* and *"How do I ask FIA to mark RSI and MACD on my chart"*, plus *"How does FIA analyse my current chart and timeframe"* and *"Does FIA change my saved chart layout"* | **This is the most directly relevant precedent in the entire study for Rāma/StockMind.** FYERS has shipped an LLM-style assistant whose actions are *chart mutations* — drawing levels, adding indicators — and it has had to publish an answer to the question "does the assistant clobber my saved layout". That question is the integration contract any AI-driven charting module must define. — [llms.txt index](https://fyers.in/llms.txt) |
| Dhan / Groww / Angel One / ICICI Direct | `?` | `?` | — |
| Trendlyne | `?` | `?` — Technicals tab carries computed levels; chart integration unconfirmed | — |
| Sensibull | `N` | `N` | — |

**Content was rephrased for compliance with licensing restrictions.**

---

## 16. Layouts, templates, watchlist↔chart linking, and drawing persistence

Kite is documented in enough detail here to be treated as a case study, and its persistence model is **inconsistent between engines and between web and app** — a cautionary tale.

| Platform | Multi-chart layouts | Saved layouts / templates | Where stored | Drawings vs symbol change | Watchlist ↔ chart linking | Notable detail |
| --- | --- | --- | --- | --- | --- | --- |
| **Kite (ChartIQ)** | `Y` — multi-chart documented for ChartIQ on Kite web | **Views** (timeframe + chart type + indicators), then Layout → Save preferences | **Cloud, synced across devices** | `?` | `?` | Zerodha publishes a known defect: multiple ChartIQ charts can open in the **default theme** rather than the saved one. — [Save views on ChartIQ](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/how-to-save-my-chart-settings-and-indicators-on-kite-charts) |
| **Kite (TradingView) — web** | **`Y`, up to 8 charts.** Select Layout → pick count → set instrument per pane → Save; instruments can also be added by clicking Chart on an instrument. | Chart layout, saveable as a custom layout and reloadable | **Browser cache / local device memory** on Kite web | Lost on cache clear | Instrument can be pushed into a pane from the instrument's Chart action | **Zerodha publishes the four ways drawings get destroyed**: clearing browser/app cache; switching browser, PC or mobile; exceeding the saved-layout cap (**stated as usually up to 10**), where the oldest layout is evicted; and logging into Kite with a different user ID in the same browser. — [View multiple charts on TradingView](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/view-multiple-charts-in-tradingview); [Why are drawings getting deleted?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/drawings-getting-deleted-from-the-tradingview-chart) |
| **Kite (TradingView) — app** | `?` | Save icon on the chart | **Cloud** — "the layout saves to the cloud, allowing you to access it on any device" | **Per-instrument**: saved drawings become the **default layout for that specific instrument's chart** | `?` | So on Kite: **app = cloud + per-instrument default; web = local cache + eviction at ~10 layouts.** Same broker, same engine, opposite durability guarantees. A separate article documents the cloud quota being hit — error *"Chart preference limit reached"* — remedied via a **Manage layouts and drawings** dialog reachable from the search icon. — [How to save TradingView chart drawings on Kite app?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/how-do-i-save-tradingview-chart-drawings-on-kite-3-mobile); [Chart preference limit reached](https://support.zerodha.com/category/trading-and-markets/alerts-and-nudges/kite-error-messages/articles/chart-preference-limit-reaches) |
| Upstox | `?` | `?` | `?` | `?` | **`Y (claim)`** — **Watchlist import** / "Watchlist package" is marketed for every persona, and Chart 360 keeps charts and trades **in sync across devices** | Watchlist *import* (bulk add) is a distinctly Indian-retail need and no other broker in the cluster markets it. — [Upstox × TradingView](https://upstox.com/tradingview-chart/) |
| Groww | `?` | `?` | `?` | `?` | `?` — Terminal is positioned as "charts, orders, positions, watchlists in one place" | — [Groww Charts](https://groww.in/groww-charts) |
| **Dhan** | **`Y` — 20+ layouts** on the big screen; DEXT T3 adds **30+ widgets, 7 prebuilt layouts, 6 themes** and **dynamic widget linking** | `Y (claim)` — saving chart layouts and favouriting indicators | `?` | `?` | **`Y`** — DEXT widgets can be **linked** so changing the symbol in one widget propagates across the workspace; DEXT also **restores windows to the exact state of the last action** | Highest layout count in the cluster, and the only documented **widget-linking** model. — [Dhan + TradingView](https://dhan.co/tradingview/); [DEXT T3](https://dhan.co/dext-t3-trading-terminal/) |
| FYERS | `Y` up to 8 charts; KB topic exists for multi-chart layouts on FYERS Trader | `Y (claim)` — "save your analysis across devices" | Cross-device implied | `?` | KB topics exist for predefined and custom watchlists | FYERS also publishes a KB topic on whether its AI assistant mutates the **saved chart layout** — see §15. — [Advanced Charts](https://fyers.in/advanced-charts); [llms.txt index](https://fyers.in/llms.txt) |
| Angel One | `Y (claim)` multi-chart layouts + multi-monitor workspace | `?` | `?` | `?` | `?` | — [Angel One on TradingView](https://www.angelone.in/tradingview) |
| ICICI Direct | `?` | `?` | `?` | `?` | **`Y`** — a "Watchlist" web-platform feature is listed in site navigation | — [Watchlist / web platform navigation](https://www.icicidirect.com/futures-and-options/products/my-watchlist) |
| Trendlyne | `N` | `?` | `?` | `N` | **`Y`** — Watchlist and Portfolio are first-class, and alerts can be scoped to *all watchlist stocks* or *all portfolio stocks* | Portfolio/watchlist-scoped alerting is a genuinely good idea: the user never re-enumerates symbols. — [Trendlyne alerts](https://trendlyne.com/alerts/) |
| Sensibull | `N` | `?` | `?` | `N` | `?` | — |

**Content was rephrased for compliance with licensing restrictions.**

---

## 17. Export, sharing, and data download

| Platform | Chart image export | Share / publish link | CSV / data export | Notable detail |
| --- | --- | --- | --- | --- |
| Kite (both engines) | `?` — Zerodha's sitemap has **no article matching "snapshot", "screenshot" (chart), "export" or "CSV"**. Zerodha does document opening a chart in a **new browser tab**. | `?` | `N (no doc)` from the chart. Historical data for expired F&O contracts is a documented KB topic, and bulk data is available through **Kite Connect APIs** rather than the chart. | The absence is consistent across 1,443 support URLs, so this is evidence rather than a gap in searching. — [Open the chart in a new tab](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/open-the-chart-in-a-new-tab) |
| Upstox / Groww / Dhan / FYERS / Angel One / ICICI Direct | `?` | `?` | `N (no doc)` | No vendor page retrieved documents chart image export, publish links or CSV export. |
| **Trendlyne** | `?` | `?` | **`Y` — a site-wide "Data Downloader"** appears in primary navigation on every page | The only confirmed data-export route in Cluster B, and it belongs to the analytics layer, not a broker. — stock-page navigation, e.g. [a live equity page](https://trendlyne.com/equity/1023/INFY/infosys-ltd/) |
| Sensibull | `?` | `?` | `?` | — |
| Library capability (reference) | TradingView's snapshot menu ships **Download image** and **Copy image** by default. **Copy link**, **Open in new tab** and **Tweet image** are opt-in and require the integrator to **run their own snapshot server** (POST endpoint returning the stored image URL); TradingView notes the retention policy is the integrator's responsibility, that no custom menu entries can be added beyond the five predefined ones, and that unwanted ones are removed with custom CSS. | — | — | This explains the cluster-wide absence of share links: publishing a chart requires the broker to operate image hosting, which none of them has chosen to do. — [Snapshots](https://www.tradingview.com/charting-library-docs/latest/ui_elements/Snapshots) |

**Content was rephrased for compliance with licensing restrictions.**

---

## 18. Keyboard shortcuts and the measurement tool

| Platform | Documented shortcuts | Measurement tool | Notable detail |
| --- | --- | --- | --- |
| Kite (TradingView) | **`Shift + B`** = buy market order, **`Shift + S`** = sell market order (Trade-from-Charts); **`Alt + G`** = go to a specific date and time | `Y` (library `Measure` action; Kite does not document it) | Kite documents only the shortcuts it added for trading, plus Alt+G. On the app, Go-to-date is a calendar icon, and **time selection is only offered for intraday timeframes (1-minute to 3-hour)**. — [Trade from Charts on TradingView](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/trade-from-charts-on-tradingview); [Go to a specific date](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/go-to-specific-date-on-chart) |
| Kite (ChartIQ) | `?` (ChartIQ exposes `CIQ.Shortcuts` and `CIQ.UI.KeystrokeHub`) | `Y` SDK (`CIQ.Drawing.measure`, `CIQ.Drawing.measurementline`) | — [ChartIQ SDK index](https://documentation.chartiq.com/) |
| Dhan | **`Y`** — DEXT T3: "Trade at the Speed of Keys — buy, sell and manage all your trades instantly using just your keyboard" | `?` | Keyboard-first trading is a headline DEXT feature, not an afterthought. — [DEXT T3](https://dhan.co/dext-t3-trading-terminal/) |
| FYERS | **`Y`** — separate KB topics for **FYERS Next hotkeys** and for **FYERS Trader hotkeys to simplify the charting experience** | `?` | The only broker with a KB article explicitly framing hotkeys as a *charting* aid. — [llms.txt index](https://fyers.in/llms.txt) |
| Upstox / Groww / Angel One / ICICI Direct / Trendlyne / Sensibull | `?` | `?` | — |
| Library baseline (reference) | TradingView's library ships a documented shortcut set, and explicitly notes that **the shortcut-help dialog seen on tradingview.com is not part of the library** — integrators must build their own. Chart: `Ctrl+K` quick search, `Ctrl+S` save layout, `Ctrl+Z`/`Ctrl+Y`, type-to-change-symbol, digit-to-change-interval, arrow-key bar stepping, `Shift+wheel` pan, `Ctrl+↑/↓` zoom, double-click pane = maximise, `Ctrl`+double-click = collapse, `Alt+G` go-to-date, `Alt+S` snapshot-to-clipboard, `Alt+R` reset, **`Alt+I` invert scale, `Alt+L` log scale, `Alt+P` percent scale**, `Alt+Z` keyboard navigation. Drawings: `Shift`-hold = **measure tool**, `Ctrl` while moving a point = **temporarily toggle magnet**, `Ctrl+Drag` = **clone drawing**, `Ctrl+Alt+H` = hide all drawings, `Alt+T/H/V/C/F` = trendline / horizontal / vertical / crossline / Fib retracement, `Alt+Shift+R` = rectangle, `Shift` constrains shapes and angles. Trading Platform adds `Tab` chart switching, `Alt+Enter` maximise chart, `Alt+W` add to watchlist. | — | This is the de-facto shortcut vocabulary Indian users carry over, because four of the brokers embed this library. — [Shortcuts](https://www.tradingview.com/charting-library-docs/latest/configuration/Shortcuts) |

**Content was rephrased for compliance with licensing restrictions.**

---

## 19. Order entry, position and P&L overlay from the chart

This is the axis where Indian retail brokers are genuinely ahead of the global norm — chart trading is table stakes here, not a premium feature.

| Platform | Order entry from chart | Order modification | Position / P&L overlay | Notable detail |
| --- | --- | --- | --- | --- |
| **Kite (TradingView) — Trade from Charts** | **`Y`.** Buy/Sell buttons at the top of the chart show the **top ask** and **top bid** respectively. Market orders via the buttons or `Shift+B`/`Shift+S`. Limit and stop-loss orders: hover the desired price → click the **plus icon** → choose limit or stoploss → quantity → confirm. | **Drag the order to a new price.** By default dragging opens the order window; enabling **instant order placement** modifies immediately without the window. `x` cancels the order or squares off. | **`Y`, on by default**, with a **Positions** toggle to hide them for a cleaner chart, and a P&L checkbox with **three display modes: rupee value, tick-size count, or percentage of investment.** | The three P&L display modes are the most thoughtful detail found in the cluster, and the "drag opens a confirm window unless you opt into instant" default is the right safety posture. — [Trade from Charts on TradingView](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/trade-from-charts-on-tradingview) |
| **Kite (ChartIQ) — TFC** | **`Y`** — Zerodha publishes a separate Trade-from-Charts article for the ChartIQ engine; ChartIQ exposes `CIQ.TFC` | `?` | `?` | Both engines have chart trading; only the TradingView one is documented in depth. — [How to Trade From Charts (TFC) on ChartIQ at Zerodha?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/what-is-the-trade-from-chart-feature-how-can-i-use-it) |
| **Upstox — Chart 360** | **`Y`, and options-native.** Tap the **Y-axis of the index chart** to pick a strike → Call/Put buttons appear → choose side → quantity → Market/Limit. The CE/PE chart then opens to set limit price, target and stop-loss by scrolling or typing. | Tap a position on the chart to adjust target/stop-loss | **`Y`** — real-time P&L three ways: on the underlying chart by selecting the strike, on the CE/PE chart, and in the Positions tab; exit via the Positions tab, by clicking on the chart, or an **Exit All** button | **Target and stop-loss set this way are placed as GTT orders.** Up to **8-leg** strategies can be built with pre-defined target/stop-loss. This is the most Indian-specific chart-trading design in the study: the chart's Y-axis doubles as a strike selector. — [Chart 360](https://upstox.com/trade-on-charts/) |
| **Groww** | **`Y`** — "Place orders, set SL/TGT, switch instruments — all without leaving your chart view" | `?` | `?` | Groww reports **58.5 M orders** placed through charts, which is the only volume evidence of chart trading adoption published in the cluster. — [Groww Charts](https://groww.in/groww-charts) |
| **Dhan** | **`Y`** — instant orders from charts on desktop and mobile, **drag-and-drop order placement**, **stop-loss-limit from the chart**, **basket orders** (new or existing baskets) executed from the chart, and a **native TradingView order console** | Drag and drop to a new level | **`Y`** — real-time P&L on `tv.dhan.co` for all positions, with **Manage Positions** to add quantity, reverse, or exit | Basket execution from the chart is unique to Dhan in this cluster. Dhan is also one of the four Indian brokers with a true **tradingview.com** broker integration, so orders can originate on TradingView's own site. — [Dhan + TradingView](https://dhan.co/tradingview/) |
| **FYERS** | **`Y`** — "Trade From Charts: spot an opportunity and act instantly without leaving the chart"; "place, modify and exit directly from charts"; KB topics exist for placing orders from charts and from the option chain | `Y (claim)` | `?` | — [Advanced Charts](https://fyers.in/advanced-charts) |
| **Angel One** | **`Y (claim)`** — "Direct Trading from Charts", **Drag & Drop Orders**, **Order Tracking on Charts**, **Live P&L Tracking**, **Basket Orders** — all on the tradingview.com route | `Y (claim)` drag | `Y (claim)` | — [Angel One on TradingView](https://www.angelone.in/tradingview) |
| ICICI Direct | `?` — **Flash Trade** and **Cloud Order** are named features but their relationship to the chart is undocumented | `?` | `?` | — [Stocks](https://www.icicidirect.com/stocks) |
| Trendlyne | `N` | `N` | `N` | — |
| Sensibull | `P` — order placement happens through the connected broker and only on explicit user action; Sensibull states it never places, modifies or cancels orders automatically | — | `N` | The explicit "no autonomous order action" guarantee is a notable trust-design precedent for an analytics layer that holds broker credentials. — [Sensibull](https://sensibull.com/) |
| Library capability (reference) | Chart trading, buy/sell buttons, bid/ask lines, order/position/P&L overlay and the price-scale **Plus button** quick-trade menu are **Trading Platform only** and require the integrator to implement the **Broker API**. The Plus button's menu is empty until that is done. | — | — | So every broker above with chart trading has either licensed Trading Platform or built it themselves. — [Trading Platform](https://www.tradingview.com/charting-library-docs/latest/trading_terminal/); [Price Scale](https://www.tradingview.com/charting-library-docs/latest/ui_elements/Price-Scale) |

**Content was rephrased for compliance with licensing restrictions.**

---

## 20. Mobile and touch behaviour

| Platform | Mobile chart posture | Documented touch behaviour | Notable detail |
| --- | --- | --- | --- |
| **Kite** | Feature-reduced relative to web | **Crosshair is a long-press gesture.** Long-press the TradingView chart to enable the crosshair, then tap a candle for its OHLC. **Tap anywhere to disable it**, after which left–right scrolling browses historical candles. | The long-press-to-arm / tap-to-dismiss pattern is the cleanest documented solution in the cluster to the touch conflict between "inspect a bar" and "pan the chart". Also: **corporate-action marks cannot be hidden on the app**, and **symbol comparison is web-only**. — [How to enable and disable crosshair on TradingView on the Kite app](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/crosshair-tradingview-version-2) |
| **Groww** | **Mobile-first, explicitly** — "native, mobile-first experience"; charts shipped on **Android only, iOS stated as launching soon** | Indicators and drawings added "with one tap" | Groww is the only platform in the cluster whose charting is *primarily* a mobile product, and the only one where the desktop surface is the secondary one. — [Groww Charts](https://groww.in/groww-charts) |
| **Upstox** | Chart 360 built for **both mobile and desktop**, with charts and trades kept in sync across devices | Tap the Y-axis to select a strike; scroll to set limit/target/stop-loss levels | Strike selection by tapping the price axis is a touch-native interaction, not a port of a desktop one. — [Chart 360](https://upstox.com/trade-on-charts/) |
| **Dhan** | Instant orders from the chart on the **TradingView desktop and mobile app** | `?` | — [Dhan + TradingView](https://dhan.co/tradingview/) |
| **FYERS** | App charts documented separately from web (advanced scale options is an app-specific KB topic) | KB topic exists for **keeping the screen always on while tracking charts in the app** | Screen-always-on is a small but genuinely mobile-trader-specific affordance nobody else documents. — [llms.txt index](https://fyers.in/llms.txt) |
| **Angel One** | App uses TradingView charts ("Superfast TradingView Charts") | `?` | — [Platforms and Tools](https://www.angelone.in/platform-and-tools) |
| ICICI Direct | Markets app on iOS and Android | `?` | — |
| Trendlyne | "Open in App" on every page | `?` | — |
| Sensibull | `?` | `?` | — |
| Library constraint (reference) | TradingView states that although the chart supports up to **eight price scales**, **only one price scale can be displayed in mobile applications**. | — | — | This is a hard constraint on any mobile multi-axis design. — [Price Scale](https://www.tradingview.com/charting-library-docs/latest/ui_elements/Price-Scale) |

**Content was rephrased for compliance with licensing restrictions.**

---

## 21. Performance ceiling

**No platform in Cluster B publishes a bar-count ceiling.** Only two publish any performance figures at all, and they are latency figures rather than capacity figures.

| Platform | Published figure | What it does not tell us |
| --- | --- | --- |
| Groww | **0.6 s chart load time**, **0.2 s tick latency**, 10.8 M active users, 58.5 M orders placed on charts | Nothing about how many bars can be rendered before degradation | — [Groww Charts](https://groww.in/groww-charts) |
| FYERS | **25+ years of historical data** available on the charting surface; **5-second** bar granularity | 25 years of 5-second bars is not implied; the two claims are for different resolutions | — [Advanced Charts](https://fyers.in/advanced-charts) |
| Upstox | "Years of historical minutes data"; seconds resolutions down to 1 s | No bar-count figure | — [Upstox × TradingView](https://upstox.com/tradingview-chart/) |
| Zerodha | `N` — no figure published. Zerodha instead publishes **failure-mode** articles: chart not ticking until refresh, blank page after opening a chart on the app, error while fetching data, historical candle values changing after a refresh. | These are the observable symptoms of the ceiling, documented without the ceiling | — [Why does the chart not tick until the page is refreshed?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/why-does-the-chart-not-tick-until-i-refresh-the-page-on-kite-web) |
| TradingView library (reference) | Vendor asserts responsiveness with "thousands of bars" and multiple tick updates per second; no numeric ceiling | A vendor claim, not a measured limit | — [Advanced Charts](https://www.tradingview.com/advanced-charts/) |

**Content was rephrased for compliance with licensing restrictions.**

---

## 22. Who is reachable from tradingview.com, and who is not

Verified against TradingView's own brokers directory in this session. This matters because it determines whether a user can bypass the broker's chart entirely.

| Indian broker | Listed as an integrated broker on tradingview.com | Consequence |
| --- | --- | --- |
| Angel One | **Yes** | Users can trade Angel One from tradingview.com's full Supercharts surface |
| Dhan | **Yes** | Also runs its own embedded surface at `tv.dhan.co` |
| FYERS | **Yes** | Plus its own in-house Advanced Charts |
| Upstox | **Yes** | Plus Chart 360 |
| Zerodha | **Not found in the directory**, and Zerodha separately states Kite cannot be connected to third-party charting applications | Kite users are confined to Kite's two embedded engines |
| Groww | **Not found** | In-house charts only |
| ICICI Direct | **Not found** | `?` |

Source: [TradingView brokers directory](https://www.tradingview.com/brokers/); [Zerodha: third-party charting libraries](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/third-party-charting-libraries)

**Content was rephrased for compliance with licensing restrictions.**

---

## 23. Admitted gaps in this research

Stated explicitly so no later reader mistakes an absence for a verified negative.

| Gap | Why | Effect on the tables |
| --- | --- | --- |
| **FYERS KB article bodies** | `support.fyers.in` is a client-side-rendered Zoho Desk portal; every article URL returns the same 26 KB shell with no content. | FYERS rows confirm the **existence** of a documented topic (order-flow chart, hotkeys, advanced scales, multi-chart layouts, FIA chart actions) from the vendor's own `llms-full.txt` index, but not the behaviour described inside. |
| **ICICI Direct** | No charting documentation published anywhere on `icicidirect.com`; platform pages are a single client-side bundle. | ICICI Direct is `?` on ~40 of 55 axes. This is a documentation gap at the vendor, not a research shortcut. |
| **Groww help centre** | Groww's support sitemap contains **956 articles and not one** matching chart, indicator, alert, candle or technical. | Groww rows rest solely on the `groww-charts` product page. |
| **Sensibull / Trendlyne chart internals** | Both are login-gated single-page applications. | Their chart-surface axes are `?` or `N`; their *tool inventories* and *alert models* are confirmed from public pages. |
| **Dhan support portal** | `help.dhan.co` and `support.dhan.co` resolve to nothing; `dhan.co/support/` renders categories client-side. | Dhan rows rest on product pages (`/tradingview/`, `/dext-t3-trading-terminal/`). |
| **Search engines** | DuckDuckGo HTML, DuckDuckGo Lite, Bing and Mojeek all returned anomaly/consent pages rather than results from this environment. | All discovery was done by crawling vendor sitemaps, `robots.txt` and `llms.txt` directly. This biases coverage toward vendors that publish a crawlable support corpus — which is precisely why Zerodha and FYERS are the best-covered and Groww and ICICI Direct the worst. |
| **Which TradingView edition each broker licensed** | No broker states it. | Where a feature is Trading Platform-only and the broker claims it, the claim is recorded as the broker's; the edition is never inferred. |

**Content was rephrased for compliance with licensing restrictions.**

---

## 24. The eight Cluster-B findings that should drive StockMind decisions

Ranked by how much they should change what StockMind builds. Every one traces to a cited row above.

| # | Finding | Why it matters for StockMind |
| --- | --- | --- |
| 1 | **Visible range is deliberately not part of a saved layout** in the reference implementation; the library re-opens on the newest data and exposes `setVisibleRange` as an explicit post-load call. (§2.1) | This is the documented root cause of the class of defect the owner reported as "default zoom not working". The fix is an explicit initial-range policy applied after data load, not a persistence change. |
| 2 | **Kite's persistence model is inconsistent across surfaces** — app saves to cloud per-instrument, web saves to browser cache with eviction at roughly ten layouts, and four named user actions silently destroy drawings. (§16) | Choose one durability contract for StockMind and state it in the UI. Zerodha's split model generates a documented support load; it is a pattern to avoid, not copy. |
| 3 | **FYERS has already shipped an AI assistant that mutates the chart** (marks support/resistance, adds RSI/MACD) and has had to publish whether it alters the user's saved layout. (§15) | This is the closest existing precedent to Rāma driving StockMind. The contract — does the assistant write into the user's saved layout, a scratch overlay, or a proposal the user accepts — must be decided before the feature, not after. |
| 4 | **Alerting in India is quote-threshold, not condition-based**, except at FYERS, Dhan and Upstox. Zerodha explicitly cannot do indicator alerts and explicitly dropped its own advanced-alerts feature. (§11) | Condition-based alerts (indicator cross, trendline cross) are a real, identifiable gap in the market leader's product, and therefore a high-value differentiator rather than a me-too feature. |
| 5 | **Alert-as-trigger is the live frontier**: Zerodha ATO fires a basket of up to 20 instruments; FYERS Automate places orders from alerts. (§11.1) | If StockMind grows alerting, the design target is a trigger→action pipeline, not a notification list. This also sets the safety bar: market-price protection, explicit confirmation, no silent execution. |
| 6 | **Chart trading is table stakes in Indian retail, and the quality is in the detail** — Kite's three P&L display modes and its instant-vs-confirm default; Upstox using the Y-axis as a strike selector; Dhan's basket execution from the chart. (§19) | A StockMind chart without order context will read as incomplete to this user. The P&L display modes and the confirm-by-default posture are cheap to copy and high-signal. |
| 7 | **Corporate actions are a correctness problem, not a marker problem.** Zerodha documents marks from the ex-date only, history limited to 2014, marks unavailable in multi-chart, a hide-preference that does not persist, and historical candle values changing after a refresh. (§14) | Any Indian equity chart must define: when adjustment is applied, whether displayed history is adjusted or raw, and what the user sees when the adjustment lands mid-session. Zerodha's article set is effectively a checklist of the failure modes. |
| 8 | **Nobody in this cluster does market profile/TPO, almost nobody does volume profile, and only FYERS documents order flow.** Meanwhile Upstox has invented an India-specific substitute — **OI Profile and OI Build-up on the chart**. (§13) | For NSE/BSE F&O, open-interest structure is the locally meaningful analogue of US-style order-flow analytics. If StockMind wants microstructure depth, OI-on-chart is the higher-value and more defensible direction than importing TPO. |

**Content was rephrased for compliance with licensing restrictions.**

---

## 25. Source index

Each URL below was fetched in this session on **2026-10-01**. None of the Indian vendor pages display a publication or revision date; TradingView's documentation and ChartIQ's SDK index display a copyright year only.

### Zerodha (Kite)
- [Charts category index](https://support.zerodha.com/category/trading-and-markets/kite-web-and-mobile/charts)
- [How to switch between charts on Kite?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/how-do-i-switch-to-tradingview-charts)
- [Can third-party charting applications be connected with Kite?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/third-party-charting-libraries)
- [Why are some TradingView indicators unavailable on Kite?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/features-available-on-trading-view-not-available-in-the-trading-view-library-at-zerodha)
- [How to use the backtest feature on Kite Charts?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/backtest-on-kite-charts)
- [How to view the corporate actions on Kite charts?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/corporate-actions-on-kite-charts)
- [How to compare the relative performance of stocks and indices on Kite?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/compare-relative-performance-between-stocks-and-indices)
- [How to Trade From Charts (TFC) on TradingView charts at Zerodha?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/trade-from-charts-on-tradingview)
- [How to Trade From Charts (TFC) on ChartIQ at Zerodha?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/what-is-the-trade-from-chart-feature-how-can-i-use-it)
- [How to view multiple charts on TradingView on Kite web?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/view-multiple-charts-in-tradingview)
- [Why are the drawings getting deleted from the TradingView chart on Kite?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/drawings-getting-deleted-from-the-tradingview-chart)
- [How to save TradingView chart drawings on Kite app?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/how-do-i-save-tradingview-chart-drawings-on-kite-3-mobile)
- [How to change the scales and axis on charts?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/scales-and-axis-charts)
- [How to save the time frame, chart style and indicator settings as a view on ChartIQ?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/how-to-save-my-chart-settings-and-indicators-on-kite-charts)
- [How to get continuous chart data for futures contracts on Kite?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/continuous-data-kite)
- [How to go to a specific date and time on TradingView charts?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/go-to-specific-date-on-chart)
- [How to enable and disable crosshair on TradingView on the Kite app?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/crosshair-tradingview-version-2)
- [Why do completed bricks in Renko charts retrace during price reversal?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/renko-bar-retracement)
- [How to enable full screen mode for ChartIQ indicators?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/maximise-pane)
- [How to open a chart in a new tab on Kite web?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/open-the-chart-in-a-new-tab)
- [Why has the value of historical candles changed after a refresh?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/value-of-historical-candles-on-refresh)
- [Why does the chart not tick until the page is refreshed?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/why-does-the-chart-not-tick-until-i-refresh-the-page-on-kite-web)
- [Why are the OHLC values on daily and hourly charts different?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/why-are-the-ohlc-values-on-daily-and-hourly-charts-different)
- [How are pivot points derived while using the CPR?](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/how-are-pivot-points-derived-while-using-the-cpr)
- [Pivot points on Kite charts](https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/pivot-points-on-kite-charts)
- [What are Kite alerts and how to use them?](https://support.zerodha.com/category/trading-and-markets/alerts-and-nudges/kite-alerts/articles/what-are-kite-alerts-and-how-do-i-use-them)
- [Can I set alerts based on technical indicators on Kite?](https://support.zerodha.com/category/trading-and-markets/alerts-and-nudges/kite-alerts/articles/set-a-technical-indicator-based-alert-using-sentinel)
- [What is Alert Triggers Orders (ATO)?](https://support.zerodha.com/category/trading-and-markets/alerts-and-nudges/kite-alerts/articles/what-is-alert-triggers-order-ato)
- [Why can't I find the advanced alerts feature on Kite?](https://support.zerodha.com/category/trading-and-markets/general-kite/others-kite/articles/not-able-to-view-the-advanced-alerts-option)
- [Chart preference limit reached](https://support.zerodha.com/category/trading-and-markets/alerts-and-nudges/kite-error-messages/articles/chart-preference-limit-reaches)
- [What is the 20 market depth feature?](https://support.zerodha.com/category/trading-and-markets/general-kite/kite-mw/articles/view-20-depth)
- [What are pre-market and post-market sessions and orders?](https://support.zerodha.com/category/trading-and-markets/trading-faqs/market-sessions/articles/what-are-pre-market-and-post-market-sessions-and-orders)
- [Support sitemap (1,443 URLs, used for absence evidence)](https://support.zerodha.com/sitemap.xml)

### Upstox
- [Upstox × TradingView](https://upstox.com/tradingview-chart/)
- [Chart 360](https://upstox.com/trade-on-charts/)
- [Help centre](https://help.upstox.com/)

### Groww
- [Groww Charts](https://groww.in/groww-charts)
- [Support sitemap (956 URLs, used for absence evidence)](https://groww.in/support-sitemap.xml)
- [Product sitemap](https://groww.in/product-sitemap.xml)

### Dhan
- [Dhan + TradingView](https://dhan.co/tradingview/)
- [DEXT T3 Trading Terminal](https://dhan.co/dext-t3-trading-terminal/)
- [Dhan Support](https://dhan.co/support/)

### FYERS
- [Advanced Charts](https://fyers.in/advanced-charts)
- [Real-time alerts](https://fyers.in/alerts)
- [FYERS × TradingView charts](https://fyers.in/trading-view)
- [Automate — rule-based trading](https://fyers.in/automate)
- [llms.txt — machine-readable site index](https://fyers.in/llms.txt)
- [llms-full.txt — full KB index, used to confirm which chart topics exist](https://fyers.in/llms-full.txt)
- [Using ratio charts to identify relative strength](https://fyers.in/school-of-stocks/chapter/intermarket-analysis-and-sector-rotation/using-ratio-charts-to-identify-relative-strength.html)

### Angel One
- [Platforms and Tools](https://www.angelone.in/platform-and-tools)
- [Trade with Angel One on the TradingView platform](https://www.angelone.in/tradingview)

### ICICI Direct
- [Stocks](https://www.icicidirect.com/stocks)
- [Spring — automated trading, backtest and paper trade](https://www.icicidirect.com/futures-and-options/spring)
- [GTT order](https://www.icicidirect.com/equity-products/gtt-order)

### Trendlyne
- [Stock alerts](https://trendlyne.com/alerts/)
- [Live equity page, used for tab/navigation structure](https://trendlyne.com/equity/1023/INFY/infosys-ltd/)
- [robots.txt, used to confirm chart and back-test endpoints exist](https://trendlyne.com/robots.txt)

### Sensibull
- [Sensibull home — tool inventory and order-handling guarantees](https://sensibull.com/)

### Chart engines (capability ceilings)
- [TradingView Advanced Charts product page](https://www.tradingview.com/advanced-charts/)
- [Trading Platform overview — the Advanced Charts vs Trading Platform split](https://www.tradingview.com/charting-library-docs/latest/trading_terminal/)
- [Drawings List](https://www.tradingview.com/charting-library-docs/latest/ui_elements/drawings/Drawings-List)
- [Saving and loading charts](https://www.tradingview.com/charting-library-docs/latest/saving_loading/)
- [Chart — inactivity gaps, setVisibleRange, action IDs](https://www.tradingview.com/charting-library-docs/latest/ui_elements/Chart)
- [Price Scale](https://www.tradingview.com/charting-library-docs/latest/ui_elements/Price-Scale)
- [Marks](https://www.tradingview.com/charting-library-docs/latest/ui_elements/Marks)
- [Snapshots](https://www.tradingview.com/charting-library-docs/latest/ui_elements/Snapshots)
- [Extended Sessions](https://www.tradingview.com/charting-library-docs/latest/connecting_data/time-and-sessions/Extended-Sessions)
- [Shortcuts](https://www.tradingview.com/charting-library-docs/latest/configuration/Shortcuts)
- [Product comparison](https://www.tradingview.com/charting-library-docs/latest/product-comparison)
- [TradingView brokers directory](https://www.tradingview.com/brokers/)
- [ChartIQ SDK documentation index](https://documentation.chartiq.com/)

**Content was rephrased for compliance with licensing restrictions.**




