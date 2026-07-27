/** Stylesheet injected into the overlay's shadow root — fully isolated from Showdown's CSS. */
export const OVERLAY_CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }

.card {
  font: 12.5px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif;
  color: #e8e8ec;
  background: #17171c;
  border: 1px solid #2c2c36;
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: linear-gradient(135deg, #1e1e2a 0%, #17171c 100%);
  border-bottom: 1px solid #2c2c36;
  cursor: pointer;
  user-select: none;
}
.logo { width: 8px; height: 8px; border-radius: 50%; background: #6c8cff; box-shadow: 0 0 8px #6c8cff; }
.title { font-weight: 700; font-size: 13px; }
.turn { color: #9a9aa5; font-size: 11px; flex: 1; }
.latency { color: #55555f; font-size: 10px; }
.chev { color: #9a9aa5; font-size: 10px; padding-left: 2px; }

.win-pill { font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 999px; }
.win-good { background: rgba(52, 201, 142, 0.15); color: #34c98e; }
.win-even { background: rgba(240, 180, 41, 0.15); color: #f0b429; }
.win-bad  { background: rgba(239, 93, 103, 0.15); color: #ef5d67; }

.body { max-height: calc(100vh - 170px); overflow-y: auto; padding: 2px 12px 12px; }
.body::-webkit-scrollbar { width: 6px; }
.body::-webkit-scrollbar-thumb { background: #2c2c36; border-radius: 3px; }

.section { margin-top: 10px; }
.section-title {
  display: flex; align-items: center; gap: 6px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: #8a8a96; margin-bottom: 5px;
}
.section-title::after { content: ""; flex: 1; height: 1px; background: #26262f; }
.subhead { font-size: 10.5px; color: #8a8a96; margin: 6px 0 2px; }

.row { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
.name { min-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.muted { color: #9a9aa5; font-size: 11px; }
.mono { font-variant-numeric: tabular-nums; }
.pct { font-size: 11.5px; min-width: 68px; text-align: right; }

.chip {
  font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 5px;
  white-space: nowrap; letter-spacing: 0.02em;
}
.chip-red   { background: rgba(239, 93, 103, 0.16); color: #ef5d67; border: 1px solid rgba(239, 93, 103, 0.35); }
.chip-amber { background: rgba(240, 180, 41, 0.14); color: #f0b429; border: 1px solid rgba(240, 180, 41, 0.30); }
.chip-green { background: rgba(52, 201, 142, 0.14); color: #34c98e; border: 1px solid rgba(52, 201, 142, 0.32); }

.bar { flex: 1; height: 5px; border-radius: 3px; background: #26262f; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 3px; }
.fill-us   { background: linear-gradient(90deg, #6c8cff, #34c98e); }
.fill-them { background: linear-gradient(90deg, #f0b429, #ef5d67); }
.fill-prob { background: #6c8cff; }

.ko { font-size: 10px; color: #8a8a96; margin: -1px 0 3px 26px; }
.pathway { font-size: 12px; color: #c9c9d2; padding: 1px 0; }
.pathway em { color: #9a9aa5; }
`;
