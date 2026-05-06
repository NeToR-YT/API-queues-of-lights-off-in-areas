import fsp from "fs/promises";
import path from "path";
import { connectDb, closeDb } from "./db.js";
import { baseDir } from "./config.js";

const sourceDir = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(baseDir, "..", "backend");

async function readJson(filePath, fallback) {
  try {
    const raw = await fsp.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

async function migrate() {
  const db = await connectDb();

  const citiesFile = path.join(sourceDir, "cities.json");
  const todayFile = path.join(sourceDir, "schedule_today.json");
  const tomorrowFile = path.join(sourceDir, "schedule_tomorrow.json");

  const citiesData = await readJson(citiesFile, { cities: [] });
  const todayData = await readJson(todayFile, []);
  const tomorrowData = await readJson(tomorrowFile, []);

  await db.collection("cities").deleteMany({});
  if (Array.isArray(citiesData.cities) && citiesData.cities.length > 0) {
    await db.collection("cities").insertMany(citiesData.cities);
  }

  await db.collection("schedules_today").deleteMany({});
  if (Array.isArray(todayData) && todayData.length > 0) {
    await db.collection("schedules_today").insertMany(todayData);
  }

  await db.collection("schedules_tomorrow").deleteMany({});
  if (Array.isArray(tomorrowData) && tomorrowData.length > 0) {
    await db.collection("schedules_tomorrow").insertMany(tomorrowData);
  }

  const historyFiles = await fsp.readdir(sourceDir);
  const historyOps = [];
  for (const fileName of historyFiles) {
    if (!fileName.startsWith("schedule_history_") || !fileName.endsWith(".json")) {
      continue;
    }
    const historyPath = path.join(sourceDir, fileName);
    const historyData = await readJson(historyPath, []);
    if (!Array.isArray(historyData)) {
      continue;
    }
    for (const entry of historyData) {
      if (!entry.channel_id || !entry.schedule_date) {
        continue;
      }
      historyOps.push({
        updateOne: {
          filter: { channel_id: entry.channel_id, schedule_date: entry.schedule_date },
          update: { $set: entry },
          upsert: true
        }
      });
    }
  }

  if (historyOps.length > 0) {
    await db.collection("schedules_history").bulkWrite(historyOps);
  }

  console.log("Migration complete.");
  console.log(`Source: ${sourceDir}`);
  console.log(`Cities: ${Array.isArray(citiesData.cities) ? citiesData.cities.length : 0}`);
  console.log(`Today: ${Array.isArray(todayData) ? todayData.length : 0}`);
  console.log(`Tomorrow: ${Array.isArray(tomorrowData) ? tomorrowData.length : 0}`);
  console.log(`History upserts: ${historyOps.length}`);
}

migrate()
  .catch((error) => {
    console.error(`Migration failed: ${error.message}`);
    process.exit(1);
  })
  .finally(async () => {
    await closeDb();
  });
