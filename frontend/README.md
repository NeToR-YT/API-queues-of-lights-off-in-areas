# frontend — тестовий клієнт

React 19 + Vite. Потрібен, щоб перевіряти API локально; бойовий фронт — окремий проєкт
на https://nadlaf.github.io/LightUA/.

```bash
npm ci
npm run dev        # http://localhost:5000, запити /api проксуються на бекенд :5001
npm run build      # збірка в dist/ (у Docker-образі робиться автоматично)
```

Усі запити йдуть на відносний `/api`, тож у проді фронт і API мають бути на одному домені.
