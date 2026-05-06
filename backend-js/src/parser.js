const MONTHS_MAP = {
  "січня": 1,
  "лютого": 2,
  "березня": 3,
  "квітня": 4,
  "травня": 5,
  "червня": 6,
  "липня": 7,
  "серпня": 8,
  "вересня": 9,
  "жовтня": 10,
  "листопада": 11,
  "грудня": 12
};

const NEGATIONS = ["скасован", "не застосов", "не буд", "не застосовані", "скасовано", "не діють"];

const EMERGENCY_POSITIVE = [
  "аварійних відключень",
  "аварійні відключення",
  "га в",
  "гaв",
  "гав",
  "гав)",
  "сгав",
  "сга",
  "застосовані графіки аварійних відключень",
  "застосовані графіки аварійних"
];

const SCHEDULE_KEYWORDS = [
  "графік відключення світла",
  "графіки відключення світла",
  "графіки відключень світла",
  "графік погодинних вимкнень",
  "графіки погодинних вимкнень",
  "оновлений графік",
  "оновлені графіки",
  "гоп",
  "гпв",
  "відсутності електропостачання",
  "години відсутності електропостачання"
];

export function normalizeDashes(text) {
  if (!text) {
    return text;
  }
  let t = text;
  t = t.replace(/\u2013/g, "-");
  t = t.replace(/\u2014/g, "-");
  t = t.replace(/\u2010/g, "-");
  t = t.replace(/\u2212/g, "-");
  t = t.replace(/\u2011/g, "-");
  t = t.replace(/\u00A0/g, " ");
  t = t.replace(/\u202F/g, " ");
  t = t.replace(/\u2009/g, " ");
  return t;
}

export function isPowerOutageSchedule(text) {
  if (!text) {
    return false;
  }
  const t = text.toLowerCase();
  return SCHEDULE_KEYWORDS.some((keyword) => t.includes(keyword));
}

export function hasQueueSchedule(text) {
  if (!text) {
    return false;
  }
  const t = normalizeDashes(text);
  return /\b[1-6]\.[12]\s*:\s*\d{1,2}[:.:]\d{2}/.test(t);
}

export function isEmergencyOutageActive(text) {
  if (!text) {
    return false;
  }
  const t = text.toLowerCase();
  const sentences = t.split(/[\n.!?]+/);

  for (const sentence of sentences) {
    if (EMERGENCY_POSITIVE.some((p) => sentence.includes(p))) {
      if (NEGATIONS.some((n) => sentence.includes(n))) {
        return false;
      }
      return true;
    }
  }
  return false;
}

function nowWithOffset(timezoneOffsetHours) {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  return new Date(utcMs + timezoneOffsetHours * 60 * 60 * 1000);
}

function formatDateParts(year, month, day) {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isValidDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseDate(text, timezoneOffsetHours = 2) {
  if (!text) {
    return null;
  }

  const wordMatch = text.match(/(\d{1,2})\s+([\p{L}\u0400-\u04FF]+)/u);
  if (wordMatch) {
    const day = Number(wordMatch[1]);
    const monthStr = wordMatch[2].toLowerCase().replace(/[.,]/g, "");
    const month = MONTHS_MAP[monthStr];
    if (month) {
      const now = nowWithOffset(timezoneOffsetHours);
      const year = now.getUTCFullYear();
      if (isValidDate(year, month, day)) {
        return formatDateParts(year, month, day);
      }
    }
  }

  const numMatch = text.match(/(?<!\d)(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\s*(?!\s*:)/);
  if (numMatch) {
    const day = Number(numMatch[1]);
    const month = Number(numMatch[2]);
    let year = numMatch[3] ? Number(numMatch[3]) : null;
    if (year !== null && year < 100) {
      year += 2000;
    }
    if (year === null) {
      const now = nowWithOffset(timezoneOffsetHours);
      year = now.getUTCFullYear();
    }
    if (isValidDate(year, month, day)) {
      return formatDateParts(year, month, day);
    }
  }

  return null;
}

function parsePeriod(period) {
  const timeMatch = period.match(/(\d{1,2})\s*:\s*(\d{2})\s*-\s*(\d{1,2})\s*:\s*(\d{2})/);
  if (timeMatch) {
    const [startH, startM, endH, endM] = timeMatch.slice(1).map(Number);
    return `${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}-${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
  }

  const hourMatch = period.match(/(\d{1,2})\s*-\s*(\d{1,2})/);
  if (hourMatch) {
    const [startH, endH] = hourMatch.slice(1).map(Number);
    return `${String(startH).padStart(2, "0")}:00-${String(endH).padStart(2, "0")}:00`;
  }

  return null;
}

function parseHourPeriods(timesStr) {
  const periods = [];
  const matches = timesStr.match(/\d{1,2}\s*:\s*\d{2}\s*-\s*\d{1,2}\s*:\s*\d{2}/g);
  if (matches) {
    for (const part of matches) {
      const parsed = parsePeriod(part);
      if (parsed) {
        periods.push(parsed);
      }
    }
    return periods;
  }

  for (const part of timesStr.split(/[;,]/)) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const parsed = parsePeriod(trimmed);
    if (parsed) {
      periods.push(parsed);
    }
  }

  return periods;
}

export function parseSchedule(text) {
  if (!text) {
    return {};
  }

  let content = normalizeDashes(text);
  content = content.replace(/(\d{1,2})\s*[.:]\s*(\d{2})/g, "$1:$2");
  const lines = content.split("\n");
  const schedule = {};
  let currentQueue = null;

  for (let rawLine of lines) {
    let line = rawLine.trim();
    if (!line) {
      continue;
    }

    line = line.replace(/[🔹❗✅➡️💡⚠️🗓📍⚡🏆⌛️]+/g, "").trim();
    line = line.replace(/^[\s\-*\u2022\u25CF\u25CB\u25A0\u25AA\u2219\u2043\u2023•▪▫·●○■□]+/, "").trim();

    const queueHeader = line.match(/(?:черга|група)\s*\[?\s*([0-6](?:\.[12])?)\s*\]?/i);
    if (queueHeader) {
      currentQueue = queueHeader[1].trim();
    }

    const graphMatch = line.match(/графік\s*:?\s*(.*)$/i);
    if (graphMatch && currentQueue) {
      const periods = parseHourPeriods(graphMatch[1]);
      if (periods.length > 0) {
        schedule[currentQueue] = periods;
      }
      continue;
    }

    const lineMatch = line.match(/^([0-6](?:\.[12])?)\s*[:\u2013\-]?\s*(\d{1,2}(?::\d{2})?.*)$/);
    if (lineMatch) {
      const queue = lineMatch[1].trim();
      const timesStr = lineMatch[2].trim();

      let periods = [];
      if (timesStr.includes(",") || timesStr.includes(";")) {
        for (const part of timesStr.split(/[;,]/)) {
          const trimmed = part.trim();
          if (trimmed) {
            periods.push(trimmed);
          }
        }
      } else {
        periods = [timesStr];
      }

      const validPeriods = [];
      for (const period of periods) {
        const parsed = parsePeriod(period);
        if (parsed) {
          validPeriods.push(parsed);
        }
      }

      if (validPeriods.length > 0) {
        schedule[queue] = validPeriods;
      }
    }
  }

  if (Object.keys(schedule).length > 0) {
    return schedule;
  }

  const inlinePattern = /([0-6](?:\.[12])?)\s*[:\-]?\s*((?:\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2})(?:\s*[,;]\s*\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2})*)/g;
  let match;
  while ((match = inlinePattern.exec(content)) !== null) {
    const queue = match[1].trim();
    const timesStr = match[2].trim();
    const periods = parseHourPeriods(timesStr);
    if (periods.length > 0) {
      schedule[queue] = periods;
    }
  }

  return schedule;
}

function timeToMinutes(value) {
  const parts = value.split(":");
  if (parts.length !== 2) {
    return null;
  }
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
}

function periodToTuple(period) {
  const parts = period.split("-");
  if (parts.length !== 2) {
    return null;
  }
  const start = timeToMinutes(parts[0].trim());
  const end = timeToMinutes(parts[1].trim());
  if (start === null || end === null) {
    return null;
  }
  const adjustedEnd = end <= start ? end + 24 * 60 : end;
  return [start, adjustedEnd];
}

function tupleToPeriod(tuple) {
  const [start, end] = tuple;
  const endMod = end % (24 * 60);
  const startH = String(Math.floor(start / 60)).padStart(2, "0");
  const startM = String(start % 60).padStart(2, "0");
  const endH = String(Math.floor(endMod / 60)).padStart(2, "0");
  const endM = String(endMod % 60).padStart(2, "0");
  return `${startH}:${startM}-${endH}:${endM}`;
}

export function mergeIntervals(periods) {
  const tuples = periods
    .map(periodToTuple)
    .filter((tuple) => tuple !== null)
    .sort((a, b) => a[0] - b[0]);

  if (tuples.length === 0) {
    return [];
  }

  const merged = [tuples[0]];
  for (const current of tuples.slice(1)) {
    const last = merged[merged.length - 1];
    if (current[0] <= last[1]) {
      last[1] = Math.max(last[1], current[1]);
    } else {
      merged.push(current);
    }
  }

  return merged.map(tupleToPeriod);
}
