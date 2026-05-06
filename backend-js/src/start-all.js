import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { baseDir, loadConfig } from "./config.js";

const config = await loadConfig();
const dbPath = config.mongodb_data_path
  ? path.resolve(baseDir, config.mongodb_data_path)
  : path.join(baseDir, "db");
const port = config.mongodb_port ?? 27017;

fs.mkdirSync(dbPath, { recursive: true });

const mongodBin = config.mongodb_bin || "mongod";
const mongodArgs = ["--dbpath", dbPath, "--bind_ip", "127.0.0.1", "--port", String(port)];
const mongod = spawn(mongodBin, mongodArgs, { stdio: "inherit" });

const app = spawn(process.execPath, ["src/app.js"], {
  cwd: baseDir,
  stdio: "inherit"
});

function shutdown(signal) {
  if (!mongod.killed) {
    mongod.kill(signal);
  }
  if (!app.killed) {
    app.kill(signal);
  }
}

mongod.on("error", (error) => {
  if (error.code === "ENOENT") {
    console.error("MongoDB binary not found. Set mongodb_bin in config.json or add mongod to PATH.");
  } else {
    console.error(`MongoDB failed to start: ${error.message}`);
  }
  if (!app.killed) {
    app.kill();
  }
  process.exit(1);
});

mongod.on("exit", (code) => {
  if (!app.killed) {
    app.kill();
  }
  process.exit(code ?? 0);
});

app.on("exit", (code) => {
  if (!mongod.killed) {
    mongod.kill();
  }
  process.exit(code ?? 0);
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
