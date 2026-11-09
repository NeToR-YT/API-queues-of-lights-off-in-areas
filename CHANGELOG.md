# Changelog

Формат — [Keep a Changelog](https://keepachangelog.com/uk/1.1.0/), версії — [SemVer](https://semver.org/lang/uk/).
До `v1.0.0` (Python V1) контракт ще може змінюватись.

## [0.10.0] — 2026-11-09

Хостинг переїжджає з домашнього сервера в Oracle Cloud; репозиторій готовий до публічності;
закладено основу Python-парсера.

### Added
- HTTPS через Caddy з автоматичним сертифікатом Let's Encrypt; домен — змінна `DOMAIN` у `.env`.
- Python-парсер (`parser/`): домен розбору постів перенесено з прототипу з доробками TS-парсера;
  на синтетичному golden-наборі з 27 постів результат збігається з TS-парсером.
- Модель даних v2: JSON Schema для `schedules`, `parse_state`, `heartbeat` і ADR-0003.
- README з описом проєкта, ліцензія MIT.

### Changed
- Деплой — на Oracle Cloud Always Free (ARM) замість домашнього сервера; runbook `docs/deploy.md`.
- nginx бере адресу клієнта з `X-Forwarded-For`, тож rate limit знову рахується на клієнта.
- Контейнер фронту більше не публікується на хост — лише через Caddy.
- Кеш Mongo — 1 ГБ.
- Специфікацію stats-модуля перенесено в `docs/stats-api.md`.

### Removed
- Налаштування Tailscale Funnel.
- Копія Python-прототипу й старі JSON у `frontend/public`, невикористаний `stats-routes.ts`,
  застарілі нотатки розгортання, порожній кореневий `package-lock.json`.

### Security
- Заголовок `X-Powered-By` більше не віддається.

### Fixed
- Еталони golden-корпусу: пост розбирається, якщо спрацювала будь-яка з двох ознак, як у самому парсері.

## [0.9.0] — 2026-10-26

Перший версіонований реліз: поточна TS-бета, готова до публічного хостингу по HTTPS.

### Security
- Telegram-секрети винесено з git: ключі — у `.env`, сесія — у `backend-js/secrets/session.txt`;
  `config.json` більше не містить секретів і не відстежується.
- `POST /api/update` закрито ззовні (403 на nginx) — захист Telegram-акаунта від flood-бану.
- Бекенд недоступний напряму, лише через nginx; nginx слухає тільки localhost (HTTPS дає Tailscale Funnel).
- Контейнер бекенда працює не від root; `.dockerignore` не пускає секрети в образ.
- Rate limit на `/api/`, заголовки безпеки, `server_tokens off`.

### Changed
- Node 20 (EOL) → Node 22 у Docker-образі.
- Фронт збирається всередині власного образу і стартує без профілю `prod` (systemd тепер його піднімає).
- Кеш Mongo обмежено 256 МБ; логи контейнерів ротуються.
- Файли Python-прототипу з `frontend/public` більше не потрапляють у збірку.

### Added
- CI: перевірка секретів (gitleaks), збірка бети, заготовки джоб для Python-сервісів.
- Утиліти golden-корпусу для перенесення парсера на Python (`npm run corpus:export|corpus:expected`).
- Git-флоу проєкта (`CONTRIBUTING.md`), ADR-0001/0002, runbook-и деплою й ротації.

[0.10.0]: https://github.com/NeToR-YT/API-queues-of-lights-off-in-areas/releases/tag/v0.10.0
[0.9.0]: https://github.com/NeToR-YT/API-queues-of-lights-off-in-areas/releases/tag/v0.9.0
