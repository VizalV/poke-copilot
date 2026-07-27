/**
 * Background service worker. Owns the websocket to the inference backend and
 * multiplexes per-battle-room streams.
 */
import type { AdviceFrame, PageMessage } from './lib/types';

const BACKEND_WS = 'ws://localhost:8787/ws/battle';

let socket: WebSocket | null = null;
const pending: object[] = [];

function ensureSocket(): WebSocket {
  if (socket && socket.readyState <= WebSocket.OPEN) return socket;
  socket = new WebSocket(BACKEND_WS);
  socket.onopen = () => {
    while (pending.length) socket!.send(JSON.stringify(pending.shift()));
  };
  socket.onmessage = async (ev) => {
    const frame: AdviceFrame = JSON.parse(ev.data);
    const tabs = await chrome.tabs.query({ url: '*://play.pokemonshowdown.com/*' });
    for (const tab of tabs) {
      if (tab.id != null) {
        chrome.tabs.sendMessage(tab.id, { kind: 'advice-frame', frame }).catch(() => {});
      }
    }
  };
  socket.onclose = () => {
    socket = null;
    setTimeout(ensureSocket, 2000);
  };
  return socket;
}

chrome.runtime.onMessage.addListener((msg: { kind: string; event: PageMessage }) => {
  if (msg?.kind !== 'page-event') return;
  const ws = ensureSocket();
  const out = { type: msg.event.type, ...msg.event.payload };
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(out));
  else pending.push(out);
});
