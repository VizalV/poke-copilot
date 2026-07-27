/**
 * Content script (isolated world). Bridges the page-context injected script and
 * the extension's background service worker, runs the client-side damage/speed
 * calcs, and mounts the overlay UI.
 */
import { analyzeLocally } from './lib/calc';
import { getSnapshot, ingestChunk, ingestRequest } from './lib/protocol';
import { mountOverlay } from './overlay/main';
import type { PageMessage } from './lib/types';

const SOURCE = 'poke-copilot';

// Inject the page-context hook.
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

const localTimers = new Map<string, number>();

/** Recompute damage/speed locally, debounced per room (chunks arrive in bursts). */
function scheduleLocalAnalysis(roomid: string): void {
  clearTimeout(localTimers.get(roomid));
  localTimers.set(
    roomid,
    window.setTimeout(() => {
      const snap = getSnapshot(roomid);
      if (snap.ended) {
        window.dispatchEvent(new CustomEvent('poke-copilot:battle-end', { detail: { roomid } }));
        return;
      }
      const analysis = analyzeLocally(snap);
      window.dispatchEvent(new CustomEvent('poke-copilot:local', { detail: analysis }));
    }, 150),
  );
}

// Relay page → background, and feed the local analyzer.
window.addEventListener('message', (ev: MessageEvent<PageMessage>) => {
  if (ev.source !== window || ev.data?.source !== SOURCE) return;
  const { type, payload } = ev.data;
  const roomid = String(payload.roomid ?? '');
  if (roomid && type === 'protocol-chunk') {
    ingestChunk(roomid, String(payload.chunk ?? ''));
    scheduleLocalAnalysis(roomid);
  } else if (roomid && type === 'battle-request') {
    ingestRequest(roomid, String(payload.request ?? ''));
    scheduleLocalAnalysis(roomid);
  }
  chrome.runtime.sendMessage({ kind: 'page-event', event: ev.data }).catch(() => {
    /* service worker may be waking up; background replays state on reconnect */
  });
});

// Relay background → overlay (advice frames from the inference backend).
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.kind === 'advice-frame') {
    window.dispatchEvent(new CustomEvent('poke-copilot:advice', { detail: msg.frame }));
  }
});

mountOverlay();
