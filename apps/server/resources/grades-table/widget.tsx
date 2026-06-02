import React from 'react';
import { Frame, TitleBlock, ThemeToggle, CountUp, Empty, ConnectFrame, useLibretto } from '../_lib/kit';
import { GradesSection, gradeStats, type Grade } from '../_lib/sections';

type Props = { grades: Grade[]; connectUrl?: string };

export default function GradesWidget() {
  const { props, isPending, theme, locale, t, toggleTheme } = useLibretto<Props>();
  if (props.connectUrl)
    return <ConnectFrame theme={theme} title={t('grades')} url={props.connectUrl} t={t} onToggle={toggleTheme} />;
  const grades = props.grades ?? [];
  const { average, acquiredCredits } = gradeStats(grades);

  return (
    <Frame theme={theme}>
      <TitleBlock
        eyebrow="POLITO · MCP"
        title={t('grades')}
        right={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        meta={
          isPending ? (
            t('loading')
          ) : (
            <>
              {grades.length} {t('exams')} · {acquiredCredits} {t('credits')}
              {average !== null ? (
                <>
                  {' · '}
                  {t('gpa')}{' '}
                  <b style={{ color: 'var(--accent)', fontSize: 14 }}>
                    <CountUp value={average} />
                  </b>
                </>
              ) : null}
            </>
          )
        }
      />
      <hr className="lib-rule" />
      {isPending ? <Empty label={t('loading')} /> : <GradesSection grades={grades} t={t} locale={locale} />}
    </Frame>
  );
}
