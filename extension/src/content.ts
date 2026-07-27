/**
 * Content script (isolated world). Bridges the page-context injected script and
 * the extension's background service worker, runs the client-side damage/speed
 * calcs, and mounts the overlay UI.
 *
 * It also keeps a per-room log of everything seen so far: the background worker
 * can be killed and restarted at any time, and the backend rebuilds its battle
 * state from this replay rather than being stuck without a |request|.
 */
import { analyzeLocally } from './lib/calc';
import { getSnapshot, ingestChunk, ingestRequest } from './lib/protocol';
import { mountOverlay } from './overlay/main';
import type { AdviceFrame, OpponentSet, PageMessage } from './lib/types';

const SOURCE = 'poke-copilot';

/** Latest Bayesian set predictions per room; feeds the damage calc. */
const predictedSets = new Map<string, OpponentSet[]>();

// Inject the page-context hook.
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

/** Everything we've relayed, per room, for replay after a worker restart. */
const eventLog = new Map<string, PageMessage[]>();
const localTimers = new Map<string, number>();

/** Recompute damage/speed locally, debounced per room (chunks arrive in bursts). */
function scheduleLocalAnalysis(roomid: string): void {
  clearTimeout(localTimers.get(roomid));
  localTimers.set(
    roomid,
    window.setTimeout(() => {
      const snap = getSnapshot(roomid);
      if (snap.ended) {
        eventLog.delete(roomid);
        window.dispatchEvent(new CustomEvent('poke-copilot:battle-end', { detail: { roomid } }));
        return;
      }
      const sets = predictedSets.get(roomid) ?? [];
      window.dispatchEvent(new CustomEvent('poke-copilot:local', { detail: analyzeLocally(snap, sets) }));
    }, 150),
  );
}

// Relay page → background, feed the local analyzer, and remember for replay.
window.addEventListener('message', (ev: MessageEvent<PageMessage>) => {
  if (ev.source !== window || ev.data?.source !== SOURCE) return;
  const { type, payload } = ev.data;
  const roomid = String(payload?.roomid ?? '');
  if (!roomid) return;

  if (type === 'protocol-chunk') {
    ingestChunk(roomid, String(payload.chunk ?? ''));
  } else if (type === 'battle-request') {
    ingestRequest(roomid, String(payload.request ?? ''));
  } else {
    return;
  }
  scheduleLocalAnalysis(roomid);

  const log = eventLog.get(roomid) ?? [];
  log.push(ev.data);
  eventLog.set(roomid, log);

  chrome.runtime.sendMessage({ kind: 'page-event', event: ev.data }).catch(() => {
    /* worker asleep; it replays from eventLog once it reconnects */
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.kind === 'advice-frame') {
    const frame = msg.frame as AdviceFrame;
    window.dispatchEvent(new CustomEvent('poke-copilot:advice', { detail: frame }));
    // Fresh set predictions -> redo the damage calc with the sharper EVs.
    predictedSets.set(frame.roomid, frame.opponent.sets);
    scheduleLocalAnalysis(frame.roomid);
  } else if (msg?.kind === 'backend-status') {
    window.dispatchEvent(new CustomEvent('poke-copilot:status', { detail: msg }));
  } else if (msg?.kind === 'request-replay') {
    replayAll();
  }
});

/** Re-send every event for each live room so the backend can rebuild state. */
function replayAll(): void {
  for (const [roomid, events] of eventLog) {
    for (const event of events) {
      chrome.runtime
        .sendMessage({ kind: 'page-event', event: { ...event, payload: { ...event.payload, replay: true } } })
        .catch(() => {});
    }
    chrome.runtime.sendMessage({ kind: 'replay-done', roomid }).catch(() => {});
  }
}

mountOverlay();
