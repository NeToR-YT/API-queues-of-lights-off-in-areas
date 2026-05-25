const MONTHS_MAP: Record<string, number> = {
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
  "грудня": 12,
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
  "застосовані графіки аварійних",
];

const SCHEDULE_KEYWORDS = [
  "графік відключення світла",
  "графіки відключення світла",
  "графіки відключень світла",
  "графік погодинних вимкнень",
  "графіки погодинних вимкнень",
  "графіки погодинних відключень",
  "графік погодинних відключень",
  "погодинних відключень",
  "оновлений графік",
  "оновлені графіки",
  "гоп",
  "гпв",
  "відсутності електропостачання",
  "години відсутності електропостачання",
];

export function normalizeDashes(text: string): string {
  if (!text) return text;
  return text
    .replace(/–/g, "-")
    .replace(/—/g, "-")
    .replace(/‐/g, "-")
    .replace(/−/g, "-")
    .replace(/‑/g, "-")
    .replace(/ /g, " ")
    .replace(/ /g, " ")
    .replace(/ /g, " ");
}

export function isPowerOutageSchedule(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return SCHEDULE_KEYWORDS.some((keyword) => t.includes(keyword));
}

export function hasQueueSchedule(text: string): boolean {
  if (!text) return false;
  const t = normalizeDashes(text);
  // Same-line format: "5.1: 06:00-08:00"
  if (/\b[1-6]\.[12]\s*:\s*\d{1,2}[:.:]\d{2}/.test(t)) return true;
  // Multi-line format: "Черга 5.1:" header, time on next line
  if (/(?:черга|група)\s+[1-6]\.[12]\s*:/i.test(t)) return true;
  return false;
}

export function isEmergencyOutageActive(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  const sentences = t.split(/[\n.!?]+/);

  for (const sentence of sentences) {
    if (EMERGENCY_POSITIVE.some((p) => sentence.includes(p))) {
      if (NEGATIONS.some((n) => sentence.includes(n))) return false;
      return true;
    }
  }
  return false;
}

export function nowWithOffset(timezoneOffsetHours: number): Date {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  return new Date(utcMs + timezoneOffsetHours * 60 * 60 * 1000);
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isValidDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseDate(text: string, timezoneOffsetHours = 2): string | null {
  if (!text) return null;

  const wordMatch = text.match(/(\d{1,2})\s+([\p{L}Ѐ-ӿ]+)/u);
  if (wordMatch) {
    const day = Number(wordMatch[1]);
    const monthStr = wordMatch[2]!.toLowerCase().replace(/[.,]/g, "");
    const month = MONTHS_MAP[monthStr];
    if (month) {
      const year = nowWithOffset(timezoneOffsetHours).getUTCFullYear();
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
    if (year !== null && year < 100) year += 2000;
    if (year === null) year = nowWithOffset(timezoneOffsetHours).getUTCFullYear();
    if (isValidDate(year, month, day)) {
      return formatDateParts(year, month, day);
    }
  }

  return null;
}

function parsePeriod(period: string): string | null {
  const timeMatch = period.match(/(\d{1,2})\s*:\s*(\d{2})\s*-\s*(\d{1,2})\s*:\s*(\d{2})/);
  if (timeMatch) {
    const [startH, startM, endH, endM] = timeMatch.slice(1).map(Number) as [number, number, number, number];
    return `${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}-${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
  }

  const hourMatch = period.match(/(\d{1,2})\s*-\s*(\d{1,2})/);
  if (hourMatch) {
    const [startH, endH] = hourMatch.slice(1).map(Number) as [number, number];
    return `${String(startH).padStart(2, "0")}:00-${String(endH).padStart(2, "0")}:00`;
  }

  return null;
}

function parseHourPeriods(timesStr: string): string[] {
  const periods: string[] = [];
  const matches = timesStr.match(/\d{1,2}\s*:\s*\d{2}\s*-\s*\d{1,2}\s*:\s*\d{2}/g);
  if (matches) {
    for (const part of matches) {
      const parsed = parsePeriod(part);
      if (parsed) periods.push(parsed);
    }
    return periods;
  }

  for (const part of timesStr.split(/[;,]/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const parsed = parsePeriod(trimmed);
    if (parsed) periods.push(parsed);
  }

  return periods;
}

export function parseSchedule(text: string): Record<string, string[]> {
  if (!text) return {};

  let content = normalizeDashes(text);
  content = content.replace(/(\d{1,2})\s*[.:]\s*(\d{2})/g, "$1:$2");
  const lines = content.split("\n");
  const schedule: Record<string, string[]> = {};
  let currentQueue: string | null = null;

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    // Remove all emoji (broad Unicode emoji ranges)
    line = line.replace(/[\u{1F000}-\u{1FFFF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}]/gu, "").trim();
    line = line.replace(/^[\s\-*•●○■▪∙⁃‣•▪▫·●○■□➖]+/, "").trim();

    if (!line) continue;

    const queueHeader = line.match(/(?:черга|група)\s*\[?\s*([0-6](?:\.[12])?)\s*\]?/i);
    if (queueHeader) {
      currentQueue = queueHeader[1]!.trim();
      // Check for inline time after the queue label on the same line
      const afterLabel = line.slice(line.indexOf(queueHeader[0]!) + queueHeader[0]!.length)
        .replace(/^[\s:]+/, "").trim();
      if (afterLabel && afterLabel !== "-") {
        const periods = parseHourPeriods(afterLabel);
        if (periods.length > 0) {
          schedule[currentQueue] = periods;
          currentQueue = null;
        }
      }
      continue;
    }

    const graphMatch = line.match(/графік\s*:?\s*(.*)$/i);
    if (graphMatch && currentQueue) {
      const periods = parseHourPeriods(graphMatch[1]!);
      if (periods.length > 0) schedule[currentQueue] = periods;
      continue;
    }

    // Time on a separate line after a queue header (e.g. "🕒 06:00-08:00" or "🕒 -")
    if (currentQueue) {
      if (line === "-") {
        // No outage for this queue — skip (all-day power)
        currentQueue = null;
        continue;
      }
      const periods = parseHourPeriods(line);
      if (periods.length > 0) {
        schedule[currentQueue] = periods;
        currentQueue = null;
        continue;
      }
    }

    const lineMatch = line.match(/^([0-6](?:\.[12])?)\s*[:–\-]?\s*(\d{1,2}(?::\d{2})?.*)$/);
    if (lineMatch) {
      const queue = lineMatch[1]!.trim();
      const timesStr = lineMatch[2]!.trim();

      let parts: string[];
      if (timesStr.includes(",") || timesStr.includes(";")) {
        parts = timesStr.split(/[;,]/).map((p) => p.trim()).filter(Boolean);
      } else {
        parts = [timesStr];
      }

      const validPeriods = parts.map(parsePeriod).filter((p): p is string => p !== null);
      if (validPeriods.length > 0) schedule[queue] = validPeriods;
    }
  }

  if (Object.keys(schedule).length > 0) return schedule;

  const inlinePattern = /([0-6](?:\.[12])?)\s*[:\-]?\s*((?:\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2})(?:\s*[,;]\s*\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2})*)/g;
  let match: RegExpExecArray | null;
  while ((match = inlinePattern.exec(content)) !== null) {
    const queue = match[1]!.trim();
    const periods = parseHourPeriods(match[2]!.trim());
    if (periods.length > 0) schedule[queue] = periods;
  }

  return schedule;
}

function timeToMinutes(value: string): number | null {
  const parts = value.split(":");
  if (parts.length !== 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function periodToTuple(period: string): [number, number] | null {
  const parts = period.split("-");
  if (parts.length !== 2) return null;
  const start = timeToMinutes(parts[0]!.trim());
  const end = timeToMinutes(parts[1]!.trim());
  if (start === null || end === null) return null;
  return [start, end <= start ? end + 24 * 60 : end];
}

function tupleToPeriod([start, end]: [number, number]): string {
  const endMod = end % (24 * 60);
  return `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}-${String(Math.floor(endMod / 60)).padStart(2, "0")}:${String(endMod % 60).padStart(2, "0")}`;
}

export function mergeIntervals(periods: string[]): string[] {
  const tuples = periods
    .map(periodToTuple)
    .filter((t): t is [number, number] => t !== null)
    .sort((a, b) => a[0] - b[0]);

  if (tuples.length === 0) return [];

  const merged: [number, number][] = [tuples[0]!];
  for (const current of tuples.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (current[0] <= last[1]) {
      last[1] = Math.max(last[1], current[1]);
    } else {
      merged.push(current);
    }
  }

  return merged.map(tupleToPeriod);
}
