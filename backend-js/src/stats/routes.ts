import express, { Router, Request, Response, NextFunction, RequestHandler } from "express";
import type { Db } from "mongodb";
import type { ScheduleEntry, City } from "../types.js";
import {
  computeBuckets,
  computeCoverage,
  computeHeatmap,
  computeQueuesBreakdown,
  computeSummary,
  computeTimeseries,
  computeTypicalWindow,
  computeWeekday,
} from "./computations.js";
import { defaultDateRange, detectAllQueues } from "./utils.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();

function cacheKey(req: Request): string {
  return `${req.path}?${new URLSearchParams(req.query as Record<string, string>).toString()}`;
}

function cached<T>(key: string, fn: () => T): T {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  const value = fn();
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler =>
  (req, res, next) =>
    fn(req, res, next).catch(next);

interface StatsQuery {
  channel_id?: string;
  city_id?: string;
  queue?: string;
  from?: string;
  to?: string;
  date?: string;
  [key: string]: string | undefined;
}

function parsePeriod(query: StatsQuery): { from: string; to: string } {
  const def = defaultDateRange();
  return { from: query.from ?? def.from, to: query.to ?? def.to };
}

function parseChannelId(query: StatsQuery): number {
  return Number(query.channel_id ?? query.city_id ?? 0);
}

async function loadHistoryRange(
  db: Db,
  channelId: number,
  from: string,
  to: string
): Promise<ScheduleEntry[]> {
  const historyDocs = await db
    .collection<ScheduleEntry>("schedules_history")
    .find(
      { channel_id: channelId, schedule_date: { $gte: from, $lte: to } },
      { projection: { _id: 0 } }
    )
    .toArray();

  const todayDoc = await db
    .collection<ScheduleEntry>("schedules_today")
    .findOne({ channel_id: channelId }, { projection: { _id: 0 } });

  if (
    todayDoc &&
    todayDoc.schedule_date >= from &&
    todayDoc.schedule_date <= to &&
    !historyDocs.some((h) => h.schedule_date === todayDoc.schedule_date)
  ) {
    historyDocs.push(todayDoc);
  }

  historyDocs.sort((a, b) => (a.schedule_date < b.schedule_date ? -1 : 1));
  return historyDocs;
}

function requireChannel(channelId: number, res: Response): boolean {
  if (!channelId) {
    res.status(400).json({ error: "channel_id параметр обов'язковий" });
    return false;
  }
  return true;
}

function requireData(entries: ScheduleEntry[], from: string, to: string, res: Response): boolean {
  if (entries.length === 0) {
    res.status(404).json({
      error:
        from === to
          ? `Дані за ${from} відсутні`
          : `Дані за вказаний період (${from} — ${to}) відсутні`,
    });
    return false;
  }
  return true;
}

type StatsHandler = (entries: ScheduleEntry[], query: StatsQuery, from: string, to: string) => unknown;

function statsRoute(db: Db, handler: StatsHandler): RequestHandler {
  return wrap(async (req, res) => {
    const query = req.query as StatsQuery;
    const channelId = parseChannelId(query);
    if (!requireChannel(channelId, res)) return;
    const { from, to } = parsePeriod(query);

    const entries = await loadHistoryRange(db, channelId, from, to);
    if (!requireData(entries, from, to, res)) return;
    const data = cached(cacheKey(req), () => handler(entries, query, from, to));
    res.json({
      channel_id: channelId,
      queue: query.queue ?? "union",
      from,
      to,
      ...(data as object),
    });
  });
}

export function createStatsRoutes(db: Db): Router {
  const router = express.Router();

  router.get(
    "/api/stats/summary",
    statsRoute(db, (entries, q, from, to) => computeSummary(entries, from, to, q.queue))
  );

  router.get(
    "/api/stats/timeseries",
    statsRoute(db, (entries, q) => ({ points: computeTimeseries(entries, q.queue) }))
  );

  router.get(
    "/api/stats/heatmap",
    statsRoute(db, (entries, q) => ({
      ...computeHeatmap(entries, q.queue),
      typical_window: computeTypicalWindow(entries, q.queue),
    }))
  );

  router.get(
    "/api/stats/weekday",
    statsRoute(db, (entries, q) => computeWeekday(entries, q.queue))
  );

  router.get(
    "/api/stats/buckets",
    statsRoute(db, (entries, q) => computeBuckets(entries, q.queue))
  );

  router.get(
    "/api/stats/queues",
    statsRoute(db, (entries) => ({
      queues: computeQueuesBreakdown(entries),
      available_queues: detectAllQueues(entries),
    }))
  );

  router.get(
    "/api/stats/coverage",
    statsRoute(db, (entries, _q, from, to) => computeCoverage(entries, from, to))
  );

  router.get(
    "/api/stats/queues-list",
    wrap(async (req, res) => {
      const query = req.query as StatsQuery;
      const channelId = parseChannelId(query);
      if (!requireChannel(channelId, res)) return;
      const { from, to } = parsePeriod(query);
      const entries = await loadHistoryRange(db, channelId, from, to);
      res.json({ channel_id: channelId, from, to, available_queues: detectAllQueues(entries) });
    })
  );

  router.get(
    "/api/stats/cities",
    wrap(async (req, res) => {
      const query = req.query as StatsQuery;
      const { from, to } = parsePeriod(query);

      const data = await cached(cacheKey(req), async () => {
        const cities = await db
          .collection<City>("cities")
          .find({}, { projection: { _id: 0 } })
          .sort({ id: 1 })
          .toArray();

        const results = await Promise.all(
          cities.map(async (city) => {
            const entries = await loadHistoryRange(db, city.id, from, to);
            const summary = computeSummary(entries, from, to);
            return {
              channel_id: city.id,
              city_name: city.name,
              avg_off_hours_per_day: summary.avg_off_hours_per_day,
              total_off_hours: summary.total_off_hours,
              reliability_percent: summary.reliability_percent,
              emergency_days_count: summary.emergency_days_count,
              days_with_data: summary.period.days_with_data,
            };
          })
        );

        results.sort((a, b) => b.reliability_percent - a.reliability_percent);
        return { cities: results };
      });
      res.json({ from, to, ...data });
    })
  );

  router.get(
    "/api/stats/day",
    wrap(async (req, res) => {
      const query = req.query as StatsQuery;
      const channelId = parseChannelId(query);
      if (!requireChannel(channelId, res)) return;
      const date = query.date;
      if (!date) {
        res.status(400).json({ error: "date параметр обов'язковий (YYYY-MM-DD)" });
        return;
      }
      const queue = query.queue;

      const entry = await db
        .collection<ScheduleEntry>("schedules_history")
        .findOne({ channel_id: channelId, schedule_date: date }, { projection: { _id: 0 } });

      const todayEntry = await db
        .collection<ScheduleEntry>("schedules_today")
        .findOne({ channel_id: channelId, schedule_date: date }, { projection: { _id: 0 } });

      const found = entry ?? todayEntry;
      if (!found) {
        res.status(404).json({ error: `Даних за ${date} не знайдено` });
        return;
      }

      const schedule = queue
        ? (found.schedule[queue] ? { [queue]: found.schedule[queue] } : {})
        : found.schedule;

      const queues = Object.entries(schedule).map(([q, periods]) => {
        let totalMins = 0;
        for (const p of periods) {
          const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(p);
          if (!m) continue;
          const start = +m[1]! * 60 + +m[2]!;
          let end = +m[3]! * 60 + +m[4]!;
          if (end === 0) end = 1440;
          if (end <= start) end += 1440;
          totalMins += Math.min(end, 1440) - start;
        }
        return { queue: q, periods, off_hours: +(totalMins / 60).toFixed(2) };
      });

      res.json({
        channel_id: channelId,
        date,
        schedule_time: found.schedule_time,
        emergency_outages: found.emergency_outages,
        queues,
      });
    })
  );

  return router;
}
