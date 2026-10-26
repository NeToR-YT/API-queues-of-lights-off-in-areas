# Деплой TS-бети з HTTPS (Tailscale Funnel)

Розгортає поточну версію (`backend-js` + `frontend` + Mongo) на домашньому ARM-сервері
і відкриває її публічно по HTTPS **без домену, без пробросу портів і без витрат**.

```
інтернет ──HTTPS──▶ Tailscale Funnel ──▶ 127.0.0.1:8080 nginx ──▶ backend:5001 ──▶ mongo
                    (TLS-сертифікат)      (статика + /api)        (лише compose-мережа)
```

Назовні не відкритий жоден порт: nginx слухає тільки localhost, бекенд і Mongo — тільки
внутрішню мережу compose. Публічна адреса буде виду `https://<сервер>.<tailnet>.ts.net`.

---

## 0. Перед початком

```bash
cd /opt/light-ua          # або де лежить репо (див. deploy/README.md)
free -h                   # скільки RAM — від цього ліміт Mongo в docker-compose.yml
ss -ltnp | grep -E ':8080\b' || echo "8080 вільний"
```

> Якщо RAM менше 2 ГБ — лиш `--wiredTigerCacheSizeGB 0.25` як є. Від 4 ГБ можна підняти до 0.5–1.

## 1. Забрати код, не втративши конфіг

⚠️ `backend-js/config.json` більше не відстежується git. Після переходу на новий код (`git checkout`) git **видалить його**
з робочого дерева — а там канали. Спершу копія:

```bash
cp backend-js/config.json ~/config.json.backup
git fetch origin --tags
git checkout v0.9.0                # прод деплоїться лише з тегу (CONTRIBUTING.md)
cp ~/config.json.backup backend-js/config.json
```

## 2. Секрети за новою схемою

Ключі — у `.env`, сесія — в окремому файлі, `config.json` — без секретів.

```bash
cp .env.example .env
nano .env                                   # TG_API_ID, TG_API_HASH

mkdir -p backend-js/secrets
nano backend-js/secrets/session.txt         # session_string одним рядком (або порожньо → новий вхід)
nano backend-js/config.json                 # видалити api_id, api_hash, session_string

# Контейнер працює не від root, а від користувача node (uid 1000).
sudo chown -R 1000:1000 backend-js/secrets
chmod 700 backend-js/secrets && chmod 600 backend-js/secrets/session.txt
```

> Після ротації акаунта (задача 0.1, `docs/stage-0-runbook.md`) сюди йдуть **нові** значення,
> а `session.txt` лишається порожнім — сесію створить перший вхід:
> `docker compose run --rm -it backend node dist/app.js`

## 3. Зібрати й підняти

Образи збираються прямо на сервері, тобто нативно під ARM.

```bash
docker compose build
docker compose up -d
docker compose ps                 # backend має стати (healthy) за ~1 хв
docker compose logs -f backend    # чекати "API listening on port 5001"
```

Локальна перевірка, ще до HTTPS:

```bash
curl -s http://127.0.0.1:8080/api/status
curl -s http://127.0.0.1:8080/api/cities | head -c 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8080/api/update   # має бути 403
```

## 4. HTTPS через Tailscale Funnel

Безкоштовний акаунт Tailscale; ставиться на хост, не в контейнер.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up                       # відкрити посилання, увійти
sudo tailscale funnel --bg 8080         # якщо Funnel/HTTPS ще не ввімкнені в tailnet —
                                        # команда дасть посилання на адмінку, ввімкнути і повторити
tailscale funnel status                 # тут публічна https-адреса
```

`--bg` зберігає налаштування: після перезавантаження сервера Funnel підніметься сам.

Перевірка **ззовні** — з телефона на мобільному інтернеті, не з домашнього Wi-Fi:
`https://<адреса>.ts.net/` і `https://<адреса>.ts.net/api/status`.

## 5. Автозапуск

systemd-юніт `deploy/light-ua.service` робить `docker compose up -d` з `/opt/light-ua`.
Тепер він піднімає **і фронт** (раніше фронт був за профілем `prod` і юніт його не стартував).

```bash
sudo cp deploy/light-ua.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable light-ua
```

> Якщо на сервері встановлений старий юніт `gpv-api.service` (з `upbackend on server.txt`) —
> вимкнути його, щоб два юніти не воювали за один compose:
> `sudo systemctl disable --now gpv-api`

---

## Щоденне

```bash
# Оновити до нового релізу
git fetch --tags && git checkout v0.9.1 && docker compose up -d --build

# Ручний запуск парсингу (ззовні закритий, тільки з сервера)
docker compose exec backend wget -qO- --post-data='' http://127.0.0.1:5001/api/update

# Скільки їсть кожен контейнер
docker stats --no-stream
```

## Відкат

```bash
docker compose down
git checkout <попередній тег>                         # або 4a41c35 — стан до v0.9.0
cp ~/config.json.backup backend-js/config.json       # конфіг із секретами — як було
docker compose up -d --build
sudo tailscale funnel --bg off                       # якщо треба прибрати публічний доступ
```

Дані Mongo в томі `mongo_data` при цьому не чіпаються.

## Перехід на власний домен (колись)

Funnel вимикається (`tailscale funnel --bg off`), у compose порт фронту стає `443:443`,
у `nginx.conf` — `listen 443 ssl` + сертифікат Let's Encrypt (certbot, DNS-01).
Решта ланцюжка не змінюється.
