import fsp from "fs/promises";
import path from "path";
import { connectDb, closeDb } from "./db.js";
import { baseDir } from "./config.js";
import type { ScheduleEntry, City } from "./types.js";

const sourceDir = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(baseDir, "..", "backend");

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fsp.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function migrate(): Promise<void> {
  const db = await connectDb();

  const citiesData = await readJson<{ cities?: City[] }>(path.join(sourceDir, "cities.json"), {});
  const todayData = await readJson<ScheduleEntry[]>(path.join(sourceDir, "schedule_today.json"), []);
  const tomorrowData = await readJson<ScheduleEntry[]>(path.join(sourceDir, "schedule_tomorrow.json"), []);

  await db.collection("cities").deleteMany({});
  if (Array.isArray(citiesData.cities) && citiesData.cities.length > 0) {
    await db.collection("cities").insertMany(citiesData.cities);
  }

  await db.collection("schedules_today").deleteMany({});
  if (todayData.length > 0) await db.collection("schedules_today").insertMany(todayData);

  await db.collection("schedules_tomorrow").deleteMany({});
  if (tomorrowData.length > 0) await db.collection("schedules_tomorrow").insertMany(tomorrowData);

  const historyFiles = await fsp.readdir(sourceDir);
  const historyOps: Record<string, unknown>[] = [];

  for (const fileName of historyFiles) {
    if (!fileName.startsWith("schedule_history_") || !fileName.endsWith(".json")) continue;
    const historyData = await readJson<ScheduleEntry[]>(path.join(sourceDir, fileName), []);
    for (const entry of historyData) {
      if (!entry.channel_id || !entry.schedule_date) continue;
      historyOps.push({
        updateOne: {
          filter: { channel_id: entry.channel_id, schedule_date: entry.schedule_date },
          update: { $set: entry },
          upsert: true,
        },
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (historyOps.length > 0) await db.collection("schedules_history").bulkWrite(historyOps as any[]);

  console.log("Migration complete.");
  console.log(`Source: ${sourceDir}`);
  console.log(`Cities: ${citiesData.cities?.length ?? 0}`);
  console.log(`Today: ${todayData.length}`);
  console.log(`Tomorrow: ${tomorrowData.length}`);
  console.log(`History upserts: ${historyOps.length}`);
}

migrate()
  .catch((error: Error) => {
    console.error(`Migration failed: ${error.message}`);
    process.exit(1);
  })
  .finally(async () => {
    await closeDb();
  });
