/**
 * Задача 0.6, крок 2: рахує еталонні результати старого парсера по корпусу.
 *
 *   npm run corpus:expected
 *
 * Читає parser/tests/golden/raw/*.jsonl, проганяє кожне повідомлення через
 * чисті функції backend-js/src/parser.ts і пише parser/tests/golden/expected/*.json.
 *
 * Мережі не потребує — можна перезапускати скільки завгодно. Саме ці файли
 * Python-домен має відтворити в задачі 1.3; свідомі розбіжності (там, де старий
 * парсер помилявся) фіксуються окремо, а не мовчки.
 */
import fs from "fs/promises";
import path from "path";
import { baseDir, loadConfig } from "../config.js";
import {
  hasQueueSchedule,
  isEmergencyOutageActive,
  isPowerOutageSchedule,
  parseDate,
  parseSchedule,
} from "../parser.js";

const GOLDEN = path.resolve(baseDir, "..", "parser", "tests", "golden");
const RAW_DIR = path.join(GOLDEN, "raw");
const EXPECTED_DIR = path.join(GOLDEN, "expected");

interface RawMessage {
  message_id: number;
  date: number;
  text: string;
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const timezoneOffset = config.timezone_offset ?? 3;

  let files: string[];
  try {
    files = (await fs.readdir(RAW_DIR)).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    throw new Error(`Нема корпусу в ${RAW_DIR}. Спершу: npm run corpus:export`);
  }
  if (files.length === 0) {
    throw new Error(`Корпус порожній: ${RAW_DIR}. Спершу: npm run corpus:export`);
  }

  await fs.mkdir(EXPECTED_DIR, { recursive: true });
  let totalCases = 0;
  let totalSchedules = 0;

  for (const file of files) {
    const raw = await fs.readFile(path.join(RAW_DIR, file), "utf-8");
    const messages: RawMessage[] = raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as RawMessage);

    const cases = messages.map((msg) => {
      const isSchedule = isPowerOutageSchedule(msg.text);
      const schedule = isSchedule ? parseSchedule(msg.text) : {};
      if (Object.keys(schedule).length > 0) totalSchedules += 1;
      return {
        message_id: msg.message_id,
        // Класифікація і розбір — окремими полями, щоб при розбіжності було
        // видно, який саме крок розійшовся, а не просто «результат інший».
        is_power_outage_schedule: isSchedule,
        has_queue_schedule: hasQueueSchedule(msg.text),
        emergency_outages: isEmergencyOutageActive(msg.text),
        schedule_date: parseDate(msg.text, timezoneOffset),
        schedule,
      };
    });

    const outFile = path.join(EXPECTED_DIR, file.replace(/\.jsonl$/, ".json"));
    await fs.writeFile(
      outFile,
      JSON.stringify({ source: file, timezone_offset: timezoneOffset, cases }, null, 2) + "\n",
      "utf-8"
    );
    totalCases += cases.length;
    console.log(`✓ ${file}: ${cases.length} кейсів`);
  }

  console.log(`\nГотово: ${totalCases} кейсів, з них ${totalSchedules} з розкладом.`);
  console.log(`Еталон: ${EXPECTED_DIR}`);
}

await main();
