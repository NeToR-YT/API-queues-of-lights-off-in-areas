/**
 * Задача 0.6, крок 1: знімає сирі повідомлення каналів у golden-корпус.
 *
 * Мережевий крок — потребує чинної Telegram-сесії. Запускати ПІСЛЯ ротації
 * акаунта (задача 0.1), новим акаунтом.
 *
 *   npm run corpus:export -- --limit 300
 *
 * Пише parser/tests/golden/raw/<id>-<username>.jsonl (по повідомленню на рядок).
 * Нічого не парсить: сирий текст — щоб еталон можна було перерахувати будь-коли.
 */
import fs from "fs/promises";
import path from "path";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { baseDir, loadConfig } from "../config.js";

const RAW_DIR = path.resolve(baseDir, "..", "parser", "tests", "golden", "raw");

function argValue(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const raw = process.argv[i + 1];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

async function main(): Promise<void> {
  const limit = argValue("limit", 300);
  const config = await loadConfig();

  if (!config.session_string) {
    throw new Error(
      "Нема сесії Telegram. Заповніть .env / backend-js/secrets/session.txt (див. .env.example)."
    );
  }

  const client = new TelegramClient(
    new StringSession(config.session_string),
    config.api_id,
    config.api_hash,
    { connectionRetries: 5, autoReconnect: false, useWSS: false }
  );
  await client.connect();

  await fs.mkdir(RAW_DIR, { recursive: true });
  let totalMessages = 0;

  for (const channel of config.channels) {
    const outFile = path.join(RAW_DIR, `${channel.id}-${channel.username}.jsonl`);
    const lines: string[] = [];

    try {
      const entity = await client.getEntity(channel.username);
      for await (const message of client.iterMessages(entity, { limit })) {
        const msg = message as Api.Message;
        if (!msg.message) continue; // картинки без підпису — поза межами парсера
        lines.push(
          JSON.stringify({
            message_id: msg.id,
            date: msg.date,
            text: msg.message,
          })
        );
      }
      await fs.writeFile(outFile, lines.join("\n") + "\n", "utf-8");
      totalMessages += lines.length;
      console.log(`✓ ${channel.id} ${channel.name}: ${lines.length} повідомлень`);
    } catch (err) {
      // Один недоступний канал не має валити весь експорт.
      console.error(`✗ ${channel.id} ${channel.name}: ${String(err)}`);
    }

    // Консервативна пауза: новий акаунт чутливий до flood-банів.
    await new Promise((r) => setTimeout(r, (config.batch_parser?.batch_delay ?? 5) * 1000));
  }

  await client.disconnect();
  console.log(`\nГотово: ${totalMessages} повідомлень у ${RAW_DIR}`);
}

await main();
