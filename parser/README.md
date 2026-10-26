# parser — Python-парсер розкладів (етап 1)

Headless-воркер: читає Telegram-канали обленерго, парсить графіки погодинних
відключень і пише їх у MongoDB. **Без вхідних портів** — назовні не слухає нічого.

Статус: не почато. План — див. `plan-stage-1` у пам'яті проєкта.

## Стек
Python 3.12 · uv · Telethon · pydantic-settings · structlog
ruff · mypy --strict · pytest + hypothesis + testcontainers

## Структура (цільова)
```
src/lightua_parser/
  domain/     чисті функції парсингу — без Telethon і Mongo, тестуються без мережі
  adapters/   telegram/, mongo/
  app.py      композиція
tests/
  golden/     корпус реальних повідомлень + еталонні результати (задача 0.6)
```

## Правила
- Секрети — тільки через env і secret-файли, ніколи в образ чи git.
- Домен не імпортує адаптери. Порушення = червоний CI.
- Старий `backend-js/` — чорновик поведінки, не зразок коду.
