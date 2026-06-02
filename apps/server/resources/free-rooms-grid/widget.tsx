import React from 'react';
import { Frame, TitleBlock, ThemeToggle, Empty, useLibretto } from '../_lib/kit';
import { RoomsSection, type Room } from '../_lib/sections';

type Props = {
  rooms: Room[];
  siteId?: string;
  date?: string;
  freeFrom?: string;
  freeTo?: string;
};

export default function FreeRoomsWidget() {
  const { props, isPending, theme, locale, t, toggleTheme } = useLibretto<Props>();
  const rooms = props.rooms ?? [];
  const win = props.freeFrom && props.freeTo ? `${props.freeFrom}–${props.freeTo}` : '';
  const meta = isPending
    ? t('loading')
    : [props.siteId, win, `${rooms.length} ${t('free')}`].filter(Boolean).join(' · ');

  return (
    <Frame theme={theme}>
      <TitleBlock
        eyebrow="POLITO · MCP"
        title={t('rooms')}
        right={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        meta={meta}
      />
      <hr className="lib-rule" />
      {isPending ? <Empty label={t('loading')} /> : <RoomsSection rooms={rooms} t={t} locale={locale} />}
    </Frame>
  );
}
