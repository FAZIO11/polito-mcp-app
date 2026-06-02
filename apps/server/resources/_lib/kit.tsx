// ─────────────────────────────────────────────────────────────────────────
//  LIBRETTO — the polito-mcp widget design system
//
//  Concept: the PoliTO "libretto universitario" reimagined as an engineer's
//  drafting notebook. Warm paper + graphite ink + one blueprint-blue signal,
//  a faint graph-paper grid, hairline pencil rules, drafting corner ticks,
//  Bricolage Grotesque for display + IBM Plex Mono for every number/code.
//
//  Lives in `_lib/` (no widget.tsx) so mcp-use widget discovery ignores it.
//  Imported by every `<name>/widget.tsx` and the dashboard via `../_lib/kit`.
// ─────────────────────────────────────────────────────────────────────────
import React from 'react';
import { useWidget } from 'mcp-use/react';
import type { Theme } from 'mcp-use/react';

// ---- locale + i18n ---------------------------------------------------------

export type Lang = 'en' | 'it';

/** Normalize the host BCP-47 locale to a supported UI language. */
export function langOf(locale: string | undefined): Lang {
  return (locale ?? '').toLowerCase().startsWith('it') ? 'it' : 'en';
}

const STRINGS = {
  // section + widget titles
  grades: { en: 'Transcript', it: 'Libretto' },
  today: { en: 'Today', it: 'Oggi' },
  deadlines: { en: 'Deadlines', it: 'Scadenze' },
  jobs: { en: 'Opportunities', it: 'Offerte' },
  rooms: { en: 'Free rooms', it: 'Aule libere' },
  dashboard: { en: 'Student desk', it: 'Scrivania' },
  // labels
  exams: { en: 'exams', it: 'esami' },
  credits: { en: 'credits', it: 'CFU' },
  gpa: { en: 'weighted avg', it: 'media ponder.' },
  lectures: { en: 'lectures', it: 'lezioni' },
  upcoming: { en: 'upcoming', it: 'in arrivo' },
  offers: { en: 'offers', it: 'offerte' },
  free: { en: 'free now', it: 'libere ora' },
  room: { en: 'room', it: 'aula' },
  floor: { en: 'floor', it: 'piano' },
  building: { en: 'building', it: 'edificio' },
  ongoing: { en: 'now', it: 'in corso' },
  tbd: { en: 'room TBD', it: 'aula da definire' },
  // states
  loading: { en: 'Loading…', it: 'Caricamento…' },
  emptyGrades: { en: 'No grades recorded yet.', it: 'Nessun voto registrato.' },
  emptyToday: { en: 'No lectures scheduled.', it: 'Nessuna lezione in programma.' },
  emptyDeadlines: { en: 'No deadlines in range.', it: 'Nessuna scadenza nel periodo.' },
  emptyJobs: { en: 'No offers available.', it: 'Nessuna offerta disponibile.' },
  emptyRooms: { en: 'No free rooms in this window.', it: 'Nessuna aula libera ora.' },
  noResults: { en: 'No matches.', it: 'Nessun risultato.' },
  // deadline urgency
  overdue: { en: 'past', it: 'scaduta' },
  todayTag: { en: 'today', it: 'oggi' },
  inDays: { en: 'in %dd', it: 'tra %dg' },
  // dashboard
  filterJobs: { en: 'Filter by title, company, place…', it: 'Filtra per titolo, azienda, sede…' },
  ask: { en: 'Ask polito-mcp…', it: 'Chiedi a polito-mcp…' },
  back: { en: 'Desk', it: 'Scrivania' },
  // quick prompts (dashboard chat chips)
  qWhatToday: { en: "What's on today?", it: 'Cosa ho oggi?' },
  qNextDeadline: { en: 'My next deadline', it: 'Prossima scadenza' },
  qFreeRoom: { en: 'Free room near me', it: 'Aula libera vicino a me' },
} satisfies Record<string, Record<Lang, string>>;

export type StringKey = keyof typeof STRINGS;
export type T = (key: StringKey, n?: number) => string;

export function makeT(lang: Lang): T {
  return (key, n) => {
    const s = STRINGS[key][lang];
    return n === undefined ? s : s.replace('%d', String(n));
  };
}

// ---- theme state (host theme + manual override) ----------------------------

/** Reads the host theme/locale and lets the user override the theme locally. */
export function useLibretto<TProps = Record<string, unknown>>() {
  const w = useWidget<TProps>();
  const hostTheme = (w.theme as Theme) ?? 'light';
  const [override, setOverride] = React.useState<Theme | null>(null);
  const theme: Theme = override ?? hostTheme;
  const lang = langOf(w.locale);
  const toggleTheme = () => setOverride(theme === 'dark' ? 'light' : 'dark');
  return { ...w, theme, lang, t: makeT(lang), toggleTheme };
}

// ---- design tokens ---------------------------------------------------------

type Vars = Record<`--${string}`, string>;

export function tokens(theme: Theme): Vars {
  return theme === 'dark'
    ? {
        '--paper': '#121318',
        '--surface': '#191b22',
        '--surface-2': '#1f222b',
        '--ink': '#ece6d6',
        '--ink-soft': '#9a958a',
        '--ink-faint': '#6a6a6a',
        '--line': '#2c2f39',
        '--line-2': '#3a3e4a',
        '--accent': '#6f8dff',
        '--accent-ink': '#0a0d18',
        '--grid': 'rgba(120,140,210,0.06)',
        '--ok': '#5fd08a',
        '--ok-bg': 'rgba(95,208,138,0.13)',
        '--warn': '#e3b341',
        '--warn-bg': 'rgba(227,179,65,0.13)',
        '--danger': '#ff7a6b',
        '--danger-bg': 'rgba(255,122,107,0.13)',
        '--shadow': '0 1px 0 rgba(0,0,0,0.5), 0 18px 40px -28px rgba(0,0,0,0.9)',
      }
    : {
        '--paper': '#efe9da',
        '--surface': '#faf6ec',
        '--surface-2': '#f2ecdd',
        '--ink': '#1b1a16',
        '--ink-soft': '#5b564a',
        '--ink-faint': '#8a8472',
        '--line': '#d4ccb8',
        '--line-2': '#bcb29a',
        '--accent': '#1742c8',
        '--accent-ink': '#ffffff',
        '--grid': 'rgba(40,60,120,0.06)',
        '--ok': '#2c7a48',
        '--ok-bg': 'rgba(44,122,72,0.12)',
        '--warn': '#9a6a16',
        '--warn-bg': 'rgba(154,106,22,0.13)',
        '--danger': '#b23a2c',
        '--danger-bg': 'rgba(178,58,44,0.12)',
        '--shadow': '0 1px 0 rgba(255,255,255,0.6), 0 16px 36px -26px rgba(40,40,30,0.55)',
      };
}

// ---- global stylesheet (fonts, grid, ticks, motion) ------------------------

const FONTS =
  "@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;1,400&display=swap');";

const LIB_CSS = `
${FONTS}
.lib{
  --font-display:'Bricolage Grotesque',ui-sans-serif,system-ui,sans-serif;
  --font-mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  background:var(--paper);
  color:var(--ink);
  font-family:var(--font-mono);
  border-radius:14px;
  position:relative;
  box-sizing:border-box;
  -webkit-font-smoothing:antialiased;
  background-image:
    linear-gradient(var(--grid) 1px,transparent 1px),
    linear-gradient(90deg,var(--grid) 1px,transparent 1px);
  background-size:22px 22px;
}
.lib *{box-sizing:border-box;}
.lib ::selection{background:var(--accent);color:var(--accent-ink);}
.lib-pad{padding:18px 18px 20px;}

/* drafting corner ticks */
.lib-ticks::before,.lib-ticks::after,
.lib-ticks>.lib-tick-bl,.lib-ticks>.lib-tick-br{
  content:'';position:absolute;width:11px;height:11px;pointer-events:none;
  border-color:var(--line-2);border-style:solid;border-width:0;
}
.lib-ticks::before{top:8px;left:8px;border-top-width:1.5px;border-left-width:1.5px;}
.lib-ticks::after{top:8px;right:8px;border-top-width:1.5px;border-right-width:1.5px;}
.lib-ticks>.lib-tick-bl{bottom:8px;left:8px;border-bottom-width:1.5px;border-left-width:1.5px;}
.lib-ticks>.lib-tick-br{bottom:8px;right:8px;border-bottom-width:1.5px;border-right-width:1.5px;}

.lib-eyebrow{
  font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:.22em;
  text-transform:uppercase;color:var(--ink-soft);
}
.lib-title{
  font-family:var(--font-display);font-weight:700;font-size:24px;line-height:1.02;
  letter-spacing:-0.015em;margin:2px 0 0;color:var(--ink);
}
.lib-rule{height:1px;background:var(--line);border:0;margin:13px 0;}
.lib-rule-dash{height:0;border:0;border-top:1px dashed var(--line-2);margin:13px 0;}

.lib-row{
  display:flex;align-items:center;gap:12px;padding:9px 0;
  border-bottom:1px solid var(--line);
}
.lib-row:last-child{border-bottom:0;}
.lib-card{
  background:var(--surface);border:1px solid var(--line);border-radius:11px;
  padding:11px 13px;position:relative;transition:transform .14s ease,border-color .14s ease;
}
.lib-card:hover{border-color:var(--line-2);}
.lib-tile{
  background:var(--surface);border:1px solid var(--line);border-radius:12px;
  padding:13px;cursor:pointer;text-align:left;width:100%;color:inherit;font:inherit;
  position:relative;overflow:hidden;transition:transform .14s ease,border-color .14s ease,box-shadow .14s ease;
}
.lib-tile:hover{transform:translateY(-2px);border-color:var(--accent);box-shadow:var(--shadow);}
.lib-tile:focus-visible,.lib-btn:focus-visible,.lib-chip:focus-visible,.lib-tab:focus-visible{
  outline:2px solid var(--accent);outline-offset:2px;
}
.lib-tile::after{
  content:'';position:absolute;right:-18px;top:-18px;width:46px;height:46px;border-radius:50%;
  background:var(--accent);opacity:.07;transition:opacity .14s ease;
}
.lib-tile:hover::after{opacity:.16;}

.lib-badge{
  display:inline-flex;align-items:center;gap:5px;font-family:var(--font-mono);
  font-size:11px;font-weight:600;line-height:1;padding:4px 8px;border-radius:6px;white-space:nowrap;
}
.lib-grade{
  font-family:var(--font-mono);font-weight:600;font-size:14px;min-width:34px;text-align:center;
  padding:4px 7px;border-radius:7px;border:1px solid var(--line-2);
}
.lib-num{font-family:var(--font-mono);font-variant-numeric:tabular-nums;}

.lib-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;
  font-family:var(--font-mono);font-size:12px;font-weight:600;padding:7px 11px;border-radius:8px;
  border:1px solid var(--line-2);background:var(--surface);color:var(--ink);transition:all .14s ease;
}
.lib-btn:hover{border-color:var(--accent);color:var(--accent);}
.lib-chip{
  cursor:pointer;font-family:var(--font-mono);font-size:11.5px;padding:6px 10px;border-radius:999px;
  border:1px solid var(--line-2);background:transparent;color:var(--ink-soft);transition:all .14s ease;white-space:nowrap;
}
.lib-chip:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-bg,transparent);}
.lib-input{
  width:100%;font-family:var(--font-mono);font-size:12.5px;padding:9px 12px;border-radius:9px;
  border:1px solid var(--line);background:var(--paper);color:var(--ink);outline:none;transition:border-color .14s ease;
}
.lib-input:focus{border-color:var(--accent);}
.lib-input::placeholder{color:var(--ink-soft);opacity:.8;}

.lib-tab{
  cursor:pointer;font-family:var(--font-mono);font-size:11px;font-weight:600;letter-spacing:.12em;
  text-transform:uppercase;padding:7px 4px;border:0;background:transparent;color:var(--ink-soft);
  border-bottom:2px solid transparent;transition:color .14s ease,border-color .14s ease;
}
.lib-tab[data-active="true"]{color:var(--ink);border-bottom-color:var(--accent);}

@keyframes lib-rise{from{opacity:0;transform:translateY(7px);}to{opacity:1;transform:none;}}
@keyframes lib-pulse{0%,100%{opacity:1;}50%{opacity:.4;}}
.lib-rise{animation:lib-rise .42s cubic-bezier(.2,.7,.2,1) both;}
.lib-dot-live{animation:lib-pulse 1.6s ease-in-out infinite;}

@media (prefers-reduced-motion:reduce){
  .lib-rise{animation:none;}.lib-dot-live{animation:none;}
  .lib-tile,.lib-card,.lib-btn{transition:none;}
}
`;

/** Injects the Libretto stylesheet. One Frame (→ one GlobalStyle) per widget iframe. */
export function GlobalStyle() {
  return <style>{LIB_CSS}</style>;
}

// ---- primitives ------------------------------------------------------------

export function Ticks() {
  return (
    <>
      <span className="lib-tick-bl" />
      <span className="lib-tick-br" />
    </>
  );
}

/** The drafting "title block" header: eyebrow code, display title, right slot. */
export function TitleBlock({
  eyebrow,
  title,
  meta,
  right,
}: {
  eyebrow: string;
  title: string;
  meta?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div className="lib-eyebrow">{eyebrow}</div>
        <h1 className="lib-title">{title}</h1>
        {meta ? (
          <div className="lib-num" style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6 }}>
            {meta}
          </div>
        ) : null}
      </div>
      {right ? <div style={{ flexShrink: 0 }}>{right}</div> : null}
    </div>
  );
}

/** A drafting-switch style light/dark toggle. */
export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button
      className="lib-btn"
      onClick={onToggle}
      aria-label="Toggle theme"
      title="Light / dark"
      style={{ padding: '6px 9px', borderRadius: 8 }}
    >
      <span style={{ fontSize: 13, lineHeight: 1 }}>{theme === 'dark' ? '☾' : '☀'}</span>
    </button>
  );
}

/** Outer widget frame: paper, grid, corner ticks, padding. */
export function Frame({
  theme,
  children,
  style,
}: {
  theme: Theme;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="lib lib-ticks lib-pad" style={{ ...(tokens(theme) as React.CSSProperties), ...style }}>
      <GlobalStyle />
      <Ticks />
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'ok' | 'warn' | 'danger' | 'accent' | 'neutral';
}) {
  const map: Record<string, React.CSSProperties> = {
    ok: { color: 'var(--ok)', background: 'var(--ok-bg)' },
    warn: { color: 'var(--warn)', background: 'var(--warn-bg)' },
    danger: { color: 'var(--danger)', background: 'var(--danger-bg)' },
    accent: { color: 'var(--accent-ink)', background: 'var(--accent)' },
    neutral: { color: 'var(--ink-soft)', background: 'var(--surface-2)' },
  };
  return (
    <span className="lib-badge" style={map[tone]}>
      {children}
    </span>
  );
}

export function Empty({ label }: { label: string }) {
  return (
    <div
      style={{
        color: 'var(--ink-soft)',
        fontSize: 12.5,
        textAlign: 'center',
        padding: '26px 12px',
        border: '1px dashed var(--line-2)',
        borderRadius: 10,
      }}
    >
      {label}
    </div>
  );
}

/** Animates a number from 0 → value on mount (respects reduced-motion). */
export function CountUp({ value, decimals = 2 }: { value: number; decimals?: number }) {
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    if (typeof window === 'undefined') {
      setN(value);
      return;
    }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !Number.isFinite(value)) {
      setN(value);
      return;
    }
    const start = performance.now();
    const dur = 650;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(value * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{n.toFixed(decimals)}</>;
}

/** Staggered entrance wrapper — pass the row index for the cascade. */
export function Rise({
  i = 0,
  children,
  style,
  className,
}: {
  i?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={`lib-rise${className ? ` ${className}` : ''}`}
      style={{ animationDelay: `${Math.min(i, 12) * 38}ms`, ...style }}
    >
      {children}
    </div>
  );
}

// ---- formatting ------------------------------------------------------------

export function fmtTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale || 'en-GB', { hour: '2-digit', minute: '2-digit' }).format(d);
}

export function fmtDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale || 'en-GB', { day: '2-digit', month: 'short' }).format(d);
}

export function daysUntil(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NaN;
  const today = new Date();
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((a - b) / 86_400_000);
}

/** Numeric grade (lode → 30), or null for pass/fail. */
export function numericGrade(grade: string): number | null {
  const m = grade.match(/\d{1,2}/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return n >= 18 && n <= 31 ? n : null;
}

export function isLode(grade: string): boolean {
  return /lode|\b30\s*l\b/i.test(grade);
}
