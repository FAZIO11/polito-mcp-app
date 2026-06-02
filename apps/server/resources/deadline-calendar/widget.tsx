import React from 'react';
import { Frame, TitleBlock, ThemeToggle, Empty, ConnectFrame, useLibretto, daysUntil } from '../_lib/kit';
import { DeadlinesSection, type Deadline } from '../_lib/sections';

type Props = { deadlines: Deadline[]; connectUrl?: string };

export default function DeadlinesWidget() {
  const { props, isPending, theme, locale, t, toggleTheme } = useLibretto<Props>();
  if (props.connectUrl)
    return <ConnectFrame theme={theme} title={t('deadlines')} url={props.connectUrl} t={t} onToggle={toggleTheme} />;
  const deadlines = props.deadlines ?? [];
  const upcoming = deadlines.filter((d) => daysUntil(d.date) >= 0).length;

  return (
    <Frame theme={theme}>
      <TitleBlock
        eyebrow="POLITO · MCP"
        title={t('deadlines')}
        right={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        meta={isPending ? t('loading') : `${deadlines.length} · ${upcoming} ${t('upcoming')}`}
      />
      <hr className="lib-rule" />
      {isPending ? (
        <Empty label={t('loading')} />
      ) : (
        <DeadlinesSection deadlines={deadlines} t={t} locale={locale} />
      )}
    </Frame>
  );
}
