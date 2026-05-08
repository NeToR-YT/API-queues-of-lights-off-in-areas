import readline from "readline";
import { fileURLToPath } from "url";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import type { Api } from "telegram";
import {
  hasQueueSchedule,
  isEmergencyOutageActive,
  isPowerOutageSchedule,
  mergeIntervals,
  nowWithOffset,
  parseDate,
  parseSchedule,
} from "./parser.js";
import { connectDb, closeDb } from "./db.js";
import { loadConfig, saveConfig } from "./config.js";
import type { Channel, ChannelFetchResult, Config, ScheduleEntry } from "./types.js";

function formatDate(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function formatTime(unixSeconds: number, timezoneOffsetHours: number): string {
  const adjusted = new Date(unixSeconds * 1000 + timezoneOffsetHours * 60 * 60 * 1000);
  return [
    String(adjusted.getUTCHours()).padStart(2, "0"),
    String(adjusted.getUTCMinutes()).padStart(2, "0"),
    String(adjusted.getUTCSeconds()).padStart(2, "0"),
  ].join(":");
}

function validateConfig(config: Config): void {
  if (!config.api_id || !config.api_hash || !config.channels?.length) {
    throw new Error("Missing required config values: api_id, api_hash, channels");
  }
}

async function createClient(config: Config): Promise<TelegramClient> {
  const session = new StringSession(config.session_string ?? "");
  const client = new TelegramClient(session, config.api_id, config.api_hash, {
    connectionRetries: 5,
    autoReconnect: false,
    useWSS: false,
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

  try {
    await client.start({
      phoneNumber: () => ask("Phone number: "),
      phoneCode: () => ask("Code: "),
      password: () => ask("Password (if enabled): "),
      onError: (err) => { console.error(err); },
    });
  } finally {
    rl.close();
  }

  const saved = client.session.save() as unknown as string;
  if (saved && saved !== config.session_string) {
    config.session_string = saved;
    await saveConfig(config);
  }

  return client;
}

function rotateSchedules(
  todayData: ScheduleEntry[],
  tomorrowData: ScheduleEntry[],
  allHistory: Record<number, ScheduleEntry[]>,
  channels: Channel[],
  timezoneOffset: number
): [ScheduleEntry[], ScheduleEntry[]] {
  const todayDate = formatDate(nowWithOffset(timezoneOffset));

  for (const channel of channels) {
    const channelId = channel.id;
    const todayItem = todayData.find((item) => item.channel_id === channelId);
    if (!todayItem) continue;

    const scheduleDate = todayItem.schedule_date || todayDate;
    const historyList = allHistory[channelId] ?? [];
    const exists = historyList.some(
      (e) => e.schedule_date === scheduleDate && e.channel_id === channelId
    );
    if (!exists) {
      historyList.push({
        channel_id: channelId,
        schedule_date: scheduleDate,
        schedule_time: todayItem.schedule_time ?? "",
        schedule: todayItem.schedule ?? {},
        emergency_outages: todayItem.emergency_outages ?? false,
      });
    }
    allHistory[channelId] = historyList;
  }

  for (const item of tomorrowData) {
    item.schedule_date = todayDate;
  }

  return [tomorrowData, []];
}

async function fetchMessagesForChannel(
  client: TelegramClient,
  channel: Channel,
  today: string,
  tomorrow: string,
  timezoneOffset: number,
  limitMessages: number
): Promise<ChannelFetchResult | null> {
  const { id: channelId, name: channelName, username: channelUsername } = channel;

  let bestResult: ScheduleEntry | null = null;
  let tomorrowResult: ScheduleEntry | null = null;
  let fallbackResult: ScheduleEntry | null = null;
  const allFoundDates: string[] = [];
  let messagesChecked = 0;
  let scheduleMessagesFound = 0;

  try {
    const entity = await client.getEntity(channelUsername);
    console.log(`Processing channel ${channelId} (${channelName}): ${channelUsername}`);

    for await (const message of client.iterMessages(entity, { limit: limitMessages })) {
      messagesChecked += 1;
      const msg = message as Api.Message;
      const msgText = msg.message ?? "";
      if (!isPowerOutageSchedule(msgText) && !hasQueueSchedule(msgText)) continue;

      scheduleMessagesFound += 1;
      const scheduleDate = parseDate(msgText, timezoneOffset);
      if (!scheduleDate) {
        console.log(`[DBG] Channel ${channelId}: no date found in: ${msgText.slice(0, 120).replace(/\n/g, " ")}`);
        continue;
      }

      const parsed = parseSchedule(msgText);
      if (Object.keys(parsed).length === 0) {
        console.log(`[DBG] Channel ${channelId}: date=${scheduleDate} but schedule empty`);
        continue;
      }

      const updateTime = formatTime(msg.date, timezoneOffset);
      const emergencyFlag = isEmergencyOutageActive(msgText);
      allFoundDates.push(scheduleDate);

      const entry: ScheduleEntry = {
        channel_id: channelId,
        schedule_date: scheduleDate,
        schedule_time: updateTime,
        schedule: parsed,
        emergency_outages: emergencyFlag,
      };

      if (scheduleDate === today && !bestResult) {
        bestResult = entry;
      } else if (scheduleDate === tomorrow && !tomorrowResult) {
        tomorrowResult = entry;
        if (bestResult) break;
      } else if (!fallbackResult) {
        fallbackResult = entry;
      }
    }

    if (bestResult || tomorrowResult || fallbackResult) {
      const foundDates: string[] = [];
      if (bestResult) foundDates.push(`today (${bestResult.schedule_date})`);
      if (tomorrowResult) foundDates.push(`tomorrow (${tomorrowResult.schedule_date})`);
      if (!foundDates.length && fallbackResult) foundDates.push(`fallback (${fallbackResult.schedule_date})`);
      if (foundDates.length) console.log(`[OK] Channel ${channelId}: Found ${foundDates.join(", ")}`);

      return { today: bestResult, tomorrow: tomorrowResult, fallback: fallbackResult };
    }

    const datesInfo = allFoundDates.length
      ? `, found dates: ${[...new Set(allFoundDates)]}`
      : "";
    console.log(
      `[ERR] Channel ${channelId}: Checked ${messagesChecked} messages, found ${scheduleMessagesFound} schedule messages${datesInfo}`
    );
    return null;
  } catch (error) {
    console.log(`[ERR] Error fetching from channel ${channelId}: ${(error as Error).message}`);
    return null;
  }
}

function mergeIntoExisting(existing: ScheduleEntry, incoming: ScheduleEntry): void {
  for (const [queue, newPeriods] of Object.entries(incoming.schedule)) {
    const oldPeriods = existing.schedule[queue] ?? [];
    existing.schedule[queue] = mergeIntervals([...oldPeriods, ...newPeriods]);
  }
  existing.schedule_time = incoming.schedule_time;
  existing.schedule_date = incoming.schedule_date;
  existing.emergency_outages = incoming.emergency_outages || existing.emergency_outages;
}

export async function fetchAllChannels(): Promise<boolean> {
  const config = await loadConfig();
  validateConfig(config);

  const { batch_size: batchSize = 2, batch_delay: batchDelay = 5, limit_messages: limitMessages = 200 } =
    config.batch_parser ?? {};
  const timezoneOffset = config.timezone_offset ?? 2;
  const channels = config.channels;

  const db = await connectDb();
  const todayCol = db.collection<ScheduleEntry>("schedules_today");
  const tomorrowCol = db.collection<ScheduleEntry>("schedules_tomorrow");
  const historyCol = db.collection<ScheduleEntry>("schedules_history");

  let client: TelegramClient | undefined;
  try {
    client = await createClient(config);

    const today = formatDate(nowWithOffset(timezoneOffset));
    const tomorrow = formatDate(new Date(nowWithOffset(timezoneOffset).getTime() + 86_400_000));

    let todayData = await todayCol.find({}, { projection: { _id: 0 } }).toArray() as ScheduleEntry[];
    let tomorrowData = await tomorrowCol.find({}, { projection: { _id: 0 } }).toArray() as ScheduleEntry[];

    const allHistory: Record<number, ScheduleEntry[]> = {};
    for (const channel of channels) {
      allHistory[channel.id] = await historyCol
        .find({ channel_id: channel.id }, { projection: { _id: 0 } })
        .toArray() as ScheduleEntry[];
    }

    let rotated = false;
    if (todayData.length > 0 && todayData[0]!.schedule_date !== today) {
      console.log("[ROTATE] Rotating schedules (crossed midnight)...");
      [todayData, tomorrowData] = rotateSchedules(todayData, tomorrowData, allHistory, channels, timezoneOffset);
      rotated = true;
    }

    let todayUpdated = 0;
    let tomorrowUpdated = 0;

    for (let batchIdx = 0; batchIdx < channels.length; batchIdx += batchSize) {
      const batch = channels.slice(batchIdx, batchIdx + batchSize);
      console.log(
        `\nProcessing batch ${Math.floor(batchIdx / batchSize) + 1}/${Math.ceil(channels.length / batchSize)}`
      );
      console.log(`Parsing up to ${limitMessages} messages per channel`);

      for (const channel of batch) {
        const result = await fetchMessagesForChannel(
          client, channel, today, tomorrow, timezoneOffset, limitMessages
        );
        if (!result) continue;

        if (result.today) {
          const idx = todayData.findIndex((d) => d.channel_id === channel.id);
          if (idx !== -1) {
            mergeIntoExisting(todayData[idx]!, result.today);
          } else {
            todayData.push(result.today);
          }
          todayUpdated++;
        }

        if (result.tomorrow) {
          const idx = tomorrowData.findIndex((d) => d.channel_id === channel.id);
          if (idx !== -1) {
            mergeIntoExisting(tomorrowData[idx]!, result.tomorrow);
          } else {
            tomorrowData.push(result.tomorrow);
          }
          tomorrowUpdated++;
        }

        if (result.fallback && !result.today) {
          const idx = todayData.findIndex((d) => d.channel_id === channel.id);
          if (idx === -1) {
            todayData.push(result.fallback);
            todayUpdated++;
          }
        }
      }

      if (batchIdx + batchSize < channels.length) {
        console.log(`Waiting ${batchDelay} seconds before next batch...`);
        await new Promise((resolve) => setTimeout(resolve, batchDelay * 1000));
      }
    }

    await todayCol.deleteMany({});
    if (todayData.length) await todayCol.insertMany(todayData);

    await tomorrowCol.deleteMany({});
    if (tomorrowData.length) await tomorrowCol.insertMany(tomorrowData);

    const historyOps = channels.flatMap((channel) => {
      const history = allHistory[channel.id] ?? [];
      history.sort((a, b) => (a.schedule_date < b.schedule_date ? 1 : -1));
      return history.map((entry) => ({
        updateOne: {
          filter: { channel_id: channel.id, schedule_date: entry.schedule_date },
          update: { $set: entry },
          upsert: true,
        },
      }));
    });

    if (historyOps.length) await historyCol.bulkWrite(historyOps);

    console.log("\n============================================================");
    console.log("Parsing complete!");
    if (rotated) console.log("[OK] Schedules rotated to new day");
    console.log(`Updated today schedules: ${todayUpdated}/${channels.length} channels`);
    console.log(`Updated tomorrow schedules: ${tomorrowUpdated}/${channels.length} channels`);
    console.log("Saved to MongoDB collections: schedules_today, schedules_tomorrow, schedules_history");
    console.log("============================================================");
    return true;
  } catch (error) {
    console.log(`Error: ${(error as Error).message}`);
    return false;
  } finally {
    if (client) {
      try { (client as unknown as { _log?: { setLevel(l: string): void } })._log?.setLevel("none"); } catch (_) {}
      await client.disconnect();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fetchAllChannels()
    .catch((error: Error) => {
      console.log(`Fatal error: ${error.message}`);
      process.exit(1);
    })
    .finally(async () => {
      await closeDb();
    });
}
