# Backend: Графіки відключень

Коротко:
- Сервер: Flask + APScheduler
- Тестовий фронтенд: `templates/index.html`
- Дані історії: `schedule_history.json`, `schedule_today.json`

Швидкий старт (Windows):

1. Створіть віртуальне середовище і активуйте його:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

2. Встановіть залежності:

```powershell
pip install -r requirements.txt
```

3. Запустіть сервер:

```powershell
python backend\app.py
```

4. Відкрийте в браузері: http://127.0.0.1:5000

Конфігурація Telegram fetcher:
- Щоб активувати збір повідомлень з каналу Telegram, створіть `backend/config.json` на основі `backend/config.example.json` і заповніть `api_id` та `api_hash`.

Файли та структура:
- `backend/app.py` — головний Flask додаток
- `backend/fetcher.py` — фоновий/помічний скрипт для оновлення `schedule_history.json`
- `backend/schedule_history.json` — збережена історія (для прикладу вже заповнена)

Frontend:
Щоб активувати збір повідомлень з каналу Telegram, створіть backend/config.json на основі backend/config.example.json і заповніть api_id та api_hash.

Файли та структура:
backend/app.py — головний Flask додаток

backend/fetcher.py — фоновий/помічний скрипт для оновлення schedule_history.json, schedule_today.json та schedule_tomorrow.json

backend/schedule_history.json — збережена історія (для прикладу вже заповнена)

Запуск самого сайту
Відкрийте термінал безпосередньо в репозиторії light-ua

Виконайте наступні команди:

npm install  
npm run dev
Відкрийте в браузері: http://localhost:5173/****
