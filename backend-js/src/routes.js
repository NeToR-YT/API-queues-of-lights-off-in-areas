import express from "express";
import path from "path";

function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

async function getCityName(db, channelId) {
  const found = await db.collection("cities").findOne({ id: channelId }, { projection: { _id: 0 } });
  return found ? found.name : "Невідоме місто";
}

export function createRoutes({ baseDir, db, getStatus, triggerUpdate, updateIntervalMinutes }) {
  const router = express.Router();

  router.get("/", (req, res) => {
    res.sendFile(path.join(baseDir, "templates", "index.html"));
  });

  router.get("/api/cities", wrap(async (req, res) => {
    const cities = await db.collection("cities").find({}, { projection: { _id: 0 } }).sort({ id: 1 }).toArray();
    res.json({ cities });
  }));

  router.get("/api/status", (req, res) => {
    const status = getStatus();
    res.json({
      last_update: status.lastUpdate,
      parsing_in_progress: status.updateInProgress,
      auto_update_interval_minutes: updateIntervalMinutes
    });
  });

  router.post("/api/update", (req, res) => {
    const status = getStatus();
    if (status.updateInProgress) {
      return res.status(202).json({
        status: "in_progress",
        message: "Оновлення вже в процесі..."
      });
    }

    triggerUpdate();
    return res.status(202).json({
      status: "started",
      message: "Оновлення запущено",
      last_update: getStatus().lastUpdate
    });
  });

  router.get("/api/schedules", wrap(async (req, res) => {
    const channelId = Number(req.query.channel_id ?? req.query.city_id);
    const date = req.query.date;
    const queue = req.query.queue;

    if (!channelId || !date) {
      return res.status(400).json({ error: "channel_id та date параметри обов'язкові" });
    }

    const found = await db
      .collection("schedules_history")
      .findOne({ channel_id: channelId, schedule_date: date }, { projection: { _id: 0 } });

    if (!found) {
      return res.status(404).json({ error: `Розклад на ${date} не знайдено` });
    }

    const scheduleData = found.schedule || {};
    let filteredSchedule = scheduleData;
    if (queue) {
      if (!scheduleData[queue]) {
        return res.status(404).json({ error: `Черга ${queue} не знайдена` });
      }
      filteredSchedule = { [queue]: scheduleData[queue] };
    }

    const cityName = await getCityName(db, channelId);
    return res.json({
      channel_id: channelId,
      city_name: cityName,
      date,
      time: found.schedule_time || "",
      schedule: filteredSchedule,
      emergency_outages: found.emergency_outages || false
    });
  }));

  router.get("/api/schedules/today", wrap(async (req, res) => {
    const channelId = Number(req.query.channel_id ?? req.query.city_id);
    const queue = req.query.queue;

    if (!channelId) {
      return res.status(400).json({ error: "channel_id параметр обов'язковий" });
    }

    const item = await db.collection("schedules_today").findOne({ channel_id: channelId }, { projection: { _id: 0 } });

    if (!item) {
      return res.status(404).json({ error: "Розклад на сьогодні не знайдено" });
    }

    const scheduleData = item.schedule || {};
    let filteredSchedule = scheduleData;
    if (queue) {
      if (!scheduleData[queue]) {
        return res.status(404).json({ error: `Черга ${queue} не знайдена` });
      }
      filteredSchedule = { [queue]: scheduleData[queue] };
    }

    const cityName = await getCityName(db, channelId);
    return res.json({
      channel_id: channelId,
      city_name: cityName,
      date: item.schedule_date || formatDate(new Date()),
      time: item.schedule_time || "",
      schedule: filteredSchedule,
      emergency_outages: item.emergency_outages || false
    });
  }));

  router.get("/api/schedules/tomorrow", wrap(async (req, res) => {
    const channelId = Number(req.query.channel_id ?? req.query.city_id);
    const queue = req.query.queue;

    if (!channelId) {
      return res.status(400).json({ error: "channel_id параметр обов'язковий" });
    }

    const item = await db.collection("schedules_tomorrow").findOne({ channel_id: channelId }, { projection: { _id: 0 } });

    if (!item) {
      return res.status(404).json({ error: "Розклад на завтра не знайдено" });
    }

    const scheduleData = item.schedule || {};
    let filteredSchedule = scheduleData;
    if (queue) {
      if (!scheduleData[queue]) {
        return res.status(404).json({ error: `Черга ${queue} не знайдена` });
      }
      filteredSchedule = { [queue]: scheduleData[queue] };
    }

    const cityName = await getCityName(db, channelId);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return res.json({
      channel_id: channelId,
      city_name: cityName,
      date: item.schedule_date || formatDate(tomorrow),
      time: item.schedule_time || "",
      schedule: filteredSchedule,
      emergency_outages: item.emergency_outages || false
    });
  }));

  return router;
}
