import React from 'react';
import {
  Frame,
  TitleBlock,
  ThemeToggle,
  Empty,
  Rise,
  CountUp,
  useLibretto,
  fmtTime,
  fmtDate,
  daysUntil,
  type T,
  type StringKey,
} from '../_lib/kit';
import {
  GradesSection,
  LecturesSection,
  DeadlinesSection,
  JobsSection,
  RoomsSection,
  gradeStats,
  type Grade,
  type Lecture,
  type Deadline,
  type Offer,
  type Room,
} from '../_lib/sections';

type Props = {
  profile?: { firstName?: string; degreeName?: string } | null;
  grades: Grade[];
  lectures: Lecture[];
  deadlines: Deadline[];
  rooms: Room[];
  offers: Offer[];
  date?: string;
  siteId?: string;
  freeFrom?: string;
  freeTo?: string;
};

type View = 'home' | 'grades' | 'today' | 'deadlines' | 'rooms' | 'jobs';

const SECTION_KEY: Record<Exclude<View, 'home'>, StringKey> = {
  grades: 'grades',
  today: 'today',
  deadlines: 'deadlines',
  rooms: 'rooms',
  jobs: 'jobs',
};

function nextLecture(lectures: Lecture[], locale: string): string | null {
  const now = Date.now();
  const sorted = [...lectures].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const ongoing = sorted.find((l) => new Date(l.startsAt).getTime() <= now && now <= new Date(l.endsAt).getTime());
  if (ongoing) return fmtTime(ongoing.startsAt, locale);
  const upcoming = sorted.find((l) => new Date(l.startsAt).getTime() > now);
  return upcoming ? fmtTime(upcoming.startsAt, locale) : null;
}

function Tile({
  glyph,
  label,
  value,
  sub,
  onClick,
  i,
}: {
  glyph: string;
  label: string;
  value: React.ReactNode;
  sub?: string;
  onClick: () => void;
  i: number;
}) {
  return (
    <Rise i={i}>
      <button className="lib-tile" onClick={onClick}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="lib-eyebrow">{label}</span>
          <span style={{ fontSize: 14, opacity: 0.7 }}>{glyph}</span>
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 26,
            lineHeight: 1.05,
            marginTop: 10,
            letterSpacing: '-0.02em',
          }}
        >
          {value}
        </div>
        {sub ? (
          <div className="lib-eyebrow" style={{ letterSpacing: '.08em', marginTop: 4 }}>
            {sub}
          </div>
        ) : null}
      </button>
    </Rise>
  );
}

function ChatDock({
  t,
  draft,
  setDraft,
  send,
}: {
  t: T;
  draft: string;
  setDraft: (s: string) => void;
  send: (s: string) => void;
}) {
  const chips: StringKey[] = ['qWhatToday', 'qNextDeadline', 'qFreeRoom'];
  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--line-2)' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 9 }}>
        {chips.map((c) => (
          <button key={c} className="lib-chip" onClick={() => send(t(c))}>
            {t(c)}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        style={{ display: 'flex', gap: 8 }}
      >
        <input
          className="lib-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('ask')}
        />
        <button className="lib-btn" type="submit" aria-label="Send" style={{ padding: '0 14px' }}>
          ↵
        </button>
      </form>
    </div>
  );
}

export default function Dashboard() {
  const w = useLibretto<Props>();
  const { props, isPending, theme, locale, lang, t, toggleTheme } = w;
  const [view, setView] = React.useState<View>('home');
  const [draft, setDraft] = React.useState('');

  const send = (text: string) => {
    const msg = text.trim();
    if (!msg) return;
    void w.sendFollowUpMessage?.(msg);
    setDraft('');
  };

  if (isPending) {
    return (
      <Frame theme={theme}>
        <TitleBlock
          eyebrow="POLITO · MCP"
          title={t('dashboard')}
          right={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        />
        <hr className="lib-rule" />
        <Empty label={t('loading')} />
      </Frame>
    );
  }

  const grades = props.grades ?? [];
  const lectures = props.lectures ?? [];
  const deadlines = props.deadlines ?? [];
  const rooms = props.rooms ?? [];
  const offers = props.offers ?? [];
  const { average, acquiredCredits } = gradeStats(grades);
  const upcomingDeadlines = [...deadlines]
    .filter((d) => daysUntil(d.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const nextL = nextLecture(lectures, locale);
  const firstName = props.profile?.firstName;
  const greeting = firstName
    ? lang === 'it'
      ? `Ciao, ${firstName}`
      : `Hi, ${firstName}`
    : t('dashboard');

  const themeBtn = <ThemeToggle theme={theme} onToggle={toggleTheme} />;

  // ---- section drill-in ----
  if (view !== 'home') {
    const k = SECTION_KEY[view];
    return (
      <Frame theme={theme}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <button className="lib-btn" onClick={() => setView('home')} style={{ padding: '6px 11px' }}>
            ‹ {t('back')}
          </button>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>{t(k)}</span>
          {themeBtn}
        </div>
        <hr className="lib-rule" />
        {view === 'grades' && <GradesSection grades={grades} t={t} locale={locale} />}
        {view === 'today' && <LecturesSection lectures={lectures} t={t} locale={locale} />}
        {view === 'deadlines' && <DeadlinesSection deadlines={deadlines} t={t} locale={locale} />}
        {view === 'rooms' && <RoomsSection rooms={rooms} t={t} locale={locale} />}
        {view === 'jobs' && <JobsSection offers={offers} t={t} locale={locale} />}
        <ChatDock t={t} draft={draft} setDraft={setDraft} send={send} />
      </Frame>
    );
  }

  // ---- home grid ----
  return (
    <Frame theme={theme}>
      <TitleBlock
        eyebrow="POLITO · MCP — LIBRETTO"
        title={greeting}
        meta={props.profile?.degreeName ?? undefined}
        right={themeBtn}
      />
      <hr className="lib-rule" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 9 }}>
        <Tile
          i={0}
          glyph="✎"
          label={t('grades')}
          value={average !== null ? <CountUp value={average} /> : '—'}
          sub={`${grades.length} ${t('exams')} · ${acquiredCredits} ${t('credits')}`}
          onClick={() => setView('grades')}
        />
        <Tile
          i={1}
          glyph="◷"
          label={t('today')}
          value={lectures.length}
          sub={nextL ? `▸ ${nextL}` : t('lectures')}
          onClick={() => setView('today')}
        />
        <Tile
          i={2}
          glyph="!"
          label={t('deadlines')}
          value={upcomingDeadlines.length}
          sub={upcomingDeadlines[0] ? fmtDate(upcomingDeadlines[0].date, locale) : t('upcoming')}
          onClick={() => setView('deadlines')}
        />
        <Tile
          i={3}
          glyph="▦"
          label={t('rooms')}
          value={rooms.length}
          sub={props.freeFrom && props.freeTo ? `${props.freeFrom}–${props.freeTo}` : t('free')}
          onClick={() => setView('rooms')}
        />
        <Tile
          i={4}
          glyph="✦"
          label={t('jobs')}
          value={offers.length}
          sub={t('offers')}
          onClick={() => setView('jobs')}
        />
      </div>
      <ChatDock t={t} draft={draft} setDraft={setDraft} send={send} />
    </Frame>
  );
}
