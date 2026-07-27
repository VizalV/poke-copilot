# Backend

FastAPI websocket server that turns live Showdown protocol streams into
`AdviceFrame`s for the extension.

## Run

```sh
uv sync
uv run uvicorn app.main:app --reload --port 8787
```

## Inference

Point at any OpenAI-compatible endpoint:

| Env var | Default |
| --- | --- |
| `POKE_COPILOT_BASE_URL` | `http://localhost:11434/v1` (Ollama) |
| `POKE_COPILOT_MODEL` | `llama3.1:8b` |

For GPU serving with batching (needed for the N+1 counterfactual scores per turn),
use vLLM: `vllm serve meta-llama/Llama-3.1-8B-Instruct` and set
`POKE_COPILOT_BASE_URL=http://localhost:8000/v1`.

## Bayesian predictor sidecar

Opponent-model predictions come from PokéChamp's Bayesian predictor, run as a
separate service in the pokechamp repo's environment (it needs the vendored
`poke_env` fork):

```sh
cd ../../pokechamp
METAMON_CACHE_DIR=/common/users/vv382/metamon_cache \
  uv run --with fastapi --with "uvicorn[standard]" \
  python ../poke-copilot/backend/predictor_service.py
```

First run downloads the gen9ou team set from HuggingFace and trains (~1 min);
afterwards it loads the cached pickle in seconds. Serves on :8790
(`POKE_COPILOT_PREDICTOR_URL` to override). If it's down, advice frames simply
omit opponent intel.

## Module map

- `app/main.py` — websocket endpoint, per-room `BattleTracker` sessions
- `app/battle_state.py` — protocol chunk → structured battle state
- `app/wincon.py` — win-con tagging: counterfactual value comparison per benched mon
- `app/inference.py` — LLM value function (PokéChamp's leaf-node value prompt)
- `app/opponent_model.py` — client for the predictor sidecar
- `predictor_service.py` — the sidecar itself (runs in pokechamp's env, not this venv)
