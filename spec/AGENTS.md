# Protocol conventions

Rules that are not visible from a single endpoint but decide how the whole thing
behaves. Read this before adding a route, a frame or a tool.

## WebSocket carries state, not events

The socket exists to tell a node that the server's state changed, and to hear that
the node is waiting and which generation it lives in. That is the entire design: a
node that is idle and a server that is idle exchange nothing, and the queue is
never polled.

Frames, exactly two in each direction:

| direction | frame | meaning |
| --- | --- | --- |
| client → server | `{t:"state", epoch, client_epoch, max_commandno}` | "I am alive and waiting, my generation is this, I know commands up to N" |
| client → server | `{t:"ping", no}` | keepalive |
| server → client | `{t:"state", epoch, max_commandno}` | "my number is higher than yours, go fetch" |
| server → client | `{t:"pong", no}` | answer to the keepalive |

There is no handshake frame. Everything a node says about itself — access, workdir,
approver, uptime, client version — travels in `announce`, and it arrives exactly
when the node declares itself rather than when a socket happens to open. `state` is
a number and a generation: it is not a payload, not a command, not a notification.
Everything that must be delivered goes through the command queue over HTTP, which
has back-pressure, retries and a timeout of its own.

Saying "I am waiting" again is always safe, and the client must be ready to hear
the answer *before* it asks: subscribe to the frame first, then send `state`.
Otherwise the reply can arrive in the gap, find nobody to wake, and the node sleeps
with work waiting in the queue. Nothing will ask a second time.

**The only exception is `ping`/`pong`.** It exists for one purpose: detect a
dead connection. There is no "ping means something else", no data attached, and
on failure the node drops the socket and reconnects. Do not add frames that
carry commands, do not send cancellation, presence updates or file data over
the socket. An unknown frame closes the socket with `4400`: a client that speaks
another protocol must not be silently tolerated.

## The generation is the identity

Two counters keep the two sides apart, and neither can be inferred from the other.

`epoch` is the server's: it changes on every server restart. It is the identity
token of a connection, and every request that hands out work carries it.

`client_epoch` is the client's: a persistent counter, incremented on every
connection — reconnects and restarts alike — and stored per node in SQLite, so it
survives a server restart.

| statement | answer |
| --- | --- |
| `announce` with the current `epoch` | accepted |
| `announce` with `epoch: null` | the client lost its state: every `processing` command of that node is closed as `node_restarted`, then the announce proceeds |
| `announce` or `commands` with a different `epoch` | `409 epoch-mismatch`, nothing is written and nothing is handed out |
| `announce` or `commands` with a lower `client_epoch` | `409 client-epoch-stale` |
| `state` frame with a wrong or missing `epoch` | socket closed with `4409`, reason `epoch` |
| `state` frame with a lower `client_epoch` | socket closed with `4001`, reason `client-epoch` |

**`failInFlight` lives in announce and nowhere else.** A socket comes and goes for
reasons that lose nothing (NAT, a sleeping phone, a network change), so a frame may
never be a statement about the client's process. Only `epoch: null` in announce says
"I restarted and lost everything", and only that closes in-flight commands.

A `max_commandno` that does not match the server's own number is a claim, not an
identity: it is logged (warn, with both numbers) and no more. The reaction is not
decided yet, so do not build one on top of it.

## Reserved names start with `#`

Names beginning with `#` belong to the server. They never appear in a node's
`announce`: the server strips them and warns if a client declares one, because a
node that could declare `#INTERNAL.CANCEL` could fake a control command.

Reserved names live in a separate namespace (`internal`), not in a node's API.

## Special rules

How a client must drive work — two channels, the order announce → socket → commands,
the fetch loop, ping and reconnect — lives in `spec/CLIENT-LOOP.md`. That file is the
reference for the behaviour under load, not for the wire format.

Some methods need the server to do more than pass them through: measure their
time, or make sure nothing else runs around them. The fixed set of such rules
and the contract each one imposes live in `spec/SPECIAL-RULES.md`.

A node binds its methods to rules in a separate `applyRules` list of `announce`,
keyed by api name (and optionally version) plus method — never inside the api
def. The reason is ownership: a rule says how this machine executes a command,
not what the contract is, and a def that came from an outside source (an MCP
server) must not have to carry server-only fields.

A binding that does not check out refuses the whole announcement: the node never
learns which rule fired, the server owns the rules and verifies every binding
against the rest of the declaration.

## A client must keep taking commands while it has free slots

A cancellation is an ordinary command (`#INTERNAL.CANCEL`) and it sits in the
queue **after** the command it cancels. So a client that takes a batch and then
waits for the whole batch to finish cannot receive a cancellation issued while a
long command is still running — the cancel waits in the queue until the command
it was meant to stop has already finished.

The contract: keep `K` slots for running commands (the reference client uses 5,
configurable), never take more than the free slots in one batch, and go back for
more as soon as a slot frees — without waiting for the rest of the batch. Then a
cancellation reaches the node while there is still something to cancel.

Control commands (`#…`) are no exception either: they take a pool slot like any
other command and differ only in priority — `#INTERNAL.CANCEL` at 10,
`#INTERNAL.APPROVE` at 5, user work at 0. The barrier `#INTERNAL.FLUSH` inherits
the priority of the command it was placed for.

## Control commands travel through the queue

A control command is an ordinary queued command with:

- a **priority above user work** (`#INTERNAL.CANCEL` is taken before anything
  queued before it, and is exempt from the queue ceiling): a cancellation that
  queues behind the command it cancels is useless;
- `api = -1` (`CONTROL_API`) — no node declares this API;
- a `#`-prefixed method name (`#INTERNAL.CANCEL` for cancellation);
- a very long TTL (a day) and **no waiting process**: nobody awaits the result,
  a non-`ok` outcome is written to the log and forgotten;
- delivery that may be late, duplicated or never happen at all. The receiver
  must tolerate a cancellation that arrives after the command already finished,
  and the server must not treat an unknown target as an error.

Control commands are issued only for work the node actually took
(`status === 'processing'`). A command still sitting in the queue was never seen
by the node: it is simply dropped, no cancellation is sent.

## Commands are tickets

A transfer route (`/v1/upload-file`, `/v1/download-file`) is authorised by the
command it serves: the node passes `seq`, the server looks the command up and
checks both the owner and the expected method. There is no separate transfer
token.

Direction naming is decided by the destination, not the source:

| method | direction | `path` | `hostPath` |
| --- | --- | --- | --- |
| `copyToDevice` | host → node | destination on the node | source on the host |
| `copyFromDevice` | node → host | source on the node | destination on the host |

## Streams finalise on a verdict

When a command produces a stream of unknown length (`pipeFromDevice`), the
server writes to `<hostPath>.inprogress` and returns `pending: true`. The file is
renamed to its final name only after the command reports success; any other
outcome deletes it. The path is always computed by the server from its own
issued command — never taken from the request body, because the node would then
control which file the server deletes.

## Ephemeral state

Nodes, tokens, APIs, aliases, notifications, audit, the server's `epoch` and the
client's `client_epoch` are in SQLite. The command queue and its `seq` counter are
in memory: after a restart the queue is empty and the `epoch` changes, so every
client announces itself again. `client_epoch` deliberately stays on disk: it is
what makes a stale instance of a node recognisable after the server itself
restarted. Do not persist `seq` — it buys nothing and creates gaps.

## Versions

An API version equals the client version that declares it (`desktop-0.0.81`,
`android-0.9.3`). Two nodes of the same platform must never collide on the API
key, which is derived from name and version.
