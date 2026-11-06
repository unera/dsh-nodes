# dsh-nodes

Remote execution for DSH: nodes anywhere (a laptop, a router, a CI box) announce
their own APIs, and the model calls their methods through a small set of tools.

The server keeps a registry of nodes and a **catalog of APIs**, so adding a node
does not cost context: the model sees four tools, not every method of every
machine.

```
nodes_list()      → nodes: aliases, online, uptime, which APIs they hold
nodes_catalog()   → catalog: id, name, methods
nodes_api(api)    → methods of one API with their argument schemas
nodes_call(node, api, method, data, timeout?, sandbox?)
```

The pair is two packages: this plugin (server side) and
[`dsh-node-client`](https://github.com/unera/dsh-node-client) (`dshnc`, runs on
the node).

## How it works

```
model ──nodes_call──▶ plugin ──queue──▶ client on the node ──▶ sandbox ──▶ shell
                        ▲                     │
                        └──── result ◀────────┘
```

* The command is handed out **once**. `GET /v1/commands` takes a batch from the
  head of the queue and marks it `processing`. There is no lease and no
  redelivery: taken means either executed or attempted. A node that dies mid
  command gets its command closed as `lost` after the timeout, so the model
  gets an answer instead of silence.
* Results are accepted late. A model that already saw a timeout does not break
  anything.
* Presence rides a WebSocket (`/v1/ws`): a tiny `state` frame means "there is
  work, go fetch it". Command data always travels over HTTP.

## Install

Not published to npm; install from the checkout:

```sh
npm install /path/to/dsh-nodes
```

Default config ships in `cordis.patch.yml`. State lives in
`$DSH_HOME/storages/dsh-nodes.sqlite`; the admin token sits next to it in
`dsh-nodes-admin.token` (0600) unless configured.

## Connect a node

Open `/api/dsh-nodes/admin` (behind the DSH login) and generate a pairing link
`https://host/dsh-nodes/pair?v=<code>`, valid for 10 minutes. On the node:

```sh
dshnc connect 'https://host/dsh-nodes/pair?v=<code>'
dshnc daemon
```

The client exchanges the code for a token itself — nothing to approve in the
panel. The code is stored hashed only: reuse gives `409`, an expired code
`410`.

## Access control on a node

The owner of the machine decides how much the server may do there. Three values,
set on the node (`dshnc policy`), not on the server:

| value | meaning |
|---|---|
| `base` | mode a command starts in; a confirmed command is **not** lowered by it |
| `max` | absolute ceiling; nothing goes wider, not even with approval |
| `approver` | who may answer a question about a wider mode: `local`, `server`, `none` |

Modes are `ro` (read only), `rw` (write inside allowed roots), `full` (no
sandbox). If a command is denied and `approver` is not `none`, the node is asked
in its own way — a dialog on that machine (`zenity` and friends), or the DSH
approval dialog on the server side.

`approver: local` is a promise: the node must announce the `session.approve`
method. The server checks this and falls back to `none`, otherwise it would queue
an approval command the node cannot execute.

Approval covers exactly one command and one step (`ro → rw → full`, up to two
steps). The command is then re-run **from the beginning**, which the dialog says
explicitly: a command that already did half the work before the denial will do
that half again.

## Audit

Two places, two purposes:

* the **journal** — one line per event with a syslog priority (`<6>` info,
  `<4>` warning), rotated by systemd. Long memory:
  `journalctl --user -u dsh-server | grep 'audit:'`;
* the **database** — a ring buffer (2000 rows, 7 days, command text up to 1000
  chars) that feeds the admin panel. Bounded on purpose: an audit nobody reads
  must not grow to gigabytes.

Three kinds of events: `exec` (ran, in `full` or with approval), `denied` (the
kernel refused) and `approve` (what the human answered).

## Uptime

The client sends `uptimeSeconds` — time since its process started. The server
converts it to its own clock at the moment of the message and only adds its own
delta afterwards, so a node with a wrong clock cannot produce a negative or
absurd uptime.

## Routes

Public: `POST /v1/enroll`, `GET /v1/enroll/{uuid}`, `POST /v1/pair`.
Node (Bearer): `PUT /v1/announce`, `GET /v1/catalog`, `GET /v1/state`,
`GET /v1/commands`, `POST /v1/commands/{seq}/result`, `GET /v1/ws` (upgrade).
Admin: `/api/dsh-nodes/*` — private, behind the DSH session.

The client-facing protocol is described in [`spec/openapi.yaml`](spec/openapi.yaml).
The admin API is deliberately not in the spec: it is private and no third-party
client should depend on it.

## Development

```sh
node --test test/*.test.mjs
```

Tests start a real `http.createServer` with the plugin handler — no cordis, no
mocks of the protocol.

Design notes and open questions live in [`docs/plan.md`](docs/plan.md) (Russian,
as are the other documents in `docs/`).
