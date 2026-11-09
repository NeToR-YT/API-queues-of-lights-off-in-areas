# deploy — експлуатація

| Файл | Призначення |
|---|---|
| `light-ua.service` | systemd-юніт: піднімає docker compose з `/opt/light-ua` |

`docker-compose.yml` і `nginx.conf` поки лежать у корені репозиторію —
сервер робить checkout релізного тегу і піднімає стек звідти. Переносити їх сюди
будемо разом із деплоєм V1 (задача 2.8), щоб не ламати робочу бету.

## Як розгорнути

Покроково з HTTPS — **`docs/deploy.md`**.

## Секрети на сервері
`.env` і `backend-js/secrets/` створюються на сервері вручну і в git не потрапляють.
Шаблони: `.env.example`, `backend-js/config.example.json`.
