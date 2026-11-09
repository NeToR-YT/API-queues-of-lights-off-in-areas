# Деплой на Oracle Cloud (Always Free) з HTTPS

Інструкція розгортає API (`backend-js` і MongoDB) на безкоштовному ARM-сервері Oracle
й відкриває його по HTTPS із сертифікатом Let's Encrypt.

```
інтернет ──HTTPS :443──▶ Caddy ──▶ nginx :80 ──▶ backend :5001 ──▶ mongo
                         (TLS)       (/api, 403 на /api/update,
                                      rate limit)
```

Назовні відкриті лише порти 80 і 443, обидва веде Caddy. Порт 80 потрібен Let's Encrypt для
перевірки домену, решту запитів він перенаправляє на HTTPS. nginx, бекенд і MongoDB доступні
тільки всередині мережі compose.

---

## 1. Акаунт і сервер Oracle

1. Зареєструватися на https://www.oracle.com/cloud/free/. Картка потрібна лише для верифікації.
   Home region обирається один раз і назавжди, безкоштовний сервер можна створити тільки в ньому.
   У популярних регіонах (наприклад, Франкфурті) часто бракує вільних ARM-потужностей і
   з'являється помилка «Out of host capacity». Тоді допомагає інший регіон або повторна спроба пізніше.
2. Бажано перейти на Pay As You Go (Billing → Upgrade). У межах безкоштовних лімітів це так
   само нічого не коштує, зате Oracle не забере сервер через «простій». Одразу налаштуйте
   Budget з алертом на $1, щоб помітити будь-яке випадкове нарахування.
3. Compute → Instances → Create instance:
   - Image: Canonical Ubuntu 24.04 (aarch64)
   - Shape: VM.Standard.A1.Flex, 2 OCPU і 12 GB, тобто весь безкоштовний ліміт ARM
   - Networking: VCN із публічною підмережею, увімкнути «Assign a public IPv4 address»
   - SSH keys: завантажити свій публічний ключ
4. Networking → VCN → Security Lists → Default → Add Ingress Rules:
   `0.0.0.0/0`, TCP, порти 80 і 443, а також UDP 443 для HTTP/3.

## 2. Підготовка Ubuntu

```bash
ssh ubuntu@<IP_СЕРВЕРА>

sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && exit      # перелогінитись, щоб група застосувалась

# В образах Oracle є власні правила iptables, які блокують вхідні з'єднання. Відкрити 80 і 443:
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. Домен

Безкоштовний піддомен дає DuckDNS: https://www.duckdns.org. Увійдіть, створіть піддомен
(наприклад, `svitloua`) і вкажіть у полі «current ip» публічну IP сервера.

```bash
dig +short svitloua.duckdns.org     # має повернути IP сервера
```

> Публічна IP переживає перезавантаження, але змінюється, якщо сервер зупинити (Stop) і
> запустити знову. У такому разі оновіть IP у DuckDNS.

## 4. Код

```bash
sudo mkdir -p /opt/light-ua && sudo chown $USER /opt/light-ua
git clone https://github.com/NeToR-YT/API-queues-of-lights-off-in-areas.git /opt/light-ua
cd /opt/light-ua
git checkout vX.Y.Z          # у прод ідуть лише релізні теги (CONTRIBUTING.md)
```

## 5. Секрети й конфіг

```bash
cp .env.example .env
nano .env        # TG_API_ID, TG_API_HASH і DOMAIN=svitloua.duckdns.org

cp backend-js/config.example.json backend-js/config.json   # канали, секретів тут немає

mkdir -p backend-js/secrets
sudo chown -R 1000:1000 backend-js/secrets && chmod 700 backend-js/secrets
```

Звідки взяти ключі й як уперше увійти в Telegram, описано в
[`docs/telegram-account.md`](telegram-account.md). Коротко:

```bash
docker compose build
docker compose up -d mongo
docker compose run --rm -it backend node dist/app.js    # телефон, код, пароль 2FA, потім Ctrl+C
```

> Одна сесія працює лише в одному місці. Якщо вона паралельно запущена деінде (локально чи
> на іншому сервері), Telegram може її розірвати з помилкою `AUTH_KEY_DUPLICATED`.

## 6. Запуск

```bash
docker compose up -d
docker compose ps                    # backend має стати (healthy) приблизно за хвилину
docker compose logs -f caddy         # дочекатися «certificate obtained successfully»
```

Перевіряти треба ззовні, з будь-якого іншого пристрою:

```bash
curl -s https://svitloua.duckdns.org/api/status
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://svitloua.duckdns.org/api/update   # 403
```

## 7. Автозапуск

```bash
sudo cp deploy/light-ua.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable light-ua
```

## Фронтенд на GitHub Pages

Поки `cors_origins` у `config.json` порожній, бекенд відповідає з `Access-Control-Allow-Origin: *`,
тож сторінка з `https://<нік>.github.io` може звертатися до API без додаткових налаштувань.
Щоб дозволити доступ лише своєму фронтенду:

```json
"cors_origins": ["https://<нік>.github.io"]
```

---

## Щоденна робота

```bash
# Новий реліз
git fetch --tags && git checkout vX.Y.Z && docker compose up -d --build

# Ручний запуск парсингу (ззовні цей ендпоінт закритий)
docker compose exec backend wget -qO- --post-data='' http://127.0.0.1:5001/api/update

# Скільки ресурсів їдять контейнери
docker stats --no-stream
```

## Відкат

```bash
git checkout <попередній тег> && docker compose up -d --build
```

Дані MongoDB (том `mongo_data`) і сертифікати Caddy (том `caddy_data`) при цьому не змінюються.
Том `caddy_data` не видаляйте: інакше Caddy заново запитуватиме сертифікати й може впертися
в ліміти Let's Encrypt.
