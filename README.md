# dsh-nodes

Плагин DSH: удалённые узлы объявляют свои API, модель зовёт их методы.

Сервер держит реестр узлов и **справочник API**; модель видит четыре тула и не
платит контекстом за каждый подключённый узел.

```
nodes_list()      → узлы: алиасы, online, сколько молчит, какие API держит
nodes_catalog()   → справочник: номер, имя, методы
nodes_api(api)    → методы одного API со схемами аргументов
nodes_call(node, api, method, data, timeout?)
```

## Состояние

Работающий вертикальный срез, не релиз. Есть: узлы и токены, self-enroll,
справочник API, очередь команд с `state`/`served`, выдача строго после курсора,
`POST /result` с поздними результатами, отмена через снятие из очереди,
валидация аргументов по схеме метода, четыре тула модели.

Чего ещё нет:

- WebSocket: присутствие сейчас по последнему HTTP-обращению, `hello`/`alive`
  и сверка `epoch` на рукопожатии — следующий шаг (**важно:** рестарт сервера
  сейчас не различается узлом по `epoch`, хотя поле в ответах уже есть);
- эскалация песочницы через `ctx.approval` — режим приходит из сессии, но
  диалога «разрешить пошире» пока нет;
- админка как страница: `/dsh-nodes/admin` отдаёт JSON-подсказку, управление —
  через `/v1/admin/*`;
- `spec/` (OpenAPI) не написана.

Полный план с обоснованиями — `docs/plan.md`.

## Установка

Пакет в npm не опубликован; ставится из каталога:

```sh
npm install /path/to/dsh-nodes
```

Конфиг по умолчанию — `cordis.patch.yml` в составе пакета. Состояние:
`$DSH_HOME/storages/dsh-nodes.sqlite`, админ-токен — рядом в
`dsh-nodes-admin.token` (0600), если не задан в конфиге.

## Маршруты

Публичные (без токена): `POST /v1/enroll`, `GET /v1/enroll/{uuid}`.
Узел (Bearer): `PUT /v1/announce`, `GET /v1/catalog`, `GET /v1/commands`,
`POST /v1/commands/{seq}/result`, `GET /v1/state`.
Админ (Bearer админ-токена): `GET|POST /v1/admin/nodes`,
`PATCH|DELETE /v1/admin/nodes/{id}`, `POST /v1/admin/nodes/{id}/token`,
`GET /v1/admin/pending`, `POST /v1/admin/pending/{uuid}/approve|reject`.

## Разработка

```sh
node --test test/*.test.mjs
```

Тест поднимает настоящий `http.createServer` с обработчиком плагина — cordis
для тестов не нужен.
