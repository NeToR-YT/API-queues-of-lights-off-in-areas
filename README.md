# Backend: Графіки відключень — Приклад

Мета: зберегти лише бекенд та невеликий тестовий фронтенд, щоб швидко перевіряти роботу сервісу.

Коротко:
- Сервер: Flask + APScheduler
- Розміщено в `backend/`
- Тестовий фронтенд: `backend/templates/index.html` (доступний за `/`)
- Дані історії: `backend/schedule_history.json`

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

Конфігурація Telegram fetcher (опціонально):
- Щоб активувати збір повідомлень з каналу Telegram, створіть `backend/config.json` на основі `backend/config.example.json` і заповніть `api_id` та `api_hash`.
- `backend/fetcher.py` — безпечний placeholder. Ви можете перенести логіку з `test.py` у `backend/fetcher.py` і використовувати `config.json` для секретів.

Файли та структура:
- `backend/app.py` — головний Flask додаток
- `backend/fetcher.py` — фоновий/помічний скрипт для оновлення `schedule_history.json`
- `backend/schedule_history.json` — збережена історія (для прикладу вже заповнена)
- `backend/db/` — допоміжні JSON файли

Якщо потрібно, допоможу:
- поставити робочий Telethon fetcher без закладених секретів
- додати Dockerfile або gunicorn-конфіг
- написати прості тести для API

