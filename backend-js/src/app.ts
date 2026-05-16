import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import cron from "node-cron";
import fsp from "fs/promises";
import path from "path";
import type { Db } from "mongodb";
import { fetchAllChannels } from "./fetcher.js";
import { createRoutes } from "./routes.js";
import { createStatsRoutes } from "./stats/index.js";
import { baseDir, loadConfig } from "./config.js";
import { connectDb, closeDb } from "./db.js";
import type { UpdateStatus, City } from "./types.js";

const app = express();
app.use(express.json());

let lastUpdate: UpdateStatus = {
  timestamp: null,
  status: "pending",
  message: "Чекання першого оновлення...",
};
let updateInProgress = false;

async function updateDataTask(): Promise<void> {
  if (updateInProgress) {
    console.log("Оновлення вже в процесі...");
    return;
  }

  updateInProgress = true;
  try {
    console.log(`[${new Date().toISOString()}] Запуск парсера...`);
    const success = await fetchAllChannels();
    lastUpdate = {
      timestamp: new Date().toISOString(),
      status: success ? "success" : "error",
      message: success ? "Дані оновлено успішно!" : "Помилка оновлення",
    };
    console.log(success ? "✓ Дані оновлено успішно!" : "✗ Помилка оновлення");
  } catch (error) {
    const msg = (error as Error).message;
    lastUpdate = {
      timestamp: new Date().toISOString(),
      status: "error",
      message: `Помилка: ${msg.slice(0, 200)}`,
    };
    console.log(`✗ Помилка: ${msg}`);
  } finally {
    updateInProgress = false;
  }
}

function triggerUpdate(): boolean {
  if (updateInProgress) return false;
  lastUpdate = {
    timestamp: new Date().toISOString(),
    status: "running",
    message: "Оновлення запущено",
  };
  void updateDataTask();
  return true;
}

async function seedCities(db: Db): Promise<void> {
  const citiesCollection = db.collection<City>("cities");
  const count = await citiesCollection.countDocuments();
  if (count > 0) return;

  const citiesPath = path.join(baseDir, "cities.json");
  const raw = await fsp.readFile(citiesPath, "utf-8");
  const data = JSON.parse(raw) as { cities?: City[] };
  if (Array.isArray(data.cities) && data.cities.length > 0) {
    await citiesCollection.insertMany(data.cities);
  }
}

const appConfig = await loadConfig();
const updateIntervalMinutes = appConfig.update_interval_minutes ?? 15;
const cronExpression = `*/${updateIntervalMinutes} * * * *`;

const corsOrigins = appConfig.cors_origins ?? [];
app.use(
  cors({
    origin: corsOrigins.length === 0 ? "*" : corsOrigins,
    methods: ["GET", "POST"],
  })
);

cron.schedule(cronExpression, () => {
  if (!updateInProgress) triggerUpdate();
});
console.log(`Auto-update scheduled every ${updateIntervalMinutes} minutes`);

const db = await connectDb();
await seedCities(db);

console.log("API стартує... Запуск першого оновлення даних...");
triggerUpdate();

app.use(createStatsRoutes(db));

app.use(
  createRoutes({
    baseDir,
    db,
    getStatus: () => ({ lastUpdate, updateInProgress }),
    triggerUpdate,
    updateIntervalMinutes,
  })
);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(`[ERROR] ${err.message}`);
  res.status(500).json({ error: "Internal server error" });
});

const port = process.env["PORT"] ? Number(process.env["PORT"]) : 5000;
app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});

const shutdown = async (): Promise<void> => {
  await closeDb();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
