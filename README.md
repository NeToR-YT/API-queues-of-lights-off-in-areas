# API Графіків Погодинних Відключень (ГПВ)

Система для автоматичного збору та зберігання графіків відключень електроенергії з Telegram каналів українських обласних енергокомпаній.

## Коротко

- **Сервер**: Express REST API + node-cron
- **Парсинг**: GramJS для асинхронного збору даних з Telegram
- **База даних**: MongoDB
- **Автоматизація**:
  - Запуск парсера при старті API
  - Автоматичні оновлення кожні 15 хвилин
  - Ручне оновлення через API endpoint
- **Батч-парсинг**: Обробляє канали пачками з налаштованими перервами
- **Інтелектуальний пошук**: Шукає сьогодні + завтра одночасно, з fallback на найсвіжіші дані

## Структура проекту

```
├── backend-js/
│   ├── src/
│   │   ├── app.js              # Express API сервер + планувальник
│   │   ├── fetcher.js          # Telegram парсер з batch-обробкою
│   │   ├── parser.js           # Функції парсингу дат, черг і проміжків
│   │   ├── routes.js           # API маршрути
│   │   ├── db.js               # MongoDB підключення та індекси
│   │   ├── config.js           # Завантаження конфігурації
│   │   ├── start-all.js        # Запуск MongoDB + API разом
│   │   └── migrate-from-python.js  # Міграція даних зі старих JSON файлів
│   ├── templates/
│   │   └── index.html          # Тестовий фронтенд
│   ├── cities.json             # Список міст (використовується для seed)
│   ├── config.json             # Конфігурація (створити з config.example.json)
│   └── package.json
└── README.md
```

## Швидкий старт

### 1. Встановлення залежностей

```powershell
cd backend-js
npm install
```

### 2. Конфігурація

Створіть `backend-js/config.json`:

```json
{
  "api_id": "ваш_api_id",
  "api_hash": "ваш_api_hash",
  "session_string": "",
  "channels": [
    { "id": 1, "name": "Черкаси",    "username": "pat_cherkasyoblenergo" },
    { "id": 2, "name": "Запоріжжя", "username": "Zaporizhzhyaoblenergo_news" },
    { "id": 3, "name": "Миколаїв",  "username": "mk_energy_ua" },
    { "id": 4, "name": "Харків",    "username": "kharkivenergy" }
  ],
  "batch_parser": {
    "batch_size": 2,
    "batch_delay": 5,
    "limit_messages": 50
  },
  "timezone_offset": 2,
  "mongodb_uri": "mongodb://127.0.0.1:27017",
  "mongodb_db": "queues"
}
```

**Параметри:**
| Поле | Опис |
|------|------|
| `api_id`, `api_hash` | Telegram API credentials (отримати на https://my.telegram.org/) |
| `session_string` | Рядок сесії GramJS (заповнюється автоматично при першому запуску) |
| `channels` | Список каналів для парсування |
| `batch_size` | Кількість каналів в одній пачці |
| `batch_delay` | Пауза між пачками (секунди) |
| `limit_messages` | Максимальна кількість повідомлень для перевірки на канал |
| `timezone_offset` | Часовий пояс (2 для UTC+2, Україна) |
| `mongodb_uri` | URI підключення до MongoDB |
| `mongodb_db` | Назва бази даних |

**Де отримати `api_id` та `api_hash`:**
1. Перейдіть на https://my.telegram.org/
2. Увійдіть вашим номером телефону
3. Перейдіть на "API development tools"
4. Скопіюйте `api_id` та `api_hash`

### 3. Запуск

#### Варіант A — MongoDB вже запущений окремо

```powershell
npm start
```

#### Варіант B — запустити MongoDB і API разом

```powershell
npm run start:all
```

За замовчуванням `start:all` запускає `mongod` з папки `backend-js/db`. Можна налаштувати в `config.json`:

```json
{
  "mongodb_data_path": "./db",
  "mongodb_bin": "mongod",
  "mongodb_port": 27017
}
```

Сервер запуститься на `http://127.0.0.1:5001`.

### 4. Перший запуск та авторизація Telegram

При першому запуску парсер запитає авторизацію у терміналі:

```
Phone number: +380XXXXXXXXX
Code: 12345
Password (if enabled): ****
```

Після успішної авторизації `session_string` автоматично збережеться у `config.json`. Наступні запуски авторизації не потребують.

## Команди

```powershell
npm start           # запустити тільки API (MongoDB має бути вже запущений)
npm run start:all   # запустити MongoDB + API разом
npm run fetch       # запустити парсер вручну (без API)
npm run start:db    # запустити тільки MongoDB
npm run migrate:python [шлях]  # мігрувати дані зі старих JSON файлів
```

### Міграція даних

Якщо у вас є попередні дані у JSON форматі:

```powershell
npm run migrate:python          # шукає ../backend за замовчуванням
npm run migrate:python C:\path\to\backend   # або вкажіть шлях
```

## API Маршрути

Базова URL: `http://localhost:5001`

---

### `GET /api/status`

Статус останнього оновлення парсера.

```json
{
  "last_update": {
    "timestamp": "2026-05-06T14:30:45.000Z",
    "status": "success",
    "message": "Дані оновлено успішно!"
  },
  "parsing_in_progress": false,
  "auto_update_interval_minutes": 15
}
```

---

### `POST /api/update`

Запустити ручне оновлення. Повертає одразу, парсер працює у фоні.

```bash
curl -X POST http://localhost:5001/api/update
```

```json
{
  "status": "started",
  "message": "Оновлення запущено",
  "last_update": { ... }
}
```

---

### `GET /api/cities`

Список всіх міст.

```json
{
  "cities": [
    { "id": 1, "name": "Черкаси" },
    { "id": 2, "name": "Запоріжжя" }
  ]
}
```

---

### `GET /api/schedules/today`

Графік на сьогодні для міста.

**Параметри:**
- `channel_id` _(обов'язковий)_ — ID міста
- `queue` _(опціональний)_ — номер черги, наприклад `1.1`

```
GET /api/schedules/today?channel_id=1&queue=1.1
```

```json
{
  "channel_id": 1,
  "city_name": "Черкаси",
  "date": "2026-05-06",
  "time": "20:57:33",
  "schedule": {
    "1.1": ["01:00-04:30", "06:30-10:30", "13:00-16:30", "18:30-22:30"]
  },
  "emergency_outages": false
}
```

---

### `GET /api/schedules/tomorrow`

Графік на завтра для міста. Параметри ті самі.

```
GET /api/schedules/tomorrow?channel_id=1
```

---

### `GET /api/schedules`

Графік на конкретну дату з історії.

**Параметри:**
- `channel_id` _(обов'язковий)_
- `date` _(обов'язковий)_ — формат `YYYY-MM-DD`
- `queue` _(опціональний)_

```
GET /api/schedules?channel_id=1&date=2026-05-05&queue=1.1
```

## Структура даних у MongoDB

### Колекція `schedules_today` / `schedules_tomorrow`

```json
{
  "channel_id": 1,
  "schedule_date": "2026-05-06",
  "schedule_time": "20:57:33",
  "schedule": {
    "1.1": ["01:00-04:30", "06:30-10:30"],
    "1.2": ["02:00-05:30", "07:30-11:30"]
  },
  "emergency_outages": false
}
```

### Колекція `schedules_history`

```json
{
  "channel_id": 1,
  "schedule_date": "2026-05-05",
  "schedule_time": "22:30:19",
  "schedule": {
    "1.1": ["00:00-04:00", "06:00-10:30"],
    "1.2": ["01:00-05:30", "07:00-11:00"]
  },
  "emergency_outages": true
}
```

### Колекція `cities`

```json
{ "id": 1, "name": "Черкаси" }
```

## Batch-парсинг та пошук графіків

### Як це працює

Парсер обробляє Telegram канали пачками для запобігання блокування IP:

1. Ділить канали на пачки за `batch_size`
2. Кожну пачку обробляє послідовно
3. Чекає `batch_delay` секунд перед наступною пачкою

### Пошук графіків

Для кожного каналу парсер:
- Переглядає останні `limit_messages` повідомлень
- Шукає графіки **на сьогодні** та **на завтра** одночасно
- Якщо не знайде — використовує найсвіжіший доступний графік як fallback
- Зливає перекриваючі часові проміжки для кожної черги

**Приклад:** 4 канали, `batch_size=2`, `batch_delay=10`:
1. Обробити канали 1–2 → чекати 10 сек
2. Обробити канали 3–4

## Формати парсингу

Парсер підтримує різні формати повідомлень ГПВ:

**Формат 1:**
```
1.1: 03:00 - 08:00, 12:00 - 17:00, 21:00 - 24:00
1.2: 03:00 - 08:00, 12:00 - 17:00, 21:00 - 24:00
```

**Формат 2 (з emoji):**
```
🔹1.1: 00:00 – 05:00, 09:00 – 14:00, 18:00 – 23:00
🔹1.2: 00:00 – 05:00, 09:00 – 14:00, 18:00 – 23:00
```

**Формат 3 (крапка з комою):**
```
1.1 – 00:00 - 01:30; 05:00 - 08:30; 12:00 - 15:30
1.2 – 01:30 - 08:30; 12:00 - 15:30; 19:00 - 22:30
```

**Підтримувані формати дат:** `12 травня`, `12.05`, `12/05/2026`

## Розв'язання проблем

### "No config.json found"
Створіть `backend-js/config.json` за прикладом вище.

### "Missing required config values"
Перевірте, що в `config.json` є `api_id`, `api_hash` та `channels`.

### MongoDB binary not found
Встановіть MongoDB або вкажіть шлях до `mongod` у `config.json`:
```json
{ "mongodb_bin": "C:\\Program Files\\MongoDB\\Server\\7.0\\bin\\mongod.exe" }
```

### Немає даних на сьогодні
- Запустіть `npm run fetch` вручну
- Перевірте підключення до Telegram
- Перевірте доступ до каналів у конфігурації
- Виконайте `POST /api/update` через API

### `schedules_tomorrow` пустий
Нормально — канали ще не опублікували графіки на завтра. Дані з'являться автоматично після публікації.

### Блокування IP при парсингу
- Збільште `batch_delay`
- Зменште `batch_size`
- Зменште `limit_messages`

## Залежності

- **express** — REST API сервер
- **node-cron** — планувальник автоматичних оновлень
- **telegram** (GramJS) — асинхронний Telegram MTProto клієнт
- **mongodb** — драйвер для MongoDB

## Контакт

Покищо немає :)
