import React from 'react';

/**
 * Page widths for every screen class. Phones get the full width with a 16px gutter (set by the app shell);
 * desktops centre the content; wide and ultrawide screens let analysis pages grow into extra columns instead of
 * leaving two-thirds of the screen empty.
 */
const WIDTHS = {
  /** forms, lists and settings: long lines are hard to read */
  reading: 'max-w-3xl 3xl:max-w-4xl',
  /** analysis and dashboards */
  wide: 'max-w-5xl 2xl:max-w-7xl 3xl:max-w-[1600px] uw:max-w-[2000px]',
  full: '',
} as const;

/**
 * Class string for a page container. `flow` stacks cards in CSS columns on big screens (one column below 1536px,
 * two from 2xl, three on ultrawides): each card drops into the shortest column, so a short card never leaves a
 * hole under it (see .flow-cols in index.css). Children that must stay full width add FULL; wrappers that group
 * two cards add PAIR so their cards join the columns instead of nesting a second layout.
 */
export const pageClass = (width: keyof typeof WIDTHS = 'wide', flow = false) =>
  `${WIDTHS[width]} mx-auto w-full page-enter ${flow ? 'flex flex-col gap-4 2xl:block flow-cols' : 'space-y-4'}`;
/** the flow layout alone, for a section inside a page that sets its own width (e.g. a sub-tab) */
export const flowClass = 'flex flex-col gap-4 2xl:block flow-cols';
/** span every column of a flow page (headers, tile rows, the core chart) */
export const FULL = '2xl:col-span-full flow-full';
/** a card-group wrapper: stacked below 2xl, and its cards join the page columns from 2xl */
export const PAIR = 'flex flex-col gap-4 2xl:contents flow-pair';

export const Page: React.FC<{ width?: keyof typeof WIDTHS; flow?: boolean; className?: string; children: React.ReactNode }> = ({ width = 'wide', flow = false, className = '', children }) => (
  <div className={`${pageClass(width, flow)} ${className}`}>{children}</div>
);

/** Cards that flow into 2 columns on big screens and 3 on ultrawides; short cards never stretch to match tall ones. */
export const SectionGrid: React.FC<{ className?: string; max?: 2 | 3; children: React.ReactNode }> = ({ className = '', max = 3, children }) => (
  <div className={`grid gap-4 items-start 2xl:grid-cols-2 ${max === 3 ? 'uw:grid-cols-3' : ''} ${className}`}>{children}</div>
);

/** Headline tiles: 2 across on phones, 4 on desktops, more on wide screens when there are that many. */
export const TileRow: React.FC<{ count: number; className?: string; children: React.ReactNode }> = ({ count, className = '', children }) => {
  const cols =
    count <= 2 ? 'grid-cols-2' :
    count === 3 ? 'grid-cols-2 sm:grid-cols-3' :
    count <= 4 ? 'grid-cols-2 md:grid-cols-4' :
    count <= 6 ? 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6' :
    'grid-cols-2 md:grid-cols-4 3xl:grid-cols-8';
  return <div className={`grid gap-3 ${cols} ${className}`}>{children}</div>;
};
