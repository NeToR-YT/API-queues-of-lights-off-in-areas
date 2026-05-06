import readline from "readline";
import { fileURLToPath } from "url";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import {
  hasQueueSchedule,
  isEmergencyOutageActive,
  isPowerOutageSchedule,
  mergeIntervals,
  nowWithOffset,
  parseDate,
  parseSchedule
} from "./parser.js";
import { connectDb, closeDb } from "./db.js";
import { loadConfig, saveConfig } from "./config.js";

function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTime(date, timezoneOffsetHours) {
  // GramJS message.date is Unix seconds (number), not a Date object
  const ms = typeof date === "number" ? date * 1000 : date.getTime();
  const adjusted = new Date(ms + timezoneOffsetHours * 60 * 60 * 1000);
  const hours = String(adjusted.getUTCHours()).padStart(2, "0");
  const minutes = String(adjusted.getUTCMinutes()).padStart(2, "0");
  const seconds = String(adjusted.getUTCSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function validateConfig(config) {
  const apiId = config.api_id;
  const apiHash = config.api_hash;
  const channels = Array.isArray(config.channels) ? config.channels : [];
  if (!apiId || !apiHash || channels.length === 0) {
    throw new Error("Missing required config values: api_id, api_hash, channels");
  }
}

async function createClient(config) {
  const sessionString = config.session_string || "";
  const session = new StringSession(sessionString);
  const client = new TelegramClient(session, config.api_id, config.api_hash, {
    connectionRetries: 5,
    autoReconnect: false,
    useWSS: false
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

  try {
    await client.start({
      phoneNumber: async () => await ask("Phone number: "),
      phoneCode: async () => await ask("Code: "),
      password: async () => await ask("Password (if enabled): ")
    });
  } finally {
    rl.close();
  }

  const saved = client.session.save();
  if (saved && saved !== config.session_string) {
    config.session_string = saved;
    await saveConfig(config);
  }

  return client;
}

function rotateSchedules(todayData, tomorrowData, allHistory, channels, timezoneOffset) {
  const todayDate = formatDate(nowWithOffset(timezoneOffset));

  for (const channel of channels) {
    const channelId = channel.id;
    const todayItem = todayData.find((item) => item.channel_id === channelId);

    if (todayItem) {
      const scheduleDate = todayItem.schedule_date || todayDate;
      const historyList = allHistory[channelId] || [];
      const exists = historyList.some(
        (entry) => entry.schedule_date === scheduleDate && entry.channel_id === channelId
      );
      if (!exists) {
        historyList.push({
          channel_id: channelId,
          schedule_date: scheduleDate,
          schedule_time: todayItem.schedule_time || "",
          schedule: todayItem.schedule || {},
          emergency_outages: todayItem.emergency_outages || false
        });
      }
      allHistory[channelId] = historyList;
    }
  }

  for (const item of tomorrowData) {
    item.schedule_date = todayDate;
  }

  return [tomorrowData, [], allHistory];
}

async function fetchMessagesForChannel(client, channel, today, tomorrow, timezoneOffset, limitMessages) {
  const channelId = channel.id;
  const channelName = channel.name;
  const channelUsername = channel.username;

  let bestResult = null;
  let tomorrowResult = null;
  let fallbackResult = null;
  const allFoundDates = [];
  let messagesChecked = 0;
  let scheduleMessagesFound = 0;

  try {
    const entity = await client.getEntity(channelUsername);
    console.log(`Processing channel ${channelId} (${channelName}): ${channelUsername}`);

    for await (const message of client.iterMessages(entity, { limit: limitMessages })) {
      messagesChecked += 1;
      const msgText = message.message || message.text || "";
      if (!isPowerOutageSchedule(msgText) && !hasQueueSchedule(msgText)) {
        continue;
      }

      scheduleMessagesFound += 1;
      const scheduleDate = parseDate(msgText, timezoneOffset);
      if (!scheduleDate) {
        console.log(`[DBG] Channel ${channelId}: no date found in: ${msgText.slice(0, 120).replace(/\n/g, " ")}`);
        continue;
      }

      const parsed = parseSchedule(msgText);
      if (!parsed || Object.keys(parsed).length === 0) {
        console.log(`[DBG] Channel ${channelId}: date=${scheduleDate} but schedule empty`);
        continue;
      }

      const updateTime = formatTime(message.date, timezoneOffset);
      const emergencyFlag = isEmergencyOutageActive(msgText);
      allFoundDates.push(scheduleDate);

      if (scheduleDate === today && !bestResult) {
        bestResult = {
          channel_id: channelId,
          schedule_date: scheduleDate,
          schedule_time: updateTime,
          schedule: parsed,
          emergency_outages: emergencyFlag
        };
      } else if (scheduleDate === tomorrow && !tomorrowResult) {
        tomorrowResult = {
          channel_id: channelId,
          schedule_date: scheduleDate,
          schedule_time: updateTime,
          schedule: parsed,
          emergency_outages: emergencyFlag
        };
        if (bestResult) {
          break;
        }
      } else if (!fallbackResult) {
        fallbackResult = {
          channel_id: channelId,
          schedule_date: scheduleDate,
          schedule_time: updateTime,
          schedule: parsed,
          emergency_outages: emergencyFlag
        };
      }
    }

    if (bestResult || tomorrowResult || fallbackResult) {
      const foundDates = [];
      if (bestResult) {
        foundDates.push(`today (${bestResult.schedule_date})`);
      }
      if (tomorrowResult) {
        foundDates.push(`tomorrow (${tomorrowResult.schedule_date})`);
      }
      if (!foundDates.length && fallbackResult) {
        foundDates.push(`fallback (${fallbackResult.schedule_date})`);
      }

      if (foundDates.length > 0) {
        console.log(`[OK] Channel ${channelId}: Found ${foundDates.join(", ")}`);
      }

      return {
        today: bestResult,
        tomorrow: tomorrowResult,
        fallback: fallbackResult
      };
    }

    const datesInfo = allFoundDates.length > 0 ? `, found dates: ${[...new Set(allFoundDates)]}` : "";
    console.log(
      `[ERR] Channel ${channelId}: Checked ${messagesChecked} messages, found ${scheduleMessagesFound} schedule messages${datesInfo}`
    );
    return null;
  } catch (error) {
    console.log(`[ERR] Error fetching from channel ${channelId}: ${error.message}`);
    return null;
  }
}

export async function fetchAllChannels() {
  const config = await loadConfig();
  validateConfig(config);
  const batchConfig = config.batch_parser || {};
  const batchSize = batchConfig.batch_size ?? 2;
  const batchDelay = batchConfig.batch_delay ?? 5;
  const limitMessages = batchConfig.limit_messages ?? 200;
  const timezoneOffset = config.timezone_offset ?? 2;
  const channels = config.channels;
  const db = await connectDb();
  const todayCollection = db.collection("schedules_today");
  const tomorrowCollection = db.collection("schedules_tomorrow");
  const historyCollection = db.collection("schedules_history");

  let client;
  try {
    client = await createClient(config);

    const today = formatDate(nowWithOffset(timezoneOffset));
    const tomorrow = formatDate(new Date(nowWithOffset(timezoneOffset).getTime() + 24 * 60 * 60 * 1000));

    let todayData = await todayCollection.find({}, { projection: { _id: 0 } }).toArray();
    let tomorrowData = await tomorrowCollection.find({}, { projection: { _id: 0 } }).toArray();
    if (!Array.isArray(todayData)) {
      todayData = [];
    }
    if (!Array.isArray(tomorrowData)) {
      tomorrowData = [];
    }

    const allHistory = {};
    for (const channel of channels) {
      const channelId = channel.id;
      const history = await historyCollection.find({ channel_id: channelId }, { projection: { _id: 0 } }).toArray();
      allHistory[channelId] = Array.isArray(history) ? history : [];
    }

    let rotated = false;
    if (todayData.length > 0 && todayData[0].schedule_date !== today) {
      console.log("[ROTATE] Rotating schedules (crossed midnight)...");
      [todayData, tomorrowData] = rotateSchedules(
        todayData,
        tomorrowData,
        allHistory,
        channels,
        timezoneOffset
      );
      rotated = true;
    }

    let todayUpdated = 0;
    let tomorrowUpdated = 0;

    for (let batchIdx = 0; batchIdx < channels.length; batchIdx += batchSize) {
      const batch = channels.slice(batchIdx, batchIdx + batchSize);
      console.log(`\nProcessing batch ${Math.floor(batchIdx / batchSize) + 1}/${Math.ceil(channels.length / batchSize)}`);
      console.log(`Parsing up to ${limitMessages} messages per channel`);

      for (const channel of batch) {
        const channelId = channel.id;
        const result = await fetchMessagesForChannel(
          client,
          channel,
          today,
          tomorrow,
          timezoneOffset,
          limitMessages
        );

        if (!result) {
          continue;
        }

        const todayResult = result.today;
        const tomorrowResult = result.tomorrow;
        const fallbackResult = result.fallback;

        if (todayResult) {
          const todayIdx = todayData.findIndex((item) => item.channel_id === channelId);
          if (todayIdx !== -1) {
            const existing = todayData[todayIdx].schedule || {};
            for (const [queue, newPeriods] of Object.entries(todayResult.schedule)) {
              const oldPeriods = existing[queue] || [];
              existing[queue] = mergeIntervals([...oldPeriods, ...newPeriods]);
            }
            todayData[todayIdx].schedule_time = todayResult.schedule_time;
            todayData[todayIdx].schedule_date = todayResult.schedule_date;
            todayData[todayIdx].emergency_outages =
              todayResult.emergency_outages || todayData[todayIdx].emergency_outages || false;
          } else {
            todayData.push({
              channel_id: channelId,
              schedule_date: todayResult.schedule_date,
              schedule_time: todayResult.schedule_time,
              schedule: todayResult.schedule,
              emergency_outages: todayResult.emergency_outages
            });
          }
          todayUpdated += 1;
        }

        if (tomorrowResult) {
          const tomorrowIdx = tomorrowData.findIndex((item) => item.channel_id === channelId);
          if (tomorrowIdx !== -1) {
            const existing = tomorrowData[tomorrowIdx].schedule || {};
            for (const [queue, newPeriods] of Object.entries(tomorrowResult.schedule)) {
              const oldPeriods = existing[queue] || [];
              existing[queue] = mergeIntervals([...oldPeriods, ...newPeriods]);
            }
            tomorrowData[tomorrowIdx].schedule_time = tomorrowResult.schedule_time;
            tomorrowData[tomorrowIdx].schedule_date = tomorrowResult.schedule_date;
            tomorrowData[tomorrowIdx].emergency_outages =
              tomorrowResult.emergency_outages || tomorrowData[tomorrowIdx].emergency_outages || false;
          } else {
            tomorrowData.push({
              channel_id: channelId,
              schedule_date: tomorrowResult.schedule_date,
              schedule_time: tomorrowResult.schedule_time,
              schedule: tomorrowResult.schedule,
              emergency_outages: tomorrowResult.emergency_outages
            });
          }
          tomorrowUpdated += 1;
        }

        if (fallbackResult && !todayResult) {
          const todayIdx = todayData.findIndex((item) => item.channel_id === channelId);
          if (todayIdx === -1) {
            todayData.push({
              channel_id: channelId,
              schedule_date: fallbackResult.schedule_date,
              schedule_time: fallbackResult.schedule_time,
              schedule: fallbackResult.schedule,
              emergency_outages: fallbackResult.emergency_outages
            });
            todayUpdated += 1;
          }
        }
      }

      if (batchIdx + batchSize < channels.length) {
        console.log(`Waiting ${batchDelay} seconds before next batch...`);
        await new Promise((resolve) => setTimeout(resolve, batchDelay * 1000));
      }
    }

    await todayCollection.deleteMany({});
    if (todayData.length > 0) {
      await todayCollection.insertMany(todayData);
    }

    await tomorrowCollection.deleteMany({});
    if (tomorrowData.length > 0) {
      await tomorrowCollection.insertMany(tomorrowData);
    }

    const historyOps = [];
    for (const channel of channels) {
      const channelId = channel.id;
      const history = allHistory[channelId] || [];
      history.sort((a, b) => (a.schedule_date < b.schedule_date ? 1 : -1));
      for (const entry of history) {
        historyOps.push({
          updateOne: {
            filter: { channel_id: channelId, schedule_date: entry.schedule_date },
            update: { $set: entry },
            upsert: true
          }
        });
      }
    }

    if (historyOps.length > 0) {
      await historyCollection.bulkWrite(historyOps);
    }

    console.log("\n============================================================");
    console.log("Parsing complete!");
    if (rotated) {
      console.log("[OK] Schedules rotated to new day");
    }
    console.log(`Updated today schedules: ${todayUpdated}/${channels.length} channels`);
    console.log(`Updated tomorrow schedules: ${tomorrowUpdated}/${channels.length} channels`);
    console.log("Saved to MongoDB collections: schedules_today, schedules_tomorrow, schedules_history");
    console.log("============================================================");
    return true;
  } catch (error) {
    console.log(`Error: ${error.message}`);
    return false;
  } finally {
    if (client) {
      try { client._log?.setLevel("none"); } catch (_) {}
      await client.disconnect();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fetchAllChannels()
    .catch((error) => {
      console.log(`Fatal error: ${error.message}`);
      process.exit(1);
    })
    .finally(async () => {
      await closeDb();
    });
}
