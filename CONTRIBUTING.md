# Як ми працюємо з git

Стандарт проєкта, ухвалений 2026-10-26. Схема: дві постійні гілки + короткоживучі
робочі гілки + **теги як історія версій**.

```
feature/*, fix/*, chore/* ──PR (squash)──▶ develop ──▶ staging
                                              │
                         release/X.Y.Z ◀──────┘  (стабілізація релізу)
                               │
                               └──PR (merge)──▶ main ──тег vX.Y.Z──▶ прод
                                                 │
hotfix/* ── від main, лише якщо прод горить ─────┘  (потім main → develop)
```

## Гілки

### Постійні

| Гілка | Що в ній | Куди деплоїться |
|---|---|---|
| `main` | те, що зараз у проді; кожен реліз — тег на ній | прод (за тегом) |
| `develop` | усе прийняте й готове до наступного релізу | staging |

У `main` і `develop` не комітимо напряму і ніколи не робимо force-push — лише через PR.

### Робочі (короткоживучі)

| Префікс | Для чого | Відгалужується від | Зливається в |
|---|---|---|---|
| `feature/` | нова можливість для користувача чи клієнта API | `develop` | `develop` |
| `fix/` | виправлення бага | `develop` | `develop` |
| `chore/` | робота **без** зміни поведінки: залежності, CI, Docker/деплой, рефакторинг, документація | `develop` | `develop` |
| `release/` | підготовка релізу: версія, CHANGELOG, лише стабілізаційні фікси | `develop` | `main`, потім `main` → `develop` |
| `hotfix/` | **виняток**: прод зламаний, а в `develop` лежить неготове | `main` | `main`, потім `main` → `develop` |

Чому `chore/` окремо від `feature/`: інакше оновлення залежностей чи CI потрапляє в
CHANGELOG як «нова можливість», хоча користувач нічого нового не отримав.

### Назви

`<префікс>/<короткий-опис>` — латиницею, малими літерами, через дефіс. Номер issue — за бажанням.

```
feature/telegram-notifications-bot
feature/42-ical-export
fix/kherson-empty-channel
chore/bump-node-22
release/0.9.0
hotfix/parser-crash-on-empty-message
```

## Коміти — Conventional Commits

```
<тип>(<область, необов'язково>): <що зроблено, англійською, наказовий спосіб>
```

| Тип | Коли | Вплив на версію |
|---|---|---|
| `feat` | нова можливість | minor |
| `fix` | виправлення бага | patch |
| `perf` | швидше / менше ресурсів | patch |
| `refactor`, `docs`, `test`, `ci`, `build`, `chore` | без зміни поведінки | — |
| `feat!` / `fix!` або `BREAKING CHANGE:` у тілі | ламає сумісність | major |

```
feat(stats): add weekday heatmap endpoint
fix(parser): handle "-" as no-outage line after queue header
chore(deploy): run backend container as non-root
```

**Префікс гілки і тип коміту — різні речі.** Гілка `feature/` — це назва для людей;
`feat:` у коміті — стандарт, з якого автоматично будуються CHANGELOG і наступний номер
версії, тож інструменти очікують саме `feat`. У гілці `feature/` цілком можуть бути коміти
`test:` чи `docs:`.



## Злиття

| Що → куди | Як | Чому |
|---|---|---|
| `feature/` `fix/` `chore/` → `develop` | **squash merge**; заголовок PR — у форматі коміту | одна зміна = один коміт = один рядок у CHANGELOG |
| `release/` `hotfix/` → `main` | **merge commit** (не squash) | `main` і `develop` мають спільну історію — зворотне злиття не конфліктує |
| `main` → `develop` після релізу/хотфіксу | **merge commit** | повертає версію й фікси в `develop` |

Перед злиттям: CI зелений, PR прорев'ю­ений.

## Релізи

Версії — [SemVer](https://semver.org/lang/uk/). До мілстоуна V1 — `0.x`:
**`v0.9.0` — TS-бета**, **`v1.0.0` — Python V1**.

1. `git switch -c release/0.9.0 develop`
2. Підняти версію (`package.json` / `pyproject.toml`), оновити `CHANGELOG.md`.
   У release-гілку — **лише стабілізаційні фікси**, нових фіч нема.
3. PR `release/0.9.0` → `main`, merge commit.
4. Анотований тег на `main` + GitHub Release з нотатками:
   `git tag -a v0.9.0 -m "v0.9.0"` → `git push origin v0.9.0`
5. `main` → `develop` (merge commit).
6. Видалити `release/0.9.0` — історію тримає тег.

**«Реліз 1.5 заморожений, а треба працювати над 2.0»** — саме для цього release-гілка:
`release/1.5.0` стабілізується окремо, а `develop` тим часом приймає фічі 2.0.
Незавершена фіча просто лишається у своїй `feature/`-гілці й не мержиться, поки не готова.

**Латання старої версії**, коли `main` уже пішов далі (рідкість для вебсервісу), — виняток:
`git switch -c release/1.5 v1.5.0`, фікс, тег `v1.5.1`. Гілка живе, поки стара версія потрібна.

### Версія застосунку ≠ версія API

`v2.3.0` застосунку цілком може віддавати і `/v1`, і `/v2` API. Версія API (шлях `/vN`)
змінюється лише при ламкій зміні контракту, і старий шлях живе поруч, поки клієнти
не перейдуть. Окремих гілок для версій API нема.

## Хотфікси

Лише коли прод зламаний **і** в `develop` вже лежить неготове до релізу. Інакше — звичайний
`fix/` через `develop` і наступний реліз.

`hotfix/<опис>` від `main` → PR → `main` → тег patch (`v0.9.1`) → `main` → `develop`.

## Середовища

| Джерело | Середовище | Де | Адреса |
|---|---|---|---|
| тег на `main` | **прод** | ARM, `/opt/light-ua` | Tailscale Funnel, `:443` |
| `develop` | **staging** | той самий ARM, окремий compose-проєкт | Funnel `:8443` або приватно (`tailscale serve`) |

Деплой проду — завжди **тег**, не гілка: `git fetch --tags && git checkout v0.9.0`,
далі `docs/deploy-beta.md`. Відкат — checkout попереднього тегу.

**Staging працює БЕЗ парсера і без Telegram-секретів.** Якщо запустити ту саму сесію в
двох місцях одночасно, Telegram побачить один ключ авторизації з двох адрес
(`AUTH_KEY_DUPLICATED`) і може вбити сесію — разом із продом. Дані для staging —
знімок прод-Mongo (`mongodump` → `mongorestore`); коли в Mongo з'являться read-only
користувачі (етап 1, задача 1.5), staging зможе читати прод напряму.

> Статус: staging ще не налаштований — окрема задача.

## Захист гілок на GitHub

Settings → Branches (або Rulesets) для `main` і `develop`:

- Require a pull request before merging
- Require status checks to pass (CI)
- Block force pushes, restrict deletions
- Required approvals: **0** — GitHub не дає автору схвалити власний PR, а PR-и
  відкриваються від імені Oleksiy. Рев'ю — змістовне, у коментарях, мерж — власником.

---

## Перехід на цю схему (одноразово, 2026-10)

Стан до переходу: робочий код — у `production`; дефолтна гілка GitHub `back` і локальний
`main` — Python-прототип; `origin/develop` — мертва стара JS-міграція. Нічого незлитого
не видаляємо без архівного тегу. Кроки з ⚠️ змінюють remote — виконуються лише за явною
згодою власника.

```bash
# 1. Архівні теги для всього незлитого — нічого не губимо
git tag -a archive/python-prototype      origin/back                         -m "Flask+Telethon prototype (domain reference for stage 1)"
git tag -a archive/js-migration          origin/develop                      -m "Old JS migration, superseded by production"
git tag -a archive/switch-to-typescript  origin/feature/switch-to-typescript -m "Unmerged TS switch branch"
git tag -a archive/mongodb               origin/mongodb                      -m "Orphan data branch read by migrate-from-mongodb-branch.ts"
git push origin archive/python-prototype archive/js-migration archive/switch-to-typescript archive/mongodb

# 2. main = нинішній production (на remote main ще нема — нічого не перезаписує)
git branch -f main production
git push origin main

# 3. ⚠️ develop = main (перезаписує старий origin/develop; він уже під тегом)
git branch -f develop main
git push --force-with-lease origin develop

# 4. GitHub: Default branch → main; захист main і develop (див. вище)

# 5. Поточна робота: PR chore/deploy-beta → develop (squash)
# 6. Реліз v0.9.0 (розділ «Релізи»); сервер переходить з гілки production на тег v0.9.0

# 7. Скрипт міграції читає origin/mongodb → перевести на archive/mongodb

# 8. ⚠️ Лише після кроку 6: прибрати старі remote-гілки
git push origin --delete back production mongodb \
  feature/statistics feature/switch-to-javascript feature/switch-to-typescript
```

Архівний тег `archive/python-prototype` тримає в історії скомпрометовану Telethon-сесію —
вона вже мертва після ротації (задача 0.1); зачистка історії (filter-repo) перепише й тег.
