# parser: Python-парсер розкладів

Фоновий процес без вхідних портів. Читає Telegram-канали обленерго, розбирає графіки
погодинних відключень і пише їх у MongoDB.

Стан: готові каркас, модель даних (`docs/contracts/`, ADR-0003) і логіка розбору постів.
Далі адаптери Telegram і MongoDB.

## Перевірки

```bash
uv sync
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run pytest
```

## Стек

Python 3.12, uv, Telethon, pydantic-settings, structlog.
Перевірки: ruff, mypy --strict, pytest, hypothesis, testcontainers.

## Структура

```
src/lightua_parser/
  domain/     розбір постів: чисті функції без Telethon і Mongo, тестуються без мережі
  adapters/   telegram/, mongo/
  app.py      збирає все докупи
tests/
  golden/     реальні й синтетичні пости з еталонними результатами
```

## Правила

- Секрети передаються лише через змінні оточення та secret-файли, ніколи не потрапляють в образ чи git.
- Домен не імпортує адаптери. Тест `test_architecture.py` стежить за цим.
- Старий `backend-js/` показує, як парсер має поводитись, але не є зразком коду.
