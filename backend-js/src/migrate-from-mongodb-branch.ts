import { execSync } from "child_process";
import { connectDb, closeDb } from "./db.js";
import type { ScheduleEntry, City } from "./types.js";

async function run(): Promise<void> {
  const db = await connectDb();

  // --- 1. Cities ---
  const citiesRaw = execSync("git show origin/mongodb:public/backend/cities.json", { cwd: process.cwd() }).toString();
  const citiesData = JSON.parse(citiesRaw) as { cities: City[] };
  const citiesCol = db.collection<City>("cities");
  await citiesCol.deleteMany({});
  await citiesCol.insertMany(citiesData.cities);
  console.log(`[OK] Міста: вставлено ${citiesData.cities.length} записів`);

  // --- 2. schedules_history ---
  const historyCol = db.collection<ScheduleEntry>("schedules_history");
  let totalInserted = 0;
  let totalSkipped = 0;

  for (let i = 1; i <= 23; i++) {
    let raw: string;
    try {
      raw = execSync(`git show origin/mongodb:public/schedule_history_${i}.json`, { cwd: process.cwd() }).toString();
    } catch {
      console.log(`  [SKIP] schedule_history_${i}.json — не знайдено у гілці`);
      continue;
    }

    const entries: ScheduleEntry[] = JSON.parse(raw);
    if (!entries.length) {
      console.log(`  [SKIP] schedule_history_${i}.json — порожній`);
      continue;
    }

    const ops = entries.map((entry) => ({
      updateOne: {
        filter: { channel_id: entry.channel_id, schedule_date: entry.schedule_date },
        update: { $set: entry },
        upsert: true,
      },
    }));

    const result = await historyCol.bulkWrite(ops);
    const inserted = result.upsertedCount + result.modifiedCount;
    totalInserted += inserted;
    totalSkipped += entries.length - inserted;
    console.log(`  channel ${i}: ${entries.length} записів → вставлено/оновлено ${inserted}`);
  }

  console.log(`\n[DONE] Всього вставлено/оновлено: ${totalInserted}, пропущено (вже є): ${totalSkipped}`);
}

run()
  .catch((e) => { console.error("[ERR]", e.message); process.exit(1); })
  .finally(() => closeDb());
