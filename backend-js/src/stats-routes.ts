import express, { Router, Request, Response, NextFunction, RequestHandler } from "express";
import type { Db } from "mongodb";
import type { ScheduleEntry, City } from "./types.js";
import {
  computeBuckets,
  computeCoverage,
  computeHeatmap,
  computeQueuesBreakdown,
  computeSummary,
  computeTimeseries,
  computeWeekday,
  defaultDateRange,
  detectAllQueues,
} from "./stats/index.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();

function cacheKey(req: Request): string {
  return `${req.path}?${new URLSearchParams(req.query as Record<string, string>).toString()}`;
}

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  const value = await fn();
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

export function createStatsRoutes(db: Db): Router {
  const router = express.Router();

  router.get(
    "/api/stats/summary",
    wrap(async (req, res) => {
      const query = req.query as StatsQuery;
      const channelId = parseChannelId(query);
      if (!requireChannel(channelId, res)) return;
      const { from, to } = parsePeriod(query);
      const queue = query.queue;

      const data = await cached(cacheKey(req), async () => {
        const entries = await loadHistoryRange(db, channelId, from, to);
        return computeSummary(entries, from, to, queue);
      });
      res.json({ channel_id: channelId, queue: queue ?? "union", ...data });
    })
  );

  router.get(
    "/api/stats/timeseries",
    wrap(async (req, res) => {
      const query = req.query as StatsQuery;
      const channelId = parseChannelId(query);
      if (!requireChannel(channelId, res)) return;
      const { from, to } = parsePeriod(query);
      const queue = query.queue;

      const data = await cached(cacheKey(req), async () => {
        const entries = await loadHistoryRange(db, channelId, from, to);
        return computeTimeseries(entries, queue);
      });
      res.json({ channel_id: channelId, queue: queue ?? "union", from, to, points: data });
    })
  );

  router.get(
    "/api/stats/heatmap",
    wrap(async (req, res) => {
      const query = req.query as StatsQuery;
      const channelId = parseChannelId(query);
      if (!requireChannel(channelId, res)) return;
      const { from, to } = parsePeriod(query);
      const queue = query.queue;

      const data = await cached(cacheKey(req), async () => {
        const entries = await loadHistoryRange(db, channelId, from, to);
        return computeHeatmap(entries, queue);
      });
      res.json({ channel_id: channelId, queue: queue ?? "union", from, to, ...data });
    })
  );

  router.get(
    "/api/stats/weekday",
    wrap(async (req, res) => {
      const query = req.query as StatsQuery;
      const channelId = parseChannelId(query);
      if (!requireChannel(channelId, res)) return;
      const { from, to } = parsePeriod(query);
      const queue = query.queue;

      const data = await cached(cacheKey(req), async () => {
        const entries = await loadHistoryRange(db, channelId, from, to);
        return computeWeekday(entries, queue);
      });
      res.json({ channel_id: channelId, queue: queue ?? "union", from, to, ...data });
    })
  );

  router.get(
    "/api/stats/buckets",
    wrap(async (req, res) => {
      const query = req.query as StatsQuery;
      const channelId = parseChannelId(query);
      if (!requireChannel(channelId, res)) return;
      const { from, to } = parsePeriod(query);
      const queue = query.queue;

      const data = await cached(cacheKey(req), async () => {
        const entries = await loadHistoryRange(db, channelId, from, to);
        return computeBuckets(entries, queue);
      });
      res.json({ channel_id: channelId, queue: queue ?? "union", from, to, ...data });
    })
  );

  router.get(
    "/api/stats/queues",
    wrap(async (req, res) => {
      const query = req.query as StatsQuery;
      const channelId = parseChannelId(query);
      if (!requireChannel(channelId, res)) return;
      const { from, to } = parsePeriod(query);

      const data = await cached(cacheKey(req), async () => {
        const entries = await loadHistoryRange(db, channelId, from, to);
        return {
          queues: computeQueuesBreakdown(entries),
          available_queues: detectAllQueues(entries),
        };
      });
      res.json({ channel_id: channelId, from, to, ...data });
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
    "/api/stats/coverage",
    wrap(async (req, res) => {
      const query = req.query as StatsQuery;
      const channelId = parseChannelId(query);
      if (!requireChannel(channelId, res)) return;
      const { from, to } = parsePeriod(query);

      const data = await cached(cacheKey(req), async () => {
        const entries = await loadHistoryRange(db, channelId, from, to);
        return computeCoverage(entries, from, to);
      });
      res.json({ channel_id: channelId, from, to, ...data });
    })
  );

  router.get(
    "/api/stats/queues-list",
    wrap(async (req, res) => {
      const query = req.query as StatsQuery;
      const channelId = parseChannelId(query);
      if (!requireChannel(channelId, res)) return;
      const { from, to } = parsePeriod(query);

      const data = await cached(cacheKey(req), async () => {
        const entries = await loadHistoryRange(db, channelId, from, to);
        return { available_queues: detectAllQueues(entries) };
      });
      res.json({ channel_id: channelId, from, to, ...data });
    })
  );

  return router;
}
