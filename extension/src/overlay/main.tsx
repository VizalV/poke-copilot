import { createRoot } from 'react-dom/client';
import { App } from './App';
import { OVERLAY_CSS } from './styles';

const HOST_ID = 'poke-copilot-root';

/**
 * Mounts the overlay inside a shadow root so Showdown's global CSS cannot leak
 * into it (and ours cannot leak out). The host floats on the right edge, below
 * the room tabs; visibility follows whether a battle room is open.
 */
export function mountOverlay(): void {
  if (document.getElementById(HOST_ID)) return;
  const host = document.createElement('div');
  host.id = HOST_ID;
  Object.assign(host.style, {
    position: 'fixed',
    top: '64px',
    right: '10px',
    width: '308px',
    zIndex: '2147483647',
    display: 'none',
  });
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  shadow.appendChild(style);
  const mount = document.createElement('div');
  shadow.appendChild(mount);
  createRoot(mount).render(<App />);

  // Only visible while a battle room is open; App additionally clears on |win|/|tie|.
  setInterval(() => {
    const controls = document.querySelector<HTMLElement>('.battle-controls');
    host.style.display = controls && controls.offsetParent ? '' : 'none';
  }, 1000);
}
