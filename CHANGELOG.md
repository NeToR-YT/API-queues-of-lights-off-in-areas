# Changelog

Формат за [Keep a Changelog](https://keepachangelog.com/uk/1.1.0/), версії за [SemVer](https://semver.org/lang/uk/).
До `v1.0.0` контракт API ще може змінюватися.

## [0.10.0] - 2026-11-09

Сервер переїжджає з дому в Oracle Cloud, репозиторій підготовлено до публікації, закладено
основу Python-парсера.

### Added
- HTTPS через Caddy з автоматичним сертифікатом Let's Encrypt. Домен задається змінною `DOMAIN` у `.env`.
- Python-парсер (`parser/`): логіку розбору постів перенесено з прототипу разом із доробками
  TS-парсера. На синтетичному наборі з 27 постів результат збігається з TS-парсером.
- Модель даних v2: JSON Schema для `schedules`, `parse_state`, `heartbeat` і ADR-0003.
- README з описом проєкту, ліцензія MIT.

### Changed
- Розгортання на Oracle Cloud Always Free (ARM) замість домашнього сервера, інструкція в `docs/deploy.md`.
- nginx бере адресу клієнта з `X-Forwarded-For`, тому rate limit знову рахується для кожного клієнта окремо.
- Контейнер фронтенду більше не відкритий на хості, доступ лише через Caddy.
- Кеш MongoDB збільшено до 1 ГБ.
- Специфікацію модуля статистики перенесено в `docs/stats-api.md`.

### Removed
- Налаштування Tailscale Funnel.
- Копія Python-прототипу й старі JSON у `frontend/public`, невикористаний `stats-routes.ts`,
  застарілі нотатки про розгортання, порожній кореневий `package-lock.json`.

### Security
- Заголовок `X-Powered-By` більше не віддається.

### Fixed
- Еталони golden-корпусу: пост розбирається, якщо спрацювала будь-яка з двох ознак, як і в самому парсері.

## [0.9.0] - 2026-10-26

Перший версіонований реліз: TypeScript-бета, готова до публічного хостингу по HTTPS.

### Security
- Ключі Telegram винесено з git у `.env`, сесію в `backend-js/secrets/session.txt`.
  `config.json` більше не містить секретів і не відстежується.
- `POST /api/update` закрито ззовні (nginx відповідає 403), щоб ніхто не міг запускати
  парсинг у циклі й підставити акаунт під бан.
- Бекенд недоступний напряму, лише через nginx.
- Контейнер бекенду працює не від root, `.dockerignore` не пускає секрети в образ.
- Rate limit на `/api/`, заголовки безпеки, `server_tokens off`.

### Changed
- Node 20 (підтримку завершено) замінено на Node 22 у Docker-образі.
- Фронтенд збирається у власному образі й стартує без профілю `prod`, тож systemd тепер його запускає.
- Кеш MongoDB обмежено до 256 МБ, логи контейнерів ротуються.
- Файли Python-прототипу з `frontend/public` більше не потрапляють у збірку.

### Added
- CI: перевірка секретів (gitleaks), збірка бекенду, заготовки для Python-сервісів.
- Утиліти golden-корпусу для перенесення парсера на Python (`npm run corpus:export` і `corpus:expected`).
- Правила роботи з git (`CONTRIBUTING.md`), ADR-0001 і ADR-0002, інструкції з розгортання.

[0.10.0]: https://github.com/NeToR-YT/API-queues-of-lights-off-in-areas/releases/tag/v0.10.0
[0.9.0]: https://github.com/NeToR-YT/API-queues-of-lights-off-in-areas/releases/tag/v0.9.0
