import { createRoot } from 'react-dom/client';
import { App } from './App';

const CONTAINER_ID = 'poke-copilot-root';

export function mountOverlay(): void {
  if (document.getElementById(CONTAINER_ID)) return;
  const container = document.createElement('div');
  container.id = CONTAINER_ID;
  applyFloatingStyle(container);
  document.body.appendChild(container);
  createRoot(container).render(<App />);
  // Showdown re-renders rooms as battles open/close; keep trying to sit right
  // below the player's move/switch controls, falling back to a floating panel.
  setInterval(() => anchorBelowControls(container), 1000);
}

/** Fallback: floating panel on the far left, clear of the chat column. */
function applyFloatingStyle(el: HTMLElement): void {
  Object.assign(el.style, {
    position: 'fixed',
    left: '12px',
    bottom: '12px',
    zIndex: '2147483647',
    width: '320px',
    margin: '0',
  });
}

function anchorBelowControls(container: HTMLElement): void {
  const controls = document.querySelector<HTMLElement>('.battle-controls');
  // Only visible while a battle room is open; App additionally clears itself on |win|/|tie|.
  container.style.display = controls && controls.offsetParent ? '' : 'none';
  if (controls && controls.offsetParent) {
    if (container.previousElementSibling !== controls) {
      controls.insertAdjacentElement('afterend', container);
      Object.assign(container.style, {
        position: 'static',
        width: 'auto',
        maxWidth: '360px',
        margin: '8px 0 8px 10px',
        zIndex: 'auto',
      });
    }
  } else if (container.parentElement !== document.body) {
    // Battle room closed: detach from the dead DOM and float again.
    document.body.appendChild(container);
    applyFloatingStyle(container);
  }
}
