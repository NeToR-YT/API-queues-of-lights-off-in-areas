import { MongoClient } from "mongodb";
import { loadConfig } from "./config.js";

let client = null;
let db = null;

export async function connectDb() {
  if (db) {
    return db;
  }

  const config = await loadConfig();
  const uri = config.mongodb_uri || "mongodb://127.0.0.1:27017";
  const dbName = config.mongodb_db || "queues";

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
  await ensureIndexes(db);

  return db;
}

export function getDb() {
  if (!db) {
    throw new Error("MongoDB connection is not initialized");
  }
  return db;
}

export async function closeDb() {
  if (client) {
    await client.close();
  }
  client = null;
  db = null;
}

async function ensureIndexes(database) {
  await database.collection("cities").createIndex({ id: 1 }, { unique: true });
  await database.collection("schedules_today").createIndex({ channel_id: 1 }, { unique: true });
  await database.collection("schedules_tomorrow").createIndex({ channel_id: 1 }, { unique: true });
  await database
    .collection("schedules_history")
    .createIndex({ channel_id: 1, schedule_date: 1 }, { unique: true });
}

export { ensureIndexes };
