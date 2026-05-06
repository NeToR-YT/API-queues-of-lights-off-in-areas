import express from "express";
import cron from "node-cron";
import { fetchAllChannels } from "./fetcher.js";
import { createRoutes } from "./routes.js";
import { baseDir, loadConfig } from "./config.js";
import { connectDb, closeDb } from "./db.js";
import fsp from "fs/promises";
import path from "path";

const app = express();
app.use(express.json());

let lastUpdate = {
  timestamp: null,
  status: "pending",
  message: "Чекання першого оновлення..."
};
let updateInProgress = false;

async function updateDataTask() {
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
      message: success ? "Дані оновлено успішно!" : "Помилка оновлення"
    };
    if (success) {
      console.log("✓ Дані оновлено успішно!");
    } else {
      console.log("✗ Помилка оновлення");
    }
  } catch (error) {
    lastUpdate = {
      timestamp: new Date().toISOString(),
      status: "error",
      message: `Помилка: ${error.message.slice(0, 200)}`
    };
    console.log(`✗ Помилка: ${error.message}`);
  } finally {
    updateInProgress = false;
  }
}

function triggerUpdate() {
  if (updateInProgress) {
    return false;
  }
  lastUpdate = {
    timestamp: new Date().toISOString(),
    status: "running",
    message: "Оновлення запущено"
  };
  void updateDataTask();
  return true;
}

const appConfig = await loadConfig();
const updateIntervalMinutes = appConfig.update_interval_minutes ?? 15;
const cronExpression = `*/${updateIntervalMinutes} * * * *`;
cron.schedule(cronExpression, () => {
  if (!updateInProgress) {
    triggerUpdate();
  }
});
console.log(`Auto-update scheduled every ${updateIntervalMinutes} minutes`);

async function seedCities(db) {
  const citiesCollection = db.collection("cities");
  const count = await citiesCollection.countDocuments();
  if (count > 0) {
    return;
  }
  const citiesPath = path.join(baseDir, "cities.json");
  const raw = await fsp.readFile(citiesPath, "utf-8");
  const data = JSON.parse(raw);
  if (Array.isArray(data.cities) && data.cities.length > 0) {
    await citiesCollection.insertMany(data.cities);
  }
}

const db = await connectDb();
await seedCities(db);

console.log("API стартує... Запуск першого оновлення даних...");
triggerUpdate();

app.use(
  createRoutes({
    baseDir,
    db,
    getStatus: () => ({ lastUpdate, updateInProgress }),
    triggerUpdate,
    updateIntervalMinutes
  })
);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${err.message}`);
  res.status(500).json({ error: "Internal server error" });
});

const port = process.env.PORT ? Number(process.env.PORT) : 5000;
app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});

const shutdown = async () => {
  await closeDb();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
