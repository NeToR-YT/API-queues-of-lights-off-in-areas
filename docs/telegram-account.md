# Telegram-акаунт для парсера

Парсер читає канали обленерго як звичайний користувач Telegram, тому йому потрібен акаунт.
Краще завести окремий, а не використовувати особистий.

1. Зареєструвати акаунт на окремий номер і ввімкнути двоетапну перевірку:
   Settings → Privacy and Security → Two-Step Verification.
2. Отримати ключі застосунку: https://my.telegram.org → API development tools →
   `api_id` і `api_hash`.
3. Вписати їх у `.env` (`TG_API_ID`, `TG_API_HASH`). Файл `backend-js/secrets/session.txt`
   має бути порожнім або відсутнім.
4. Увійти вперше. Telegram надішле код, а сесія збережеться в `backend-js/secrets/session.txt`:
   ```bash
   docker compose run --rm -it backend node dist/app.js
   ```
5. Підписати акаунт на всі канали з `backend-js/config.json`: парсер бачить лише ті, де він є.

## Застереження

- Одна сесія працює в одному місці. Якщо запустити її паралельно ще десь, Telegram може
  розірвати її з помилкою `AUTH_KEY_DUPLICATED`.
- Новий акаунт чутливіший до обмежень на частоту запитів. Перші дні не зменшуйте
  `batch_delay` і не опитуйте канали паралельно.
- Якщо сесія могла потрапити до сторонніх, завершіть її: Settings → Devices →
  Terminate all other sessions.
