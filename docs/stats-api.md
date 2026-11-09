# API статистики відключень електроенергії

REST API, що збирає графіки погодинних відключень (ГПВ) з Telegram-каналів українських обленерго, зберігає їх у MongoDB і **на льоту обчислює агреговану статистику** для будь-якого міста, періоду й черги.

Цей документ описує **повністю логіку модуля статистики**: від сирого рядка `"08:00-12:30"` у Telegram-повідомленні — до JSON-відповіді ендпоінта `/api/stats/summary` зі зведеними метриками за період.

---

## Зміст

- [Огляд](#огляд)
- [Архітектура модуля](#архітектура-модуля)
- [Як працює статистика — повний шлях даних](#як-працює-статистика--повний-шлях-даних)
  - [1. Джерело даних](#1-джерело-даних)
  - [2. Завантаження вибірки](#2-завантаження-вибірки)
  - [3. Парсинг рядків часу](#3-парсинг-рядків-часу-hhmm-hhmm--інтервали-хвилин)
  - [4. Об'єднання черг (union)](#4-обєднання-черг-union)
  - [5. Денний агрегат `DailyStat`](#5-денний-агрегат-dailystat)
  - [6. Streak-и через ніч](#6-streak-и-через-ніч)
  - [7. Кешування](#7-кешування)
- [Структура модуля `src/stats/`](#структура-модуля-srcstats)
- [Усі ендпоінти статистики](#усі-ендпоінти-статистики)
  - [`/api/stats/summary`](#get-apistatssummary)
  - [`/api/stats/timeseries`](#get-apistatstimeseries)
  - [`/api/stats/heatmap`](#get-apistatsheatmap)
  - [`/api/stats/weekday`](#get-apistatsweekday)
  - [`/api/stats/buckets`](#get-apistatsbuckets)
  - [`/api/stats/queues`](#get-apistatsqueues)
  - [`/api/stats/cities`](#get-apistatscities)
  - [`/api/stats/coverage`](#get-apistatscoverage)
  - [`/api/stats/queues-list`](#get-apistatsqueues-list)
  - [`/api/stats/day`](#get-apistatsday)
- [Кешування](#кешування)
- [Помилки та валідація](#помилки-та-валідація)
- [Розширення: як додати нову метрику](#розширення-як-додати-нову-метрику)
- [Залежності та фоновий контекст](#залежності-та-фоновий-контекст)

---

## Огляд

**Що це робить:** дозволяє по HTTP отримати агреговані метрики відключень для одного міста (`channel_id`) за обраний період (`from`–`to`), опціонально по конкретній черзі (`queue=1.1`). Усі метрики обчислюються «на льоту» з історичних даних, без попередньої матеріалізації.

**Чому на льоту, а не таблицею-агрегатом:**

- Обсяг даних малий (десятки тисяч записів), обчислення укладається в десятки мілісекунд.
- Гнучкість — можна додати нову метрику без міграції БД.
- Кеш у пам'яті процесу (5 хв TTL) знімає навантаження при повторних запитах.

**Що отримує клієнт:** JSON з готовими числами для відображення карток/графіків/таблиць (`reliability_percent`, `avg_off_hours_per_day`, `heatmap.hours[24]`, `weekday.weekdays[7]`, тощо).

---

## Архітектура модуля

```
┌──────────────────────────────────────────────────────────────────────┐
│  HTTP клієнт                                                          │
│    GET /api/stats/summary?channel_id=1&from=2026-01-01&to=2026-04-30 │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  src/stats/routes.ts                                                  │
│    • парсить query (channel_id, from, to, queue)                      │
│    • валідує (requireChannel, requireData)                            │
│    • перевіряє кеш (cacheKey = path + query)                          │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ cache miss
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  loadHistoryRange(db, channel_id, from, to)                           │
│    • find() по schedules_history з $gte/$lte                          │
│    • + findOne() по schedules_today, якщо потрапляє в діапазон        │
│    • повертає ScheduleEntry[], сортовано за датою                     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ ScheduleEntry[]
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  src/stats/computations.ts                                            │
│    computeSummary / computeHeatmap / computeWeekday / ...             │
│    використовують utils.ts: getMergedIntervals, computeDailyStat, ... │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ типизована метрика
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  cache.set(key, value, expiresAt: now + 5min) → JSON response         │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Як працює статистика — повний шлях даних

### 1. Джерело даних

Парсер заповнює дві колекції MongoDB:

- **`schedules_history`** — архів усіх графіків, які колись бачили. Один документ = (`channel_id`, `schedule_date`).
- **`schedules_today`** — оперативна копія найсвіжішого графіка на сьогодні (перезаписується при кожному оновленні).

Кожен документ:

```json
{
  "channel_id": 1,
  "schedule_date": "2026-04-10",
  "schedule_time": "08:30:12",
  "schedule": {
    "1.1": ["08:00-12:00", "18:00-22:00"],
    "1.2": ["00:00-04:00", "14:00-18:00"]
  },
  "emergency_outages": false
}
```

Ключі `schedule` — це **черги** (`"1.1"`, `"1.2"`, ...). Значення — список рядків `"HH:MM-HH:MM"`, коли світла не буде.

### 2. Завантаження вибірки

```ts
loadHistoryRange(db, channel_id, from, to)
```

1. `db.collection("schedules_history").find({ channel_id, schedule_date: { $gte: from, $lte: to } })`
2. `db.collection("schedules_today").findOne({ channel_id })` — і якщо `schedule_date` сьогоднішнього документа потрапляє в `[from, to]` **і його ще немає** в `history`, додаємо його теж. Це закриває «дірку» між моментом, коли парсер записав сьогоднішній графік, і коли він мігрував у history.
3. Сортуємо за `schedule_date` ↑.

Результат: `ScheduleEntry[]` за період.

### 3. Парсинг рядків часу `"HH:MM-HH:MM"` → інтервали хвилин

Усі обчислення проводяться **у хвилинах від початку доби** (0–1440). Рядок `"08:30-12:00"` стає `[510, 720]`.

Регулярка: `/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/`

Спецвипадки:

| Вхід | Старт | Кінець | Чому |
|------|-------|--------|------|
| `"08:00-12:30"` | 480  | 750  | звичайний випадок |
| `"22:00-00:00"` | 1320 | **1440** | північ = 24:00, інакше було б `0` і ширина від'ємна |
| `"22:00-02:00"` | 1320 | 1560 → **обрізається до 1440** | проміжок через ніч; на день поточної дати фіксуємо тільки частину до півночі |
| `"abc"` | — | — | пропускається (повертає `null`) |

Конверсія робиться один раз у `getMergedIntervals(entry, queue)`. Регекс попередньо скомпільований у `PERIOD_RE` — щоб не створювати об'єкт RegExp на кожен парсинг.

Далі **clamp** до `[0, 1440]` і **sort + merge** перекриваючих інтервалів:

```ts
[[510, 750], [600, 900], [1320, 1440]]
  → merge → [[510, 900], [1320, 1440]]
```

Це критично: якщо черги `1.1` і `1.2` мають перекриваючі періоди — кожна година враховується **лише раз**.

### 4. Об'єднання черг (union)

`getPeriods(entry, queue)`:

- Якщо `queue` задана → беремо лише `entry.schedule[queue]`.
- Якщо ні → конкатенуємо **всі** черги (`Object.values(schedule).flat()`).

Далі результат проходить через merge — отже union черг автоматично прибирає дублікати часу.

### 5. Денний агрегат `DailyStat`

`computeDailyStat(entry, queue)` повертає компактний об'єкт, з якого потім будуються всі агреговані метрики:

```ts
interface DailyStat {
  date: string;                          // "2026-04-10"
  off_minutes: number;                   // сумарно хвилин без світла за день
  blocks_count: number;                  // кількість блоків відключень (після merge)
  hourly_mask: number[];                 // 24 числа [0..1] — частка години без світла
  emergency: boolean;                    // прапор ГАВ із сирого документа
  intervals: Array<[number, number]>;    // merged-інтервали (потрібні для streak-ів)
}
```

`hourly_mask` рахується одним проходом: для кожного інтервалу `[s, e]` обчислюємо лише ті години `h`, в які він потрапляє (`startH..endH`), без сканування всіх 24 — це економить ~20× ітерацій для коротких інтервалів.

### 6. Streak-и через ніч

`longest_blackout_streak_minutes` — це **найдовший безперервний час без світла за весь період**, який **може тривати кілька днів поспіль** (наприклад, 24+24+8 годин без перерви).

Як це обчислюється (`computeStreaks`):

1. Кожен інтервал дня переводимо в «абсолютні» хвилини на осі часу:
   `base = dayIndex(date) * 1440`, абсолютний інтервал = `[base + s, base + e]`.
2. Сортуємо всі абсолютні інтервали і **merge** — отримуємо неперервні «темні» блоки на глобальній осі.
3. `longest_blackout_streak` = максимальна ширина блоку.
4. `longest_power_streak` = максимальна **дірка** між сусідніми блоками.
5. `min_blackout_duration` / `min_power_duration` — найкоротший блок / найкоротша дірка (>0).

Це працює навіть для розрізнених періодів: якщо в БД є тільки 5, 6 і 8 квітня (без 7-го), то блок 5→6→8 квітня **не зливається в один streak**, бо `dayIndex(8) − dayIndex(6) > 1`, між ними залишається «світла» зона. Це коректна поведінка — ми не вигадуємо дані, яких немає.

### 7. Кешування

```ts
const cache = new Map<string, { value, expiresAt }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
```

- **Ключ**: `path + "?" + querystring` (`/api/stats/summary?channel_id=1&from=...&to=...&queue=1.1`).
- **TTL**: 5 хвилин.
- При cache miss: обчислюємо, кладемо в Map.
- Інвалідації немає — TTL спрацьовує сам. Перезапуск процесу очищає кеш.

Кеш живе в пам'яті одного процесу. При горизонтальному масштабуванні кожен процес матиме свій кеш — це ОК, бо обчислення дешеве.

---

## Структура модуля `src/stats/`

```
src/stats/
├── types.ts          # інтерфейси усіх метрик
├── utils.ts          # парсинг, merge, дати, рейтинг черг
├── computations.ts   # головні функції compute*
├── routes.ts         # Express-роути + кеш + helper statsRoute()
└── index.ts          # реекспорти для зовнішнього використання
```

### `types.ts`

Усі інтерфейси відповідей. Імпортується у `computations.ts`, `routes.ts` та клієнтським кодом.

```ts
export interface DailyStat        { ... }
export interface SummaryStat      { ... }
export interface HeatmapStat      { ... }
export interface WeekdayStat      { ... }
export interface BucketsStat      { ... }
export interface TimeseriesPoint  { ... }
export interface TypicalWindowStat { ... }
export interface QueueBreakdownItem { ... }
export interface CoverageStat     { ... }
```

### `utils.ts`

| Функція | Призначення |
|---------|-------------|
| `getMergedIntervals(entry, queue?)` | `ScheduleEntry` → `Array<[start, end]>` merged-інтервалів за день |
| `computeDailyStat(entry, queue?)` | Повний `DailyStat` для одного дня |
| `overlapWithRange(intervals, s, e)` | Сума перетину інтервалів з заданим вікном |
| `generateDateRange(from, to)` | `["2026-01-01", "2026-01-02", ...]` |
| `getWeekday(dateStr)` | 0=Пн … 6=Нд |
| `dayIndex(dateStr)` | абсолютний номер доби з епохи (для streak-ів) |
| `minsToTimeStr(mins)` | `510 → "08:30"`, `1440 → "24:00"` |
| `detectAllQueues(entries)` | унікальні назви черг, відсортовані |
| `defaultDateRange()` | `{ from: today − 30 днів, to: today }` |

Експортує константи `MIN_PER_DAY = 1440` та `WEEKDAY_NAMES = ["Пн","Вт",...]`.

### `computations.ts`

| Функція | Повертає |
|---------|----------|
| `computeSummary(entries, from, to, queue?)` | `SummaryStat` |
| `computeTimeseries(entries, queue?)` | `TimeseriesPoint[]` |
| `computeHeatmap(entries, queue?)` | `HeatmapStat` |
| `computeWeekday(entries, queue?)` | `WeekdayStat` |
| `computeBuckets(entries, queue?)` | `BucketsStat` |
| `computeQueuesBreakdown(entries)` | `QueueBreakdownItem[]` |
| `computeTypicalWindow(entries, queue?)` | `TypicalWindowStat` |
| `computeCoverage(entries, from, to)` | `CoverageStat` |

Внутрішня функція `computeStreaks(daily)` обчислює 4 числа: `blackout`, `power`, `minBlackout`, `minPower`.

### `routes.ts`

Express-роутер. Усі типові ендпоінти будуються через хелпер `statsRoute()`, який автоматично:

1. парсить query,
2. валідує `channel_id`,
3. завантажує `entries`,
4. валідує наявність даних,
5. перевіряє кеш,
6. викликає твою лямбду,
7. відповідає JSON-ом з обгорткою `{ channel_id, queue, from, to, ...data }`.

```ts
router.get("/api/stats/summary",
  statsRoute(db, (entries, q, from, to) => computeSummary(entries, from, to, q.queue))
);
```

Спеціальні ендпоінти (`/cities`, `/day`, `/queues-list`) пишуться напряму без хелпера, бо мають іншу логіку валідації.

### `index.ts`

Реекспортує `createStatsRoutes`, всі типи з `types.ts`, всі `compute*` з `computations.ts`, а також `defaultDateRange`, `detectAllQueues` з `utils.ts`.

У `src/app.ts`:

```ts
import { createStatsRoutes } from "./stats/index.js";
app.use(createStatsRoutes(db));
```

---

## Усі ендпоінти статистики

Базовий URL: `http://localhost:5000`

**Спільні параметри:**

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|---------------|------|
| `channel_id` | number | так (крім `/cities`) | ID міста |
| `from`, `to` | `YYYY-MM-DD` | ні | За замовч.: останні 30 днів |
| `queue` | string | ні | Напр. `"1.1"`; без неї — union усіх черг |
| `date` | `YYYY-MM-DD` | для `/day` | Конкретна дата |

**Спільна обгортка відповіді** (для `statsRoute`-ендпоінтів):

```json
{ "channel_id": 1, "queue": "1.1", "from": "...", "to": "...", ...metric }
```

---

### `GET /api/stats/summary`

Зведена статистика за період: середні/мін/макс, надійність, streak-и, топ найгірших днів, ГАВ.

```
GET /api/stats/summary?channel_id=1&from=2026-01-01&to=2026-04-30&queue=1.1
```

```json
{
  "channel_id": 1, "queue": "1.1", "from": "2026-01-01", "to": "2026-04-30",
  "period": { "from": "2026-01-01", "to": "2026-04-30", "days_total": 120, "days_with_data": 45 },
  "total_off_hours": 540.5,
  "avg_off_hours_per_day": 12.01,
  "min_off_hours_per_day": 2.0,
  "max_off_hours_per_day": 22.0,
  "stddev_off_hours": 4.3,
  "reliability_percent": 49.96,
  "avg_block_minutes": 240,
  "avg_blocks_per_day": 3.0,
  "longest_blackout_streak_minutes": 4320,
  "longest_power_streak_minutes": 1200,
  "min_blackout_duration_minutes": 120,
  "min_power_duration_minutes": 60,
  "top_worst_days": [{ "date": "2026-02-14", "off_hours": 22.0 }],
  "top_best_days":  [{ "date": "2026-04-10", "off_hours": 2.0 }],
  "emergency_days_count": 3,
  "emergency_rate_percent": 6.67
}
```

| Поле | Як рахується |
|------|--------------|
| `period.days_total` | `generateDateRange(from, to).length` |
| `period.days_with_data` | `entries.length` |
| `total_off_hours` | сума `off_minutes` по всіх днях, ділимо на 60 |
| `avg_off_hours_per_day` | `total / days_with_data` |
| `min_off_hours_per_day` / `max_*` | мінімум і максимум `off_minutes` серед днів |
| `stddev_off_hours` | √(Σ(x − μ)² / N) у годинах |
| `reliability_percent` | `(1440 × N − total_off_min) / (1440 × N) × 100` |
| `avg_block_minutes` | `total_off_min / total_blocks` (середня тривалість одного блоку) |
| `avg_blocks_per_day` | `total_blocks / days_with_data` |
| `longest_blackout_streak_minutes` | див. [§6 Streak-и через ніч](#6-streak-и-через-ніч) |
| `longest_power_streak_minutes` | найдовша дірка між merged-блоками |
| `min_blackout_duration_minutes` | найкоротший merged-блок |
| `min_power_duration_minutes` | найкоротша дірка >0 між merged-блоками |
| `top_worst_days` / `top_best_days` | сортування `daily` за `off_minutes`, slice(0,5) / slice(-5).reverse() |
| `emergency_days_count` | `daily.filter(d => d.emergency).length` |
| `emergency_rate_percent` | `emergency_days / days_with_data × 100` |

---

### `GET /api/stats/timeseries`

Часовий ряд для побудови лінійного графіка.

```
GET /api/stats/timeseries?channel_id=1&from=2026-04-01&to=2026-04-30&queue=1.1
```

```json
{
  "channel_id": 1, "queue": "1.1", "from": "...", "to": "...",
  "points": [
    { "date": "2026-04-08", "off_hours": 10.5, "blocks_count": 3, "emergency": false },
    { "date": "2026-04-09", "off_hours": 14.0, "blocks_count": 4, "emergency": true  }
  ]
}
```

Тільки **дні з даними**. Якщо клієнту потрібні «дірки», їх можна порахувати окремо через `/coverage`.

---

### `GET /api/stats/heatmap`

Теплова мапа за 24 години доби + типове вікно вимкнень.

```json
{
  "channel_id": 1, "queue": "1.1", "from": "...", "to": "...",
  "hours": [12.5, 15.0, 22.0, ...],   // 24 числа: % днів, коли в цю годину не було світла
  "worst_hour": 19,
  "best_hour": 4,
  "days_count": 45,
  "typical_window": {
    "avg_first_off": "08:30",
    "avg_last_on": "22:00",
    "avg_dominant_start": "14:00",
    "avg_dominant_end": "18:30",
    "days_with_outage": 42
  }
}
```

**Як рахуються `hours[h]`:** для кожного дня `hourly_mask[h]` ∈ [0..1] — частка години без світла. Сумуємо по днях, ділимо на `days_count`, множимо на 100 — отримуємо «% днів, коли в цю годину гасло».

**`typical_window`:**

- `avg_first_off` — середній час **першого** вимкнення дня;
- `avg_last_on` — середній час **останнього** повернення світла;
- `avg_dominant_start/end` — межі найдовшого блоку за день, усереднені.

---

### `GET /api/stats/weekday`

Середній час без світла по днях тижня (Пн–Нд).

```json
{
  "channel_id": 1, "queue": "1.1", "from": "...", "to": "...",
  "weekdays": [
    { "weekday": 0, "name": "Пн", "avg_off_hours": 12.3, "days_count": 7 },
    { "weekday": 1, "name": "Вт", "avg_off_hours": 10.1, "days_count": 6 },
    ...
  ],
  "worst_weekday": 4,
  "best_weekday": 6
}
```

`worst_weekday` / `best_weekday` ігнорують дні тижня з `days_count === 0`.

---

### `GET /api/stats/buckets`

Розподіл годин без світла за 4 періодами доби:

| Bucket | Вікно |
|--------|-------|
| `morning` | 06:00–12:00 |
| `day` | 12:00–18:00 |
| `evening` | 18:00–22:00 |
| `night` | 22:00–06:00 (склейка двох вікон) |

```json
{
  "channel_id": 1, "queue": "1.1", "from": "...", "to": "...",
  "morning": 2.5,
  "day": 3.1,
  "evening": 2.8,
  "night": 1.2,
  "total_days": 45
}
```

Числа — **середнє годин без світла в цьому проміжку за добу**.

---

### `GET /api/stats/queues`

Розбивка статистики по всіх чергах міста + список доступних черг.

```json
{
  "channel_id": 1, "from": "...", "to": "...",
  "queues": [
    {
      "queue": "1.1",
      "avg_off_hours": 12.3,
      "total_off_hours": 369.0,
      "reliability_percent": 48.75,
      "days_with_data": 30
    },
    { "queue": "1.2", ... }
  ],
  "available_queues": ["1.1", "1.2", "2.1", "2.2", "3.1", "3.2"]
}
```

`days_with_data` тут — скільки днів **мають цю конкретну чергу**.

---

### `GET /api/stats/cities`

Зведення по **всіх містах одразу** — для рейтингу/таблиці. Сортується за `reliability_percent` спадаюче.

```
GET /api/stats/cities?from=2026-04-01&to=2026-04-30
```

```json
{
  "from": "...", "to": "...",
  "cities": [
    {
      "channel_id": 4,
      "city_name": "Харківська область",
      "avg_off_hours_per_day": 6.2,
      "total_off_hours": 186.0,
      "reliability_percent": 74.17,
      "emergency_days_count": 0,
      "days_with_data": 30
    },
    ...
  ]
}
```

Внутрішньо робить `loadHistoryRange` + `computeSummary` для кожного міста паралельно через `Promise.all`. Результати кешуються одним записом.

---

### `GET /api/stats/coverage`

Діагностика прогалин: скільки днів очікувалось і скільки реально є в БД.

```json
{
  "channel_id": 1, "from": "...", "to": "...",
  "expected_days": 30,
  "days_with_data": 24,
  "coverage_percent": 80.0,
  "missing_dates": ["2026-04-12", "2026-04-13", "2026-04-19", ...]
}
```

---

### `GET /api/stats/queues-list`

Перелік усіх черг, що зустрічались для міста за період.

```json
{
  "channel_id": 1, "from": "...", "to": "...",
  "available_queues": ["1.1", "1.2", "2.1", "2.2", "3.1", "3.2"]
}
```

На відміну від `/queues`, тут немає метрик — лише список рядків.

---

### `GET /api/stats/day`

Розклад на конкретну дату. Якщо `queue` задана — повертає лише її; інакше всі черги.

```
GET /api/stats/day?channel_id=1&date=2026-04-10
```

```json
{
  "channel_id": 1,
  "date": "2026-04-10",
  "schedule_time": "08:30:12",
  "emergency_outages": false,
  "queues": [
    { "queue": "1.1", "periods": ["08:00-12:00", "18:00-22:00"], "off_hours": 8.0 },
    { "queue": "1.2", "periods": ["00:00-04:00", "14:00-18:00"], "off_hours": 8.0 }
  ]
}
```

`off_hours` для кожної черги рахується без merge (адже в межах однієї черги перекриттів зазвичай немає) — простою сумою тривалостей.

---

## Кешування

| Параметр | Значення |
|----------|----------|
| Сховище | `Map<string, { value, expiresAt }>` у пам'яті процесу |
| TTL | **5 хвилин** (`CACHE_TTL_MS = 5 * 60 * 1000`) |
| Ключ | `req.path + "?" + URLSearchParams(req.query)` |
| Інвалідація | Тільки за TTL. Перезапуск процесу очищає кеш. |
| Multi-process | Кожен процес має свій кеш (це ок, обчислення дешеві) |

Cache key враховує **всі параметри запиту**, тому `?queue=1.1` і `?queue=1.2` — це два окремі записи. `?from=A&to=B` і `?from=B&to=A` — теж окремі (різні рядки query).

---

## Помилки та валідація

| Код | Коли | Тіло |
|-----|------|------|
| `400` | Не передано `channel_id` | `{ "error": "channel_id параметр обов'язковий" }` |
| `400` | `/day` без `date` | `{ "error": "date параметр обов'язковий (YYYY-MM-DD)" }` |
| `404` | За період даних у БД немає | `{ "error": "Дані за вказаний період (X — Y) відсутні" }` (або `Дані за X відсутні`, якщо `from === to`) |
| `404` | `/day` без знайденого документа | `{ "error": "Даних за X не знайдено" }` |
| `500` | Внутрішня помилка | `{ "error": "Internal server error" }` (логується в консоль) |

Помилки кидаються до Express через `wrap()`-обгортку — будь-який `throw` всередині async-handler ловиться і йде в `next(err)`.

---

## Розширення: як додати нову метрику

1. **Інтерфейс.** Додай тип у `src/stats/types.ts`:

   ```ts
   export interface MyMetric {
     foo: number;
     bar: string[];
   }
   ```

2. **Обчислення.** Напиши функцію в `src/stats/computations.ts`:

   ```ts
   export function computeMyMetric(entries: ScheduleEntry[], queue?: string): MyMetric {
     const daily = entries.map(e => computeDailyStat(e, queue));
     // ...
     return { foo: ..., bar: [...] };
   }
   ```

   Використовуй `getMergedIntervals` / `computeDailyStat` / `overlapWithRange` з `utils.ts` — не дублюй парсинг.

3. **Ендпоінт.** Додай у `src/stats/routes.ts`:

   ```ts
   router.get("/api/stats/my-metric",
     statsRoute(db, (entries, q) => computeMyMetric(entries, q.queue))
   );
   ```

   `statsRoute()` сам подбає про валідацію, завантаження даних, кеш та обгортку відповіді.

4. **Реекспорт.** Якщо метрика потрібна іншим модулям — додай у `src/stats/index.ts`.

5. **Готово.** Кеш TTL стартує автоматично для нового path.

---

## Залежності та фоновий контекст

Цей модуль читає дані, які наповнює окрема підсистема:

- **Telegram-парсер** (`src/fetcher.ts`, `src/parser.ts`) — щ15 хв збирає графіки з каналів обленерго.
- **MongoDB** — зберігає `schedules_today`, `schedules_history`, `cities`.
- **Express-планувальник** (`src/app.ts`) — піднімає API, реєструє `createStatsRoutes(db)`.

Інструкції із запуску сервера, налаштування Telegram-API, конфігурації MongoDB та опису парсера — див. в окремій документації проєкту (`backend-js/README.md` або відповідні файли у `src/`). Цей файл сфокусовано лише на **логіці модуля статистики**.

### Швидкий старт (тільки те, що потрібно для статистики)

```powershell
cd backend-js
npm install
npm start                    # MongoDB має бути запущена окремо
# або:
npm run start:all            # піднімає mongod + API
```

Перевір:

```bash
curl "http://localhost:5000/api/stats/summary?channel_id=1&from=2026-01-01&to=2026-12-31"
```

Якщо БД порожня → отримаєш `404 Дані за вказаний період (...) відсутні`. Заповни її парсером (`npm run fetch`) або міграцією з історичних JSON.
