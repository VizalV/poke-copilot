import { useEffect, useRef, useState } from 'react';
import type { AdviceFrame, LocalAnalysis, MoveAnnotation, WinConTag } from '../lib/types';

const TAG_CHIP: Record<WinConTag, { label: string; cls: string }> = {
  MUST_PRESERVE: { label: 'MUST PRESERVE', cls: 'chip chip-red' },
  FLEXIBLE: { label: 'FLEXIBLE', cls: 'chip chip-amber' },
  SAFE_TO_SACRIFICE: { label: 'SAFE TO SAC', cls: 'chip chip-green' },
};

/**
 * Sections: win-con tags + opponent intel come from the backend (AdviceFrame,
 * once per turn); damage and speed come from the client-side calc
 * (LocalAnalysis, on every state change). Hidden outside of battles.
 */
export function App() {
  const [frame, setFrame] = useState<AdviceFrame | null>(null);
  const [local, setLocal] = useState<LocalAnalysis | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [connected, setConnected] = useState(false);
  const justDragged = useRef(false);

  /** Drag the whole panel by its header; a real click (no movement) still toggles collapse. */
  const onHeaderPointerDown = (e: React.PointerEvent) => {
    const host = document.getElementById('poke-copilot-root');
    if (!host || e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = host.getBoundingClientRect();
    let dragging = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging && Math.abs(dx) + Math.abs(dy) < 5) return;
      dragging = true;
      const left = Math.min(Math.max(rect.left + dx, 0), window.innerWidth - rect.width);
      const top = Math.min(Math.max(rect.top + dy, 0), window.innerHeight - 48);
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
      host.style.right = 'auto';
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (dragging) {
        justDragged.current = true;
        try {
          localStorage.setItem('poke-copilot:pos', JSON.stringify({ left: host.style.left, top: host.style.top }));
        } catch {
          /* storage may be unavailable; position just won't persist */
        }
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onHeaderClick = () => {
    if (justDragged.current) {
      justDragged.current = false;
      return;
    }
    setCollapsed((c) => !c);
  };

  useEffect(() => {
    const onAdvice = (ev: Event) => setFrame((ev as CustomEvent<AdviceFrame>).detail);
    const onLocal = (ev: Event) => setLocal((ev as CustomEvent<LocalAnalysis>).detail);
    const onEnd = () => {
      setFrame(null);
      setLocal(null);
    };
    const onStatus = (ev: Event) => setConnected((ev as CustomEvent<{ connected: boolean }>).detail.connected);
    window.addEventListener('poke-copilot:advice', onAdvice);
    window.addEventListener('poke-copilot:local', onLocal);
    window.addEventListener('poke-copilot:battle-end', onEnd);
    window.addEventListener('poke-copilot:status', onStatus);
    return () => {
      window.removeEventListener('poke-copilot:advice', onAdvice);
      window.removeEventListener('poke-copilot:local', onLocal);
      window.removeEventListener('poke-copilot:battle-end', onEnd);
      window.removeEventListener('poke-copilot:status', onStatus);
    };
  }, []);

  if (!frame && !local) return null;

  const winProb = frame?.overallWinProb ?? null;
  const winCls = winProb == null ? '' : winProb >= 0.55 ? 'win-good' : winProb >= 0.45 ? 'win-even' : 'win-bad';
  const oppActiveSet = frame?.opponent.sets.find((s) => s.species === local?.oppActive);

  return (
    <div className="card">
      <div
        className="header"
        onPointerDown={onHeaderPointerDown}
        onClick={onHeaderClick}
        title="Drag to move · click to collapse/expand"
      >
        <span
          className={connected ? 'logo' : 'logo logo-off'}
          title={connected ? 'Backend connected' : 'Backend offline — check the SSH tunnel and uvicorn'}
        />
        <span className="title">Poké-Copilot</span>
        <span className="turn">{frame ? `turn ${frame.turn}` : ''}</span>
        {frame && <span className="latency">{frame.latencyMs}ms</span>}
        {winProb != null && <span className={`win-pill ${winCls}`}>{Math.round(winProb * 100)}% win</span>}
        <span className="chev">{collapsed ? '▸' : '▾'}</span>
      </div>

      {!collapsed && (
        <div className="body">
          {frame && frame.assessments.length > 0 && (
            <Section title="Bench value">
              {frame.assessments.map((a) => (
                <div className="row" key={a.species}>
                  <span className="name">{a.species}</span>
                  <span style={{ flex: 1 }} />
                  <span
                    className={TAG_CHIP[a.tag].cls}
                    title={`${a.reason} — win% if lost: ${Math.round(a.winProbIfLost * 100)} vs preserved: ${Math.round(a.winProbIfPreserved * 100)}`}
                  >
                    {TAG_CHIP[a.tag].label}
                  </span>
                </div>
              ))}
            </Section>
          )}

          {local && local.ourActive && local.oppActive && local.ourMoves.length > 0 && (
            <Section title={`${local.ourActive} vs ${local.oppActive}`}>
              {local.oppSetLabel && <div className="subhead">{local.oppSetLabel}</div>}
              {local.ourMoves.map((m) => (
                <DamageRow key={`our-${m.move}`} m={m} mine />
              ))}
              {local.theirMoves.length > 0 && (
                <>
                  <div className="subhead">their revealed moves vs you</div>
                  {local.theirMoves.map((m) => (
                    <DamageRow key={`their-${m.move}`} m={m} mine={false} />
                  ))}
                </>
              )}
            </Section>
          )}

          {frame && (frame.opponent.unrevealed.length > 0 || oppActiveSet) && (
            <Section title="Opponent intel">
              {oppActiveSet && (
                <>
                  <div className="subhead">{oppActiveSet.species} likely runs</div>
                  {oppActiveSet.moves.slice(0, 4).map((m) => (
                    <ProbRow key={m.name} name={m.name} p={m.probability} />
                  ))}
                  {oppActiveSet.item[0] && (
                    <ProbRow name={`item · ${oppActiveSet.item[0].name}`} p={oppActiveSet.item[0].probability} />
                  )}
                </>
              )}
              {frame.opponent.unrevealed.length > 0 && (
                <>
                  <div className="subhead">unrevealed teammates</div>
                  {frame.opponent.unrevealed.map((t) => (
                    <ProbRow key={t.name} name={t.name} p={t.probability} />
                  ))}
                </>
              )}
            </Section>
          )}

          {frame && frame.pathway.length > 0 && (
            <Section title="Best line">
              {frame.pathway.map((s) => (
                <div className="pathway" key={s.turn}>
                  T{s.turn}: {s.action} — <em>{s.rationale}</em>
                </div>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <div className="section-title">{title}</div>
      {children}
    </div>
  );
}

function DamageRow({ m, mine }: { m: MoveAnnotation; mine: boolean }) {
  const width = Math.min(m.maxPct, 100);
  return (
    <>
      <div className="row">
        <span className="name" style={{ minWidth: 92 }}>
          {m.move}
        </span>
        <span className="bar">
          <span className={`bar-fill ${mine ? 'fill-us' : 'fill-them'}`} style={{ display: 'block', width: `${width}%` }} />
        </span>
        <span className="pct mono">
          {m.minPct}–{m.maxPct}%
        </span>
      </div>
      {m.koChance && <div className="ko">{m.koChance}</div>}
    </>
  );
}

function ProbRow({ name, p }: { name: string; p: number }) {
  return (
    <div className="row">
      <span className="name" style={{ minWidth: 118 }}>
        {name}
      </span>
      <span className="bar">
        <span className="bar-fill fill-prob" style={{ display: 'block', width: `${Math.round(p * 100)}%` }} />
      </span>
      <span className="muted mono" style={{ minWidth: 34, textAlign: 'right' }}>
        {Math.round(p * 100)}%
      </span>
    </div>
  );
}
