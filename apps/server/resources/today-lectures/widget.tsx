import React from 'react';
import { Frame, TitleBlock, ThemeToggle, Empty, useLibretto } from '../_lib/kit';
import { LecturesSection, type Lecture } from '../_lib/sections';

type Props = { lectures: Lecture[]; date?: string };

export default function TodayWidget() {
  const { props, isPending, theme, locale, lang, t, toggleTheme } = useLibretto<Props>();
  const lectures = props.lectures ?? [];
  const heading = props.date
    ? new Intl.DateTimeFormat(lang === 'it' ? 'it-IT' : 'en-GB', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
      }).format(new Date(props.date))
    : '';

  return (
    <Frame theme={theme}>
      <TitleBlock
        eyebrow="POLITO · MCP"
        title={t('today')}
        right={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        meta={isPending ? t('loading') : `${heading}${heading ? ' · ' : ''}${lectures.length} ${t('lectures')}`}
      />
      <hr className="lib-rule" />
      {isPending ? <Empty label={t('loading')} /> : <LecturesSection lectures={lectures} t={t} locale={locale} />}
    </Frame>
  );
}
