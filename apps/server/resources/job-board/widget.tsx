import React from 'react';
import { Frame, TitleBlock, ThemeToggle, Empty, ConnectFrame, useLibretto } from '../_lib/kit';
import { JobsSection, type Offer } from '../_lib/sections';

type Props = { offers: Offer[]; connectUrl?: string };

export default function JobsWidget() {
  const { props, isPending, theme, locale, t, toggleTheme } = useLibretto<Props>();
  if (props.connectUrl)
    return <ConnectFrame theme={theme} title={t('jobs')} url={props.connectUrl} t={t} onToggle={toggleTheme} />;
  const offers = props.offers ?? [];

  return (
    <Frame theme={theme}>
      <TitleBlock
        eyebrow="POLITO · MCP"
        title={t('jobs')}
        right={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        meta={isPending ? t('loading') : `${offers.length} ${t('offers')}`}
      />
      <hr className="lib-rule" />
      {isPending ? <Empty label={t('loading')} /> : <JobsSection offers={offers} t={t} locale={locale} />}
    </Frame>
  );
}
