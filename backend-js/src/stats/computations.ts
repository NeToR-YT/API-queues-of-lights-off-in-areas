import type { ScheduleEntry } from "../types.js";
import type {
  BucketsStat,
  CoverageStat,
  HeatmapStat,
  QueueBreakdownItem,
  SummaryStat,
  TimeseriesPoint,
  TypicalWindowStat,
  WeekdayStat,
  DailyStat,
} from "./types.js";
import {
  MIN_PER_DAY,
  WEEKDAY_NAMES,
  computeDailyStat,
  dayIndex,
  detectAllQueues,
  generateDateRange,
  getMergedIntervals,
  getWeekday,
  minsToTimeStr,
  overlapWithRange,
} from "./utils.js";

function computeStreaks(daily: DailyStat[]): {
  blackout: number;
  power: number;
  minBlackout: number;
  minPower: number;
} {
  if (daily.length === 0) return { blackout: 0, power: 0, minBlackout: 0, minPower: 0 };

  const sorted = [...daily].sort((a, b) => (a.date < b.date ? -1 : 1));
  const absolute: Array<[number, number]> = [];
  for (const d of sorted) {
    const base = dayIndex(d.date) * MIN_PER_DAY;
    for (const [s, e] of d.intervals) absolute.push([base + s, base + e]);
  }
  absolute.sort((a, b) => a[0] - b[0]);

  const merged: Array<[number, number]> = [];
  for (const cur of absolute) {
    const last = merged[merged.length - 1];
    if (last && cur[0] <= last[1]) {
      last[1] = Math.max(last[1], cur[1]);
    } else {
      merged.push([cur[0], cur[1]]);
    }
  }

  let blackout = 0;
  let minBlackout = Infinity;
  for (const [s, e] of merged) {
    const dur = e - s;
    if (dur > blackout) blackout = dur;
    if (dur < minBlackout) minBlackout = dur;
  }

  let power = 0;
  let minPower = Infinity;
  for (let i = 1; i < merged.length; i++) {
    const gap = merged[i]![0] - merged[i - 1]![1];
    if (gap > 0) {
      if (gap > power) power = gap;
      if (gap < minPower) minPower = gap;
    }
  }

  return {
    blackout,
    power,
    minBlackout: minBlackout === Infinity ? 0 : minBlackout,
    minPower: minPower === Infinity ? 0 : minPower,
  };
}

export function computeSummary(
  entries: ScheduleEntry[],
  from: string,
  to: string,
  queue?: string
): SummaryStat {
  const daily = entries.map((e) => computeDailyStat(e, queue));
  const daysTotal = generateDateRange(from, to).length;
  const daysWithData = daily.length;

  let totalOffMins = 0;
  let totalBlocks = 0;
  let emergencyDays = 0;
  let min = Infinity;
  let max = 0;
  for (const d of daily) {
    totalOffMins += d.off_minutes;
    totalBlocks += d.blocks_count;
    if (d.emergency) emergencyDays += 1;
    if (d.off_minutes < min) min = d.off_minutes;
    if (d.off_minutes > max) max = d.off_minutes;
  }
  if (daysWithData === 0) min = 0;

  const avgOffMins = daysWithData > 0 ? totalOffMins / daysWithData : 0;

  let variance = 0;
  for (const d of daily) variance += (d.off_minutes - avgOffMins) ** 2;
  const stddev = daysWithData > 0 ? Math.sqrt(variance / daysWithData) : 0;

  const avgBlockMins = totalBlocks > 0 ? totalOffMins / totalBlocks : 0;
  const avgBlocksPerDay = daysWithData > 0 ? totalBlocks / daysWithData : 0;

  const reliabilityPercent =
    daysWithData > 0
      ? ((MIN_PER_DAY * daysWithData - totalOffMins) / (MIN_PER_DAY * daysWithData)) * 100
      : 100;

  const sortedByOff = [...daily].sort((a, b) => b.off_minutes - a.off_minutes);
  const toCard = (d: DailyStat) => ({
    date: d.date,
    off_hours: +(d.off_minutes / 60).toFixed(2),
  });
  const topWorst = sortedByOff.slice(0, 5).map(toCard);
  const topBest = sortedByOff.slice(-5).reverse().map(toCard);

  const emergencyRate = daysWithData > 0 ? (emergencyDays / daysWithData) * 100 : 0;
  const { blackout, power, minBlackout, minPower } = computeStreaks(daily);

  return {
    period: { from, to, days_total: daysTotal, days_with_data: daysWithData },
    total_off_hours: +(totalOffMins / 60).toFixed(2),
    avg_off_hours_per_day: +(avgOffMins / 60).toFixed(2),
    min_off_hours_per_day: +(min / 60).toFixed(2),
    max_off_hours_per_day: +(max / 60).toFixed(2),
    stddev_off_hours: +(stddev / 60).toFixed(2),
    reliability_percent: +reliabilityPercent.toFixed(2),
    avg_block_minutes: +avgBlockMins.toFixed(1),
    avg_blocks_per_day: +avgBlocksPerDay.toFixed(2),
    longest_blackout_streak_minutes: blackout,
    longest_power_streak_minutes: power,
    min_blackout_duration_minutes: minBlackout,
    min_power_duration_minutes: minPower,
    top_worst_days: topWorst,
    top_best_days: topBest,
    emergency_days_count: emergencyDays,
    emergency_rate_percent: +emergencyRate.toFixed(2),
  };
}

export function computeHeatmap(entries: ScheduleEntry[], queue?: string): HeatmapStat {
  const totals = new Array<number>(24).fill(0);
  const daysCount = entries.length;
  for (const e of entries) {
    const d = computeDailyStat(e, queue);
    for (let h = 0; h < 24; h++) totals[h]! += d.hourly_mask[h]!;
  }
  const hours = totals.map((t) =>
    daysCount > 0 ? +((t / daysCount) * 100).toFixed(2) : 0
  );
  let worstH = 0;
  let bestH = 0;
  for (let i = 1; i < 24; i++) {
    if (hours[i]! > hours[worstH]!) worstH = i;
    if (hours[i]! < hours[bestH]!) bestH = i;
  }
  return { hours, worst_hour: worstH, best_hour: bestH, days_count: daysCount };
}

export function computeWeekday(entries: ScheduleEntry[], queue?: string): WeekdayStat {
  const buckets: Array<{ total: number; count: number }> = Array.from(
    { length: 7 },
    () => ({ total: 0, count: 0 })
  );
  for (const e of entries) {
    const wd = getWeekday(e.schedule_date);
    if (wd < 0 || wd > 6) continue;
    const stat = computeDailyStat(e, queue);
    const bucket = buckets[wd]!;
    bucket.total += stat.off_minutes;
    bucket.count += 1;
  }
  const weekdays = buckets.map((b, i) => ({
    weekday: i,
    name: WEEKDAY_NAMES[i]!,
    avg_off_hours: b.count > 0 ? +(b.total / b.count / 60).toFixed(2) : 0,
    days_count: b.count,
  }));

  let worstWd = -1;
  let bestWd = -1;
  for (let i = 0; i < 7; i++) {
    const w = weekdays[i]!;
    if (w.days_count === 0) continue;
    if (worstWd === -1 || w.avg_off_hours > weekdays[worstWd]!.avg_off_hours) worstWd = i;
    if (bestWd === -1 || w.avg_off_hours < weekdays[bestWd]!.avg_off_hours) bestWd = i;
  }
  return {
    weekdays,
    worst_weekday: worstWd === -1 ? 0 : worstWd,
    best_weekday: bestWd === -1 ? 0 : bestWd,
  };
}

export function computeBuckets(entries: ScheduleEntry[], queue?: string): BucketsStat {
  let mTotal = 0, dTotal = 0, eTotal = 0, nTotal = 0;
  for (const entry of entries) {
    const merged = getMergedIntervals(entry, queue);
    mTotal += overlapWithRange(merged, 6 * 60, 12 * 60);
    dTotal += overlapWithRange(merged, 12 * 60, 18 * 60);
    eTotal += overlapWithRange(merged, 18 * 60, 22 * 60);
    nTotal += overlapWithRange(merged, 22 * 60, 24 * 60) + overlapWithRange(merged, 0, 6 * 60);
  }
  const count = entries.length;
  const toHours = (mins: number) => (count > 0 ? +(mins / count / 60).toFixed(2) : 0);
  return {
    morning: toHours(mTotal),
    day: toHours(dTotal),
    evening: toHours(eTotal),
    night: toHours(nTotal),
    total_days: count,
  };
}

export function computeTimeseries(
  entries: ScheduleEntry[],
  queue?: string
): TimeseriesPoint[] {
  return entries
    .map((e) => computeDailyStat(e, queue))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((d) => ({
      date: d.date,
      off_hours: +(d.off_minutes / 60).toFixed(2),
      blocks_count: d.blocks_count,
      emergency: d.emergency,
    }));
}

export function computeQueuesBreakdown(entries: ScheduleEntry[]): QueueBreakdownItem[] {
  const queues = detectAllQueues(entries);
  return queues.map((q) => {
    let totalMins = 0;
    let count = 0;
    for (const e of entries) {
      const periods = e.schedule[q];
      if (!periods) continue;
      const merged = getMergedIntervals(e, q);
      for (const [s, ed] of merged) totalMins += ed - s;
      count += 1;
    }
    const avgMins = count > 0 ? totalMins / count : 0;
    const reliability =
      count > 0 ? ((MIN_PER_DAY * count - totalMins) / (MIN_PER_DAY * count)) * 100 : 100;
    return {
      queue: q,
      avg_off_hours: +(avgMins / 60).toFixed(2),
      total_off_hours: +(totalMins / 60).toFixed(2),
      reliability_percent: +reliability.toFixed(2),
      days_with_data: count,
    };
  });
}

export function computeTypicalWindow(
  entries: ScheduleEntry[],
  queue?: string
): TypicalWindowStat {
  let firstOffSum = 0, lastOnSum = 0, domStartSum = 0, domEndSum = 0;
  let count = 0;

  for (const entry of entries) {
    const merged = getMergedIntervals(entry, queue);
    if (merged.length === 0) continue;

    firstOffSum += merged[0]![0];
    lastOnSum += merged[merged.length - 1]![1];

    let domStart = merged[0]![0];
    let domEnd = merged[0]![1];
    let domLen = domEnd - domStart;
    for (let i = 1; i < merged.length; i++) {
      const len = merged[i]![1] - merged[i]![0];
      if (len > domLen) {
        domLen = len;
        domStart = merged[i]![0];
        domEnd = merged[i]![1];
      }
    }
    domStartSum += domStart;
    domEndSum += domEnd;
    count += 1;
  }

  return {
    avg_first_off: count > 0 ? minsToTimeStr(firstOffSum / count) : null,
    avg_last_on: count > 0 ? minsToTimeStr(lastOnSum / count) : null,
    avg_dominant_start: count > 0 ? minsToTimeStr(domStartSum / count) : null,
    avg_dominant_end: count > 0 ? minsToTimeStr(domEndSum / count) : null,
    days_with_outage: count,
  };
}

export function computeCoverage(
  entries: ScheduleEntry[],
  from: string,
  to: string
): CoverageStat {
  const expected = generateDateRange(from, to);
  const present = new Set(entries.map((e) => e.schedule_date));
  const missing = expected.filter((d) => !present.has(d));
  const expectedCount = expected.length;
  return {
    expected_days: expectedCount,
    days_with_data: expected.length - missing.length,
    coverage_percent:
      expectedCount > 0
        ? +(((expectedCount - missing.length) / expectedCount) * 100).toFixed(2)
        : 0,
    missing_dates: missing,
  };
}
