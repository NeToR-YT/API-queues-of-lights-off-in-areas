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
import type { Channel, ChannelFetchResult, Config, ParseState, ScheduleEntry } from "./types.js";

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
  minId: number
): Promise<ChannelFetchResult> {
  const { id: channelId, name: channelName, username: channelUsername } = channel;
  const EMPTY: ChannelFetchResult = { today: null, tomorrow: null, fallback: null, history: [], maxMessageId: 0 };

  let bestResult: ScheduleEntry | null = null;
  let tomorrowResult: ScheduleEntry | null = null;
  let fallbackResult: ScheduleEntry | null = null;
  const historyByDate = new Map<string, ScheduleEntry>();
  let maxMessageId = 0;
  let messagesChecked = 0;
  let scheduleMessagesFound = 0;

  // First run (no stored state): fetch last 10 messages.
  // Subsequent runs: fetch only new messages since last seen ID.
  const iterOpts = minId === 0 ? { limit: 10 } : { limit: 0 as 0, minId };

  try {
    const entity = await client.getEntity(channelUsername);
    console.log(`Processing channel ${channelId} (${channelName}): ${channelUsername}`);

    for await (const message of client.iterMessages(entity, iterOpts)) {
      const msg = message as Api.Message;
      if (msg.id > maxMessageId) maxMessageId = msg.id;
      messagesChecked += 1;
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
      } else {
        if (!historyByDate.has(scheduleDate)) {
          historyByDate.set(scheduleDate, entry);
          if (!fallbackResult) fallbackResult = entry;
        }
      }
    }

    const history = Array.from(historyByDate.values());

    if (messagesChecked === 0) {
      console.log(`[OK] Channel ${channelId}: No new messages`);
    } else if (bestResult || tomorrowResult || fallbackResult) {
      const foundDates: string[] = [];
      if (bestResult) foundDates.push(`today (${bestResult.schedule_date})`);
      if (tomorrowResult) foundDates.push(`tomorrow (${tomorrowResult.schedule_date})`);
      if (!foundDates.length && fallbackResult) foundDates.push(`fallback (${fallbackResult.schedule_date})`);
      console.log(`[OK] Channel ${channelId}: Found ${foundDates.join(", ")}, history: ${history.length} dates`);
    } else {
      console.log(`[ERR] Channel ${channelId}: Checked ${messagesChecked} msgs, ${scheduleMessagesFound} schedule msgs — no valid schedule`);
    }

    return { today: bestResult, tomorrow: tomorrowResult, fallback: fallbackResult, history, maxMessageId };
  } catch (error) {
    console.log(`[ERR] Error fetching from channel ${channelId}: ${(error as Error).message}`);
    return EMPTY;
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

  const { batch_size: batchSize = 2, batch_delay: batchDelay = 5 } = config.batch_parser ?? {};
  const timezoneOffset = config.timezone_offset ?? 2;
  const channels = config.channels;

  const db = await connectDb();
  const todayCol = db.collection<ScheduleEntry>("schedules_today");
  const tomorrowCol = db.collection<ScheduleEntry>("schedules_tomorrow");
  const historyCol = db.collection<ScheduleEntry>("schedules_history");
  const parseStateCol = db.collection<ParseState>("parse_state");

  // Load last seen message IDs per channel
  const existingStates = await parseStateCol.find({}, { projection: { _id: 0 } }).toArray() as ParseState[];
  const parseState: Record<number, number> = {};
  for (const s of existingStates) parseState[s.channel_id] = s.last_message_id;

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
    let anyNewData = false;
    const newMessageIds: Record<number, number> = {};

    for (let batchIdx = 0; batchIdx < channels.length; batchIdx += batchSize) {
      const batch = channels.slice(batchIdx, batchIdx + batchSize);
      console.log(`\nProcessing batch ${Math.floor(batchIdx / batchSize) + 1}/${Math.ceil(channels.length / batchSize)}`);

      for (const channel of batch) {
        const minId = parseState[channel.id] ?? 0;
        const result = await fetchMessagesForChannel(client, channel, today, tomorrow, timezoneOffset, minId);

        // Track highest message ID seen for this channel
        if (result.maxMessageId > 0) newMessageIds[channel.id] = result.maxMessageId;

        // Skip DB updates if no schedule data in new messages
        if (!result.today && !result.tomorrow && !result.fallback && result.history.length === 0) continue;
        anyNewData = true;

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

        for (const entry of result.history) {
          const hist = allHistory[channel.id] ?? [];
          const exists = hist.some((e) => e.schedule_date === entry.schedule_date);
          if (!exists) hist.push(entry);
          allHistory[channel.id] = hist;
        }
      }

      if (batchIdx + batchSize < channels.length) {
        console.log(`Waiting ${batchDelay} seconds before next batch...`);
        await new Promise((resolve) => setTimeout(resolve, batchDelay * 1000));
      }
    }

    // Save updated last seen message IDs
    const parseStateOps = Object.entries(newMessageIds).map(([id, msgId]) => ({
      updateOne: {
        filter: { channel_id: Number(id) },
        update: { $set: { channel_id: Number(id), last_message_id: msgId } },
        upsert: true,
      },
    }));
    if (parseStateOps.length) await parseStateCol.bulkWrite(parseStateOps);

    // Only rewrite today/tomorrow collections if something actually changed
    if (anyNewData || rotated) {
      await todayCol.deleteMany({});
      if (todayData.length) await todayCol.insertMany(todayData);

      await tomorrowCol.deleteMany({});
      if (tomorrowData.length) await tomorrowCol.insertMany(tomorrowData);
    }

    // History always uses upsert — safe to run regardless
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
    if (anyNewData) {
      console.log(`Updated today: ${todayUpdated}/${channels.length} channels`);
      console.log(`Updated tomorrow: ${tomorrowUpdated}/${channels.length} channels`);
    } else {
      console.log("[OK] No new messages — DB not modified");
    }
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
