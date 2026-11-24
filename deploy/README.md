# deploy: експлуатація

| Файл | Призначення |
|---|---|
| `light-ua.service` | systemd-юніт, піднімає docker compose з `/opt/light-ua` |
| `remote-deploy.sh` | серверна частина деплою з GitHub Actions, ставиться в `/usr/local/bin/light-ua-deploy` |
| `compose.dev.yml` | доповнення compose для dev-середовища в `/opt/light-ua-dev` |

`docker-compose.yml`, `nginx.conf` і `Caddyfile` поки лежать у корені репозиторію: сервер
перемикається на релізний тег і запускає стек звідти.

Покрокове розгортання з HTTPS описане в [`docs/deploy.md`](../docs/deploy.md).

## Секрети на сервері

`.env` і `backend-js/secrets/` створюються на сервері вручну й у git не потрапляють.
Шаблони: `.env.example` і `backend-js/config.example.json`.
