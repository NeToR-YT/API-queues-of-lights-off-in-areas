import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import type { Config } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const baseDir = path.resolve(__dirname, "..");
export const configPath = path.join(baseDir, "config.json");

// Сесія Telegram — секрет, тож живе поза config.json (див. .env.example).
export const sessionPath =
  process.env["TG_SESSION_FILE"] ?? path.join(baseDir, "secrets", "session.txt");

function readSessionFile(): string {
  try {
    return fs.readFileSync(sessionPath, "utf-8").trim();
  } catch {
    return "";
  }
}

export async function loadConfig(): Promise<Config> {
  if (!fs.existsSync(configPath)) {
    throw new Error("No config.json found in backend-js/ (скопіюйте config.example.json)");
  }
  const raw = await fsp.readFile(configPath, "utf-8");
  const fileConfig = JSON.parse(raw) as Partial<Config>;

  const apiId = process.env["TG_API_ID"];
  return {
    ...fileConfig,
    api_id: apiId ? Number(apiId) : (fileConfig.api_id ?? 0),
    api_hash: process.env["TG_API_HASH"] ?? fileConfig.api_hash ?? "",
    session_string: process.env["TG_SESSION_STRING"] ?? readSessionFile(),
  } as Config;
}

export async function saveSession(session: string): Promise<void> {
  await fsp.mkdir(path.dirname(sessionPath), { recursive: true });
  await fsp.writeFile(sessionPath, session, { encoding: "utf-8", mode: 0o600 });
}
