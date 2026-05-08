import express, { Router, Request, Response, NextFunction, RequestHandler } from "express";
import path from "path";
import type { Db } from "mongodb";
import type { UpdateStatus, ScheduleEntry, City } from "./types.js";

interface RouteOptions {
  baseDir: string;
  db: Db;
  getStatus: () => { lastUpdate: UpdateStatus; updateInProgress: boolean };
  triggerUpdate: () => boolean;
  updateIntervalMinutes: number;
}

interface ScheduleQuery {
  channel_id?: string;
  city_id?: string;
  date?: string;
  queue?: string;
}

function formatDate(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler =>
  (req, res, next) =>
    fn(req, res, next).catch(next);

async function getCityName(db: Db, channelId: number): Promise<string> {
  const found = await db
    .collection<City>("cities")
    .findOne({ id: channelId }, { projection: { _id: 0 } });
  return found?.name ?? "Невідоме місто";
}

function parseChannelId(query: ScheduleQuery): number {
  return Number(query.channel_id ?? query.city_id ?? 0);
}

function filterSchedule(
  scheduleData: Record<string, string[]>,
  queue: string | undefined
): Record<string, string[]> | null {
  if (!queue) return scheduleData;
  const periods = scheduleData[queue];
  if (!periods) return null;
  return { [queue]: periods };
}

export function createRoutes(options: RouteOptions): Router {
  const { baseDir, db, getStatus, triggerUpdate, updateIntervalMinutes } = options;
  const router = express.Router();

  router.get("/", (_req, res) => {
    res.sendFile(path.join(baseDir, "templates", "index.html"));
  });

  router.get(
    "/api/cities",
    wrap(async (_req, res) => {
      const cities = await db
        .collection<City>("cities")
        .find({}, { projection: { _id: 0 } })
        .sort({ id: 1 })
        .toArray();
      res.json({ cities });
    })
  );

  router.get("/api/status", (_req, res) => {
    const status = getStatus();
    res.json({
      last_update: status.lastUpdate,
      parsing_in_progress: status.updateInProgress,
      auto_update_interval_minutes: updateIntervalMinutes,
    });
  });

  router.post("/api/update", (req, res) => {
    const status = getStatus();
    if (status.updateInProgress) {
      return res.status(202).json({ status: "in_progress", message: "Оновлення вже в процесі..." });
    }
    triggerUpdate();
    return res.status(202).json({
      status: "started",
      message: "Оновлення запущено",
      last_update: getStatus().lastUpdate,
    });
  });

  router.get(
    "/api/schedules",
    wrap(async (req: Request<{}, {}, {}, ScheduleQuery>, res) => {
      const channelId = parseChannelId(req.query);
      const { date, queue } = req.query;

      if (!channelId || !date) {
        res.status(400).json({ error: "channel_id та date параметри обов'язкові" });
        return;
      }

      const found = await db
        .collection<ScheduleEntry>("schedules_history")
        .findOne({ channel_id: channelId, schedule_date: date }, { projection: { _id: 0 } });

      if (!found) {
        res.status(404).json({ error: `Розклад на ${date} не знайдено` });
        return;
      }

      const filtered = filterSchedule(found.schedule, queue);
      if (!filtered) {
        res.status(404).json({ error: `Черга ${queue} не знайдена` });
        return;
      }

      const cityName = await getCityName(db, channelId);
      res.json({
        channel_id: channelId,
        city_name: cityName,
        date,
        time: found.schedule_time ?? "",
        schedule: filtered,
        emergency_outages: found.emergency_outages ?? false,
      });
    })
  );

  router.get(
    "/api/schedules/today",
    wrap(async (req: Request<{}, {}, {}, ScheduleQuery>, res) => {
      const channelId = parseChannelId(req.query);
      const { queue } = req.query;

      if (!channelId) {
        res.status(400).json({ error: "channel_id параметр обов'язковий" });
        return;
      }

      const item = await db
        .collection<ScheduleEntry>("schedules_today")
        .findOne({ channel_id: channelId }, { projection: { _id: 0 } });

      if (!item) {
        res.status(404).json({ error: "Розклад на сьогодні не знайдено" });
        return;
      }

      const filtered = filterSchedule(item.schedule, queue);
      if (!filtered) {
        res.status(404).json({ error: `Черга ${queue} не знайдена` });
        return;
      }

      const cityName = await getCityName(db, channelId);
      res.json({
        channel_id: channelId,
        city_name: cityName,
        date: item.schedule_date || formatDate(new Date()),
        time: item.schedule_time ?? "",
        schedule: filtered,
        emergency_outages: item.emergency_outages ?? false,
      });
    })
  );

  router.get(
    "/api/schedules/tomorrow",
    wrap(async (req: Request<{}, {}, {}, ScheduleQuery>, res) => {
      const channelId = parseChannelId(req.query);
      const { queue } = req.query;

      if (!channelId) {
        res.status(400).json({ error: "channel_id параметр обов'язковий" });
        return;
      }

      const item = await db
        .collection<ScheduleEntry>("schedules_tomorrow")
        .findOne({ channel_id: channelId }, { projection: { _id: 0 } });

      if (!item) {
        res.status(404).json({ error: "Розклад на завтра не знайдено" });
        return;
      }

      const filtered = filterSchedule(item.schedule, queue);
      if (!filtered) {
        res.status(404).json({ error: `Черга ${queue} не знайдена` });
        return;
      }

      const cityName = await getCityName(db, channelId);
      res.json({
        channel_id: channelId,
        city_name: cityName,
        date: item.schedule_date || formatDate(new Date(Date.now() + 86_400_000)),
        time: item.schedule_time ?? "",
        schedule: filtered,
        emergency_outages: item.emergency_outages ?? false,
      });
    })
  );

  return router;
}
