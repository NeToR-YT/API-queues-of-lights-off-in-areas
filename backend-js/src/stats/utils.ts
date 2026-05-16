import type { ScheduleEntry } from "../types.js";
import type { DailyStat } from "./types.js";

export const MIN_PER_DAY = 1440;
export const WEEKDAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

const PERIOD_RE = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;

function periodToMinutes(period: string): [number, number] | null {
  const m = PERIOD_RE.exec(period);
  if (!m) return null;
  const sh = +m[1]!, sm = +m[2]!, eh = +m[3]!, em = +m[4]!;
  const start = sh * 60 + sm;
  let end = eh * 60 + em;
  if (end === 0) end = MIN_PER_DAY;
  if (end <= start) end += MIN_PER_DAY;
  return [start, end];
}

function unionAllQueues(schedule: Record<string, string[]>): string[] {
  return Object.values(schedule).flat();
}

function getPeriods(entry: ScheduleEntry, queue?: string): string[] {
  if (queue) return entry.schedule[queue] ?? [];
  return unionAllQueues(entry.schedule);
}

export function getMergedIntervals(entry: ScheduleEntry, queue?: string): Array<[number, number]> {
  const periods = getPeriods(entry, queue);
  const intervals: Array<[number, number]> = [];
  for (const p of periods) {
    const tuple = periodToMinutes(p);
    if (tuple) {
      const cs = Math.max(0, tuple[0]);
      const ce = Math.min(MIN_PER_DAY, tuple[1]);
      if (ce > cs) intervals.push([cs, ce]);
    }
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const cur of intervals) {
    const last = merged[merged.length - 1];
    if (last && cur[0] <= last[1]) {
      last[1] = Math.max(last[1], cur[1]);
    } else {
      merged.push([cur[0], cur[1]]);
    }
  }
  return merged;
}

export function overlapWithRange(
  intervals: Array<[number, number]>,
  rangeStart: number,
  rangeEnd: number
): number {
  let sum = 0;
  for (const [s, e] of intervals) {
    const overlap = Math.min(e, rangeEnd) - Math.max(s, rangeStart);
    if (overlap > 0) sum += overlap;
  }
  return sum;
}

export function computeDailyStat(entry: ScheduleEntry, queue?: string): DailyStat {
  const merged = getMergedIntervals(entry, queue);
  let offMinutes = 0;
  const hourlyMask = new Array<number>(24).fill(0);

  for (const [s, e] of merged) {
    offMinutes += e - s;
    const startH = Math.floor(s / 60);
    const endH = Math.min(23, Math.floor((e - 1) / 60));
    for (let h = startH; h <= endH; h++) {
      const hStart = h * 60;
      const hEnd = hStart + 60;
      const overlap = Math.min(e, hEnd) - Math.max(s, hStart);
      if (overlap > 0) hourlyMask[h]! += overlap / 60;
    }
  }

  return {
    date: entry.schedule_date,
    off_minutes: offMinutes,
    blocks_count: merged.length,
    hourly_mask: hourlyMask,
    emergency: entry.emergency_outages,
    intervals: merged,
  };
}

export function generateDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const start = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return dates;
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

export function getWeekday(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00Z");
  return (d.getUTCDay() + 6) % 7;
}

export function defaultDateRange(): { from: string; to: string } {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 30);
  return { from: from.toISOString().slice(0, 10), to: todayStr };
}

export function dayIndex(dateStr: string): number {
  return Math.floor(Date.parse(dateStr + "T00:00:00Z") / 86_400_000);
}

export function minsToTimeStr(mins: number): string {
  if (mins >= MIN_PER_DAY) return "24:00";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function detectAllQueues(entries: ScheduleEntry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) for (const q of Object.keys(e.schedule)) set.add(q);
  return Array.from(set).sort();
}
