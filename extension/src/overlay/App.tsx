import { useEffect, useState } from 'react';
import type { AdviceFrame, LocalAnalysis, MoveAnnotation, SpeedVerdict, WinConTag } from '../lib/types';

const TAG_STYLE: Record<WinConTag, { label: string; color: string }> = {
  MUST_PRESERVE: { label: 'MUST PRESERVE', color: '#e5484d' },
  FLEXIBLE: { label: 'FLEXIBLE', color: '#f5a623' },
  SAFE_TO_SACRIFICE: { label: 'SAFE TO SAC', color: '#30a46c' },
};

const SPEED_STYLE: Record<SpeedVerdict, { label: string; color: string }> = {
  FASTER: { label: 'you outspeed', color: '#30a46c' },
  RANGE: { label: 'speed range', color: '#f5a623' },
  SLOWER: { label: 'outspeeds you', color: '#e5484d' },
};

/**
 * Panel sections: win-con tags + opponent intel come from the backend
 * (AdviceFrame, once per turn); damage and speed come from the client-side
 * calc (LocalAnalysis, on every state change). Hidden outside of battles.
 */
export function App() {
  const [frame, setFrame] = useState<AdviceFrame | null>(null);
  const [local, setLocal] = useState<LocalAnalysis | null>(null);

  useEffect(() => {
    const onAdvice = (ev: Event) => setFrame((ev as CustomEvent<AdviceFrame>).detail);
    const onLocal = (ev: Event) => setLocal((ev as CustomEvent<LocalAnalysis>).detail);
    const onEnd = () => {
      setFrame(null);
      setLocal(null);
    };
    window.addEventListener('poke-copilot:advice', onAdvice);
    window.addEventListener('poke-copilot:local', onLocal);
    window.addEventListener('poke-copilot:battle-end', onEnd);
    return () => {
      window.removeEventListener('poke-copilot:advice', onAdvice);
      window.removeEventListener('poke-copilot:local', onLocal);
      window.removeEventListener('poke-copilot:battle-end', onEnd);
    };
  }, []);

  if (!frame && !local) return null;

  const oppActiveSet = frame?.opponent.sets.find((s) => s.species === local?.oppActive);

  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>
        Poké-Copilot{frame ? ` — turn ${frame.turn} · win ${(frame.overallWinProb * 100).toFixed(0)}%` : ''}
        {frame && <span style={{ float: 'right', opacity: 0.5 }}>{frame.latencyMs}ms</span>}
      </div>

      {frame && frame.assessments.length > 0 && (
        <Section title="Bench value">
          {frame.assessments.map((a) => (
            <Row key={a.species}>
              <span style={{ minWidth: 90 }}>{a.species}</span>
              <Chip
                color={TAG_STYLE[a.tag].color}
                title={`${a.reason} (win% if lost: ${(a.winProbIfLost * 100).toFixed(0)} vs preserved: ${(a.winProbIfPreserved * 100).toFixed(0)})`}
              >
                {TAG_STYLE[a.tag].label}
              </Chip>
            </Row>
          ))}
        </Section>
      )}

      {local && local.ourActive && local.oppActive && (
        <Section title={`Matchup — ${local.ourActive} vs ${local.oppActive} (est.)`}>
          {local.ourMoves.map((m) => (
            <DamageRow key={`our-${m.move}`} m={m} prefix="▸" />
          ))}
          {local.theirMoves.length > 0 && (
            <div style={{ opacity: 0.85, marginTop: 4 }}>
              <div style={{ fontSize: 11, opacity: 0.7 }}>their revealed moves vs you:</div>
              {local.theirMoves.map((m) => (
                <DamageRow key={`their-${m.move}`} m={m} prefix="◂" />
              ))}
            </div>
          )}
        </Section>
      )}

      {local && local.speedTiers.length > 0 && (
        <Section title={`Speed — your ${local.ourActive} (${local.ourSpeed})`}>
          {local.speedTiers.map((s) => (
            <Row key={s.species}>
              <span style={{ minWidth: 110 }}>{s.species}</span>
              <span style={{ opacity: 0.6, fontSize: 11, minWidth: 62 }}>
                {s.minSpe}–{s.maxSpe}
              </span>
              <Chip color={SPEED_STYLE[s.verdict].color}>{SPEED_STYLE[s.verdict].label}</Chip>
            </Row>
          ))}
        </Section>
      )}

      {frame && (frame.opponent.unrevealed.length > 0 || oppActiveSet) && (
        <Section title="Opponent intel (Bayesian)">
          {oppActiveSet && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 11, opacity: 0.7 }}>{oppActiveSet.species} likely runs:</div>
              {oppActiveSet.moves.slice(0, 4).map((m) => (
                <Row key={m.name}>
                  <span style={{ minWidth: 130 }}>{m.name}</span>
                  <Prob p={m.probability} />
                </Row>
              ))}
              {oppActiveSet.item[0] && (
                <Row>
                  <span style={{ minWidth: 130 }}>item: {oppActiveSet.item[0].name}</span>
                  <Prob p={oppActiveSet.item[0].probability} />
                </Row>
              )}
            </div>
          )}
          {frame.opponent.unrevealed.length > 0 && (
            <div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>unrevealed teammates:</div>
              {frame.opponent.unrevealed.map((t) => (
                <Row key={t.name}>
                  <span style={{ minWidth: 130 }}>{t.name}</span>
                  <Prob p={t.probability} />
                </Row>
              ))}
            </div>
          )}
        </Section>
      )}

      {frame && frame.pathway.length > 0 && (
        <Section title="Best line">
          {frame.pathway.map((s) => (
            <div key={s.turn} style={{ fontSize: 12, opacity: 0.9 }}>
              T{s.turn}: {s.action} — <em>{s.rationale}</em>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 8, borderTop: '1px solid #3a3a3f', paddingTop: 6 }}>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '1px 0' }}>{children}</div>;
}

function Chip({ color, title, children }: { color: string; title?: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      style={{
        background: color,
        color: '#fff',
        borderRadius: 4,
        padding: '1px 6px',
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function DamageRow({ m, prefix }: { m: MoveAnnotation; prefix: string }) {
  return (
    <Row>
      <span style={{ opacity: 0.5 }}>{prefix}</span>
      <span style={{ minWidth: 110 }}>{m.move}</span>
      <span style={{ minWidth: 76, fontVariantNumeric: 'tabular-nums' }}>
        {m.minPct}–{m.maxPct}%
      </span>
      <span style={{ fontSize: 11, opacity: 0.7 }}>{m.koChance}</span>
    </Row>
  );
}

function Prob({ p }: { p: number }) {
  return <span style={{ fontSize: 11, opacity: 0.7 }}>{(p * 100).toFixed(0)}%</span>;
}

// Positioning lives on the container (overlay/main.tsx); this is visual-only.
const panelStyle: React.CSSProperties = {
  background: 'rgba(24, 24, 27, 0.95)',
  color: '#fafafa',
  font: '13px/1.4 system-ui, sans-serif',
  borderRadius: 8,
  padding: 12,
  boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
  maxHeight: '60vh',
  overflowY: 'auto',
};
