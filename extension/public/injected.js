/**
 * Page-context script. Runs in the same JS world as Showdown's client, so it can
 * see globals like `app` (Backbone client) / `PS` (Preact rewrite) and each
 * battle room's `battle` object.
 *
 * Responsibilities:
 *  1. Hook the raw protocol stream for battle rooms and forward every chunk to
 *     the content script via window.postMessage.
 *  2. Expose the player's own team (request payload) which never appears in the
 *     public log.
 *
 * It must NEVER send choices/moves on behalf of the player.
 */
(() => {
  const SOURCE = 'poke-copilot';
  const post = (type, payload) =>
    window.postMessage({ source: SOURCE, type, payload }, '*');

  /** Hook the classic (Backbone) client: app.rooms[roomid].add(logLine). */
  function hookClassicClient() {
    if (typeof window.app === 'undefined' || !window.app.rooms) return false;

    const tryPatchRoom = (room) => {
      if (!room || room.__pokeCopilotPatched) return;
      // Battle rooms receive protocol chunks through receive()/add().
      const original = room.receive?.bind(room) ?? room.add?.bind(room);
      if (!original) return;
      const patched = (data, ...rest) => {
        if (typeof data === 'string' && data.startsWith('|')) {
          post('protocol-chunk', { roomid: room.id, chunk: data });
        }
        return original(data, ...rest);
      };
      if (room.receive) room.receive = patched;
      else room.add = patched;
      room.__pokeCopilotPatched = true;
      post('room-hooked', { roomid: room.id });
    };

    // Patch existing and future battle rooms.
    Object.values(window.app.rooms).forEach(tryPatchRoom);
    const originalJoinRoom = window.app.joinRoom?.bind(window.app);
    if (originalJoinRoom) {
      window.app.joinRoom = (...args) => {
        const room = originalJoinRoom(...args);
        if (room?.id?.startsWith('battle-')) tryPatchRoom(room);
        return room;
      };
    }
    return true;
  }

  /** The |request| message carries our full team + legal choices as JSON. */
  function forwardRequests() {
    window.addEventListener('message', (ev) => {
      if (ev.data?.source !== SOURCE || ev.data.type !== 'protocol-chunk') return;
      const { roomid, chunk } = ev.data.payload;
      for (const line of chunk.split('\n')) {
        if (line.startsWith('|request|')) {
          post('battle-request', { roomid, request: line.slice('|request|'.length) });
        }
      }
    });
  }

  const poll = setInterval(() => {
    if (hookClassicClient()) {
      clearInterval(poll);
      forwardRequests();
      post('ready', {});
    }
  }, 500);
})();
