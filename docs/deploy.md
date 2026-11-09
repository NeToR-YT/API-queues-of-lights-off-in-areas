# Деплой на Oracle Cloud (Always Free) з HTTPS

Розгортає стек (`backend-js` + `frontend` + Mongo) на безкоштовному ARM-сервері Oracle і
відкриває його по HTTPS із сертифікатом Let's Encrypt.

```
інтернет ──HTTPS :443──▶ Caddy ──▶ nginx :80 ──▶ backend :5001 ──▶ mongo
                         (TLS, сертифікат)  (статика, /api,        (усе — лише
                                             403 на /api/update,     compose-мережа)
                                             rate limit)
```

Назовні відкриті лише 80 і 443, і обидва — на Caddy. Порт 80 потрібен Let's Encrypt
для перевірки домену й перенаправляє на HTTPS.

---

## 1. Акаунт і сервер Oracle

1. Зареєструватися на https://www.oracle.com/cloud/free/ — картка лише для верифікації.
   **Home region обирається один раз і назавжди**; безкоштовний сервер створюється тільки в ньому.
   Популярні регіони (Франкфурт) часто без вільних ARM-потужностей — тоді «Out of host capacity»,
   і допомагає лише інший регіон або повторні спроби пізніше.
2. *(Рекомендовано)* Billing → **Upgrade to Pay As You Go**. У межах безкоштовних лімітів це
   так само безплатно, але знімає ризик, що Oracle забере «простоюючий» сервер. Одразу
   налаштуй Budget з алертом на $1, щоб помітити будь-яке випадкове нарахування.
3. Compute → Instances → **Create instance**:
   - Image: **Canonical Ubuntu 24.04** (aarch64)
   - Shape: **VM.Standard.A1.Flex**, **2 OCPU, 12 GB** — це весь безкоштовний ліміт ARM
   - Networking: створити VCN із публічною підмережею, **Assign a public IPv4 address**
   - SSH keys: завантажити свій публічний ключ
4. Networking → VCN → Security Lists → Default → **Add Ingress Rules**:
   `0.0.0.0/0`, TCP, порти **80** і **443**; ще UDP **443** для HTTP/3.

## 2. Підготовка Ubuntu

```bash
ssh ubuntu@<IP_СЕРВЕРА>

sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && exit      # перелогінитись, щоб група застосувалась

# Образи Oracle мають власні правила iptables, що блокують вхідне. Відкрити 80/443:
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. Домен

Безкоштовний піддомен **DuckDNS**: https://www.duckdns.org → увійти → створити піддомен
(напр. `svitloua`) → у полі «current ip» вказати публічну IP сервера.

```bash
dig +short svitloua.duckdns.org     # має повернути IP сервера
```

> Публічна IP «ephemeral» зберігається між перезавантаженнями, але міняється, якщо сервер
> зупинити (Stop) і запустити знову. Тоді — оновити IP у DuckDNS.

## 4. Код

Репозиторій приватний, тож серверу потрібен доступ лише на читання — **deploy key**:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/lightua_deploy -N ""
cat ~/.ssh/lightua_deploy.pub
# GitHub → репо → Settings → Deploy keys → Add (без «Allow write access»)

cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/lightua_deploy
EOF

sudo mkdir -p /opt/light-ua && sudo chown $USER /opt/light-ua
git clone git@github.com:NeToR-YT/API-queues-of-lights-off-in-areas.git /opt/light-ua
cd /opt/light-ua
git checkout vX.Y.Z          # прод — лише з релізного тегу (CONTRIBUTING.md)
```

## 5. Секрети й конфіг

```bash
cp .env.example .env
nano .env        # TG_API_ID, TG_API_HASH — НОВОГО акаунта (задача 0.1); DOMAIN=svitloua.duckdns.org

cp backend-js/config.example.json backend-js/config.json   # канали; секретів тут нема

mkdir -p backend-js/secrets
sudo chown -R 1000:1000 backend-js/secrets && chmod 700 backend-js/secrets
```

Перший вхід у Telegram створить сесію в `backend-js/secrets/session.txt`:

```bash
docker compose build
docker compose up -d mongo
docker compose run --rm -it backend node dist/app.js    # телефон, код, пароль 2FA; потім Ctrl+C
```

> Одна сесія — одне місце. Якщо та сама сесія паралельно працює деінде (локально, на старому
> сервері), Telegram може її вбити (`AUTH_KEY_DUPLICATED`).

## 6. Запуск

```bash
docker compose up -d
docker compose ps                    # backend має стати (healthy) за ~1 хв
docker compose logs -f caddy         # чекати «certificate obtained successfully»
```

Перевірка — **ззовні**, з будь-якого іншого пристрою:

```bash
curl -s https://svitloua.duckdns.org/api/status
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://svitloua.duckdns.org/api/update   # 403
```

## 7. Автозапуск

```bash
sudo cp deploy/light-ua.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable light-ua
```

## Фронт на GitHub Pages

Бекенд віддає `Access-Control-Allow-Origin: *`, поки `cors_origins` у `config.json` порожній,
тож сторінка з `https://<нік>.github.io` може звертатися до API без додаткових налаштувань.
Обмежити доступ лише своїм фронтом:

```json
"cors_origins": ["https://<нік>.github.io"]
```

---

## Щоденне

```bash
# Новий реліз
git fetch --tags && git checkout vX.Y.Z && docker compose up -d --build

# Ручний запуск парсингу (ззовні закритий)
docker compose exec backend wget -qO- --post-data='' http://127.0.0.1:5001/api/update

# Споживання ресурсів
docker stats --no-stream
```

## Відкат

```bash
git checkout <попередній тег> && docker compose up -d --build
```

Дані Mongo (том `mongo_data`) і сертифікати Caddy (том `caddy_data`) при цьому не чіпаються.
**Не видаляй том `caddy_data`**: Caddy заново запитуватиме сертифікати й може впертися в
ліміти Let's Encrypt.
