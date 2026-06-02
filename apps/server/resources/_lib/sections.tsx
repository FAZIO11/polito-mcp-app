// Shared section renderers for the Libretto widgets + dashboard.
// Each renders the *body* of a domain (no outer Frame) so it can live inside a
// standalone widget or a dashboard drill-in. Lives in `_lib/` (ignored by
// widget discovery).
import React from 'react';
import {
  Badge,
  CountUp,
  Empty,
  Rise,
  fmtDate,
  fmtTime,
  daysUntil,
  numericGrade,
  isLode,
  type T,
} from './kit';

// ---- data shapes (mirror polito/types.ts) ----

export interface Grade {
  courseName: string;
  credits: number;
  grade: string;
  date: string;
  shortcode: string;
}
export interface Lecture {
  id: number;
  startsAt: string;
  endsAt: string;
  type: string;
  courseName: string;
  place: { name: string } | null;
}
export interface Deadline {
  id?: number;
  name: string;
  type: string;
  url: string | null;
  date: string;
}
export interface Offer {
  id: number;
  title: string;
  location: string;
  companyName: string;
  createdAtDate: string;
  endsAtDate: string;
}
export interface Room {
  buildingId: string;
  floorId: string;
  roomId: string;
  name: string;
  freeFrom: string;
  freeTo: string;
}

// ---- stats ----

export function gradeStats(grades: Grade[]) {
  let weighted = 0;
  let credits = 0;
  for (const g of grades) {
    const n = numericGrade(g.grade);
    if (n !== null) {
      weighted += n * g.credits;
      credits += g.credits;
    }
  }
  return { average: credits > 0 ? weighted / credits : null, acquiredCredits: credits };
}

function gradeTone(n: number): 'ok' | 'warn' | 'neutral' {
  return n >= 28 ? 'ok' : n >= 24 ? 'warn' : 'neutral';
}

// ---- Grades ----

export function GradesSection({ grades, t, locale }: { grades: Grade[]; t: T; locale: string }) {
  if (grades.length === 0) return <Empty label={t('emptyGrades')} />;
  const sorted = [...grades].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div>
      {sorted.map((g, i) => {
        const n = numericGrade(g.grade);
        const tone = n !== null ? gradeTone(n) : 'neutral';
        const toneColor =
          tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--ink-soft)';
        return (
          <Rise i={i} key={`${g.shortcode}-${i}`}>
            <div className="lib-row">
              <span
                className="lib-grade"
                style={{ color: toneColor, borderColor: 'currentColor' }}
                title={g.grade}
              >
                {n !== null ? (isLode(g.grade) ? '30L' : n) : '—'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 600,
                    fontSize: 13.5,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {g.courseName}
                </div>
                <div className="lib-eyebrow" style={{ letterSpacing: '.1em', marginTop: 2 }}>
                  {g.shortcode} · {g.credits} {t('credits')}
                </div>
              </div>
              <span className="lib-num" style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
                {fmtDate(g.date, locale)}
              </span>
            </div>
          </Rise>
        );
      })}
    </div>
  );
}

// ---- Today's lectures ----

export function LecturesSection({
  lectures,
  t,
  locale,
}: {
  lectures: Lecture[];
  t: T;
  locale: string;
}) {
  if (lectures.length === 0) return <Empty label={t('emptyToday')} />;
  const sorted = [...lectures].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const now = Date.now();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sorted.map((l, i) => {
        const ongoing = new Date(l.startsAt).getTime() <= now && now <= new Date(l.endsAt).getTime();
        return (
          <Rise i={i} key={l.id}>
            <div className="lib-card" style={ongoing ? { borderColor: 'var(--accent)' } : undefined}>
              <div style={{ display: 'flex', gap: 13, alignItems: 'center' }}>
                <div style={{ textAlign: 'center', minWidth: 50 }}>
                  <div className="lib-num" style={{ fontSize: 16, fontWeight: 600 }}>
                    {fmtTime(l.startsAt, locale)}
                  </div>
                  <div className="lib-num" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                    {fmtTime(l.endsAt, locale)}
                  </div>
                </div>
                <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                  >
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14 }}>
                      {l.courseName}
                    </span>
                    {ongoing ? (
                      <Badge tone="accent">
                        <span
                          className="lib-dot-live"
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: 'currentColor',
                            display: 'inline-block',
                          }}
                        />
                        {t('ongoing')}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="lib-eyebrow" style={{ letterSpacing: '.08em', marginTop: 4 }}>
                    {l.place?.name ? `▸ ${l.place.name}` : t('tbd')}
                    {l.type ? ` · ${l.type}` : ''}
                  </div>
                </div>
              </div>
            </div>
          </Rise>
        );
      })}
    </div>
  );
}

// ---- Deadlines ----

function urgencyTone(days: number): { tone: 'ok' | 'warn' | 'danger' | 'neutral'; dot: string } {
  if (Number.isNaN(days) || days < 0) return { tone: 'neutral', dot: 'var(--ink-soft)' };
  if (days <= 3) return { tone: 'danger', dot: 'var(--danger)' };
  if (days <= 7) return { tone: 'warn', dot: 'var(--warn)' };
  return { tone: 'ok', dot: 'var(--ok)' };
}

export function DeadlinesSection({
  deadlines,
  t,
  locale,
}: {
  deadlines: Deadline[];
  t: T;
  locale: string;
}) {
  if (deadlines.length === 0) return <Empty label={t('emptyDeadlines')} />;
  const sorted = [...deadlines].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {sorted.map((d, i) => {
        const days = daysUntil(d.date);
        const { tone, dot } = urgencyTone(days);
        const tag =
          Number.isNaN(days) || days < 0
            ? t('overdue')
            : days === 0
              ? t('todayTag')
              : t('inDays', days);
        const inner = (
          <div className="lib-card" style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: dot,
                flexShrink: 0,
                boxShadow: '0 0 0 3px color-mix(in srgb, currentColor 10%, transparent)',
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13 }}>
                {d.name}
              </div>
              <div className="lib-eyebrow" style={{ letterSpacing: '.08em', marginTop: 3 }}>
                {fmtDate(d.date, locale)}
                {d.type ? ` · ${d.type}` : ''}
              </div>
            </div>
            <Badge tone={tone}>{tag}</Badge>
            {d.url ? <span style={{ color: 'var(--accent)', fontSize: 13 }}>↗</span> : null}
          </div>
        );
        return (
          <Rise i={i} key={d.id ?? i}>
            {d.url ? (
              <a href={d.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
                {inner}
              </a>
            ) : (
              inner
            )}
          </Rise>
        );
      })}
    </div>
  );
}

// ---- Opportunities (filterable) ----

export function JobsSection({ offers, t, locale }: { offers: Offer[]; t: T; locale: string }) {
  const [q, setQ] = React.useState('');
  if (offers.length === 0) return <Empty label={t('emptyJobs')} />;
  const needle = q.trim().toLowerCase();
  const list = needle
    ? offers.filter((o) =>
        [o.title, o.companyName, o.location].some((f) => (f ?? '').toLowerCase().includes(needle)),
      )
    : offers;
  return (
    <div>
      <input
        className="lib-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('filterJobs')}
        style={{ marginBottom: 10 }}
      />
      {list.length === 0 ? (
        <Empty label={t('noResults')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map((o, i) => (
            <Rise i={i} key={o.id}>
              <div className="lib-card">
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13.5 }}>
                  {o.title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 3 }}>
                  {o.companyName}
                  {o.location ? ` · ${o.location}` : ''}
                </div>
                <div className="lib-eyebrow" style={{ letterSpacing: '.06em', marginTop: 6 }}>
                  {fmtDate(o.createdAtDate, locale)} → {fmtDate(o.endsAtDate, locale)}
                </div>
              </div>
            </Rise>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Free rooms (grouped by building) ----

export function RoomsSection({ rooms, t }: { rooms: Room[]; t: T; locale?: string }) {
  if (rooms.length === 0) return <Empty label={t('emptyRooms')} />;
  const byBuilding = new Map<string, Room[]>();
  for (const r of rooms) {
    const k = r.buildingId || '—';
    (byBuilding.get(k) ?? byBuilding.set(k, []).get(k)!).push(r);
  }
  const groups = [...byBuilding.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let idx = 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {groups.map(([building, list]) => (
        <div key={building}>
          <div className="lib-eyebrow" style={{ marginBottom: 7 }}>
            {t('building')} {building} · {list.length}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))',
              gap: 7,
            }}
          >
            {list
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((r) => (
                <Rise i={idx++} key={r.roomId || r.name}>
                  <div className="lib-card" style={{ padding: '9px 11px' }}>
                    <div className="lib-num" style={{ fontWeight: 600, fontSize: 12.5 }}>
                      {r.name}
                    </div>
                    <div className="lib-eyebrow" style={{ letterSpacing: '.06em', marginTop: 3 }}>
                      {t('floor')} {r.floorId || '—'}
                    </div>
                  </div>
                </Rise>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
