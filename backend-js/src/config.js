import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const baseDir = path.resolve(__dirname, "..");
export const configPath = path.join(baseDir, "config.json");

export async function loadConfig() {
  if (!fs.existsSync(configPath)) {
    throw new Error("No config.json found in backend-js/");
  }
  const raw = await fsp.readFile(configPath, "utf-8");
  return JSON.parse(raw);
}

export async function saveConfig(config) {
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}
