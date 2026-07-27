/**
 * Background service worker. Owns the websocket to the inference backend.
 *
 * MV3 service workers are killed when idle, which drops the socket. Two
 * mitigations: an alarm keeps waking us to reconnect, and on every (re)open we
 * ask the content script to replay the battle log so the backend can rebuild
 * its per-connection state (it would otherwise never see the |request| that
 * tells it which side we are).
 */
import type { AdviceFrame } from './lib/types';

const BACKEND_WS = 'ws://localhost:8787/ws/battle';
const TAB_PATTERNS = ['*://play.pokemonshowdown.com/*', '*://localhost/*'];

let socket: WebSocket | null = null;
const pending: object[] = [];

const log = (...args: unknown[]) => console.log('[poke-copilot]', ...args);

async function broadcast(msg: object): Promise<void> {
  const tabs = await chrome.tabs.query({ url: TAB_PATTERNS });
  for (const tab of tabs) {
    if (tab.id != null) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
  }
}

function connect(): WebSocket {
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
    return socket;
  }
  log('connecting to', BACKEND_WS);
  socket = new WebSocket(BACKEND_WS);

  socket.onopen = () => {
    log('connected');
    broadcast({ kind: 'backend-status', connected: true });
    // Rebuild backend state for any battle already in progress.
    broadcast({ kind: 'request-replay' });
    while (pending.length && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(pending.shift()));
    }
  };

  socket.onmessage = (ev) => {
    const frame: AdviceFrame = JSON.parse(ev.data);
    broadcast({ kind: 'advice-frame', frame });
  };

  socket.onerror = () => log('websocket error — is the backend up and the SSH tunnel open?');

  socket.onclose = (ev) => {
    log('disconnected', ev.code, ev.reason);
    socket = null;
    broadcast({ kind: 'backend-status', connected: false });
    setTimeout(connect, 2000);
  };

  return socket;
}

function send(payload: object): void {
  const ws = connect();
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  else pending.push(payload);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.kind === 'page-event') {
    send({ type: msg.event.type, ...msg.event.payload });
  } else if (msg?.kind === 'replay-done') {
    send({ type: 'analyze', roomid: msg.roomid });
  }
});

// Keep the worker warm; also recovers the socket after a forced shutdown.
chrome.alarms.create('poke-copilot-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => connect());
chrome.runtime.onStartup.addListener(() => connect());

connect(); // eager connect on worker start
