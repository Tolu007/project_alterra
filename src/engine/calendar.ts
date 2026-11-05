import type { Level } from '../data/politics';
import { DAYS_PER_WEEK, MONTHS_PER_YEAR, START_YEAR, WEEKS_PER_MONTH, WEEKS_PER_YEAR } from './types';

// The calendar is compressed: four weeks a month, and every office has a one-year term.

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const monthOf = (week: number) => Math.floor(week / WEEKS_PER_MONTH) % MONTHS_PER_YEAR;
export const yearOf = (week: number) => START_YEAR + Math.floor(week / WEEKS_PER_YEAR);
export const weekOfYear = (week: number) => week % WEEKS_PER_YEAR;
export const isMonthEnd = (week: number) => week % WEEKS_PER_MONTH === WEEKS_PER_MONTH - 1;
export const isYearEnd = (week: number) => weekOfYear(week) === WEEKS_PER_YEAR - 1;
export const isWorkday = (day: number) => day < 5;
export const isRainySeason = (week: number) => monthOf(week) >= 4 && monthOf(week) <= 8;

/** "07:45" from minutes after midnight (past midnight wraps round). */
/** "4h", "1h30", "45m". */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m}m`;
}

export function clockLabel(minute: number): string {
  const m = Math.floor(minute) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';
export function dayPart(minute: number): DayPart {
  const m = minute % 1440;
  return m < 5 * 60 ? 'night' : m < 12 * 60 ? 'morning' : m < 17 * 60 ? 'afternoon' : m < 21 * 60 ? 'evening' : 'night';
}
export const DAY_PART_NAMES: Record<DayPart, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };

export function dateLabel(week: number, day = 0): string {
  const d = day >= DAYS_PER_WEEK ? 'Sun' : DAY_NAMES[day];
  return `${d} · Week ${(week % WEEKS_PER_MONTH) + 1}, ${MONTH_NAMES[monthOf(week)]} ${yearOf(week)}`;
}

/** Week of the year when each level votes: councils in April, governors in August, president in November. */
export const ELECTION_WEEK: Record<Level, number> = { lga: 14, state: 30, federal: 44 };
export const PRIMARY_LEAD = 5;
export const CAMPAIGN_LEAD = 3;

export const isElectionWeek = (week: number, level: Level) => weekOfYear(week) === ELECTION_WEEK[level];
/** Nomination forms are on sale during the primary window. */
export const inPrimaries = (week: number, level: Level) => {
  const w = weekOfYear(week);
  return w >= ELECTION_WEEK[level] - PRIMARY_LEAD && w < ELECTION_WEEK[level] - CAMPAIGN_LEAD;
};
export const inCampaign = (week: number, level: Level) => {
  const w = weekOfYear(week);
  return w >= ELECTION_WEEK[level] - CAMPAIGN_LEAD && w <= ELECTION_WEEK[level];
};
/** The last week of primaries, when party delegates decide. */
export const isPrimaryWeek = (week: number, level: Level) => weekOfYear(week) === ELECTION_WEEK[level] - CAMPAIGN_LEAD - 1;

export function weeksUntilElection(week: number, level: Level): number {
  const w = weekOfYear(week);
  const e = ELECTION_WEEK[level];
  return e >= w ? e - w : WEEKS_PER_YEAR - w + e;
}
