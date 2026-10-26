# Changelog

Формат — [Keep a Changelog](https://keepachangelog.com/uk/1.1.0/), версії — [SemVer](https://semver.org/lang/uk/).
До `v1.0.0` (Python V1) контракт ще може змінюватись.

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

[0.9.0]: https://github.com/NeToR-YT/API-queues-of-lights-off-in-areas/releases/tag/v0.9.0
