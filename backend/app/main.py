"""FastAPI entrypoint: one websocket per browser session, multiplexing battles.

Frame protocol (JSON, both directions):
  in:  {"type": "protocol-chunk", "roomid": ..., "chunk": "|move|..."}
       {"type": "battle-request", "roomid": ..., "request": "{...}"}   # own team
  out: AdviceFrame (see extension/src/lib/types.ts for the mirror schema)
"""
import json
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.battle_state import BattleTracker
from app.wincon import analyze_win_conditions

app = FastAPI(title="poke-copilot-backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/")
async def root() -> dict:
    return {
        "service": "poke-copilot-backend",
        "status": "running",
        "endpoints": {"health": "/healthz", "battle_stream": "ws://<host>/ws/battle (websocket)"},
    }


@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True}


@app.websocket("/ws/battle")
async def battle_ws(ws: WebSocket) -> None:
    await ws.accept()
    trackers: dict[str, BattleTracker] = {}
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            roomid = msg.get("roomid", "")
            tracker = trackers.setdefault(roomid, BattleTracker(roomid))

            if msg["type"] == "protocol-chunk":
                turn_ended = tracker.ingest_chunk(msg["chunk"])
                if turn_ended:
                    start = time.monotonic()
                    frame = await analyze_win_conditions(tracker)
                    frame.latency_ms = int((time.monotonic() - start) * 1000)
                    await ws.send_text(frame.model_dump_json(by_alias=True))
            elif msg["type"] == "battle-request":
                tracker.ingest_request(msg["request"])
    except WebSocketDisconnect:
        pass
