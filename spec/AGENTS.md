# Protocol conventions

Rules that are not visible from a single endpoint but decide how the whole thing
behaves. Read this before adding a route, a frame or a tool.

## WebSocket carries state, not events

The socket exists to tell a node that the server's state changed, and to hear
back which state the node already knows. That is the entire design: a node that
is idle and a server that is idle exchange nothing, and the queue is never
polled.

- The server sends `hello-ok`, `state`.
- The node sends `hello`, `check_state` (`alive` is the old name, still read).
- `state` is a single number. It is not a payload, not a command, not a
  notification. Everything that must be delivered goes through the command
  queue over HTTP, which has back-pressure, retries and a timeout of its own.

**The only exception is `ping`/`pong`.** It exists for one purpose: detect a
dead connection. There is no "ping means something else", no data attached, and
on failure the node drops the socket and reconnects. Do not add frames that
carry commands, do not send cancellation, presence updates or file data over
the socket.

## Reserved names start with `#`

Names beginning with `#` belong to the server. They never appear in a node's
`announce`: the server strips them and warns if a client declares one, because a
node that could declare `#INTERNAL.CANCEL` could fake a control command.

Reserved names live in a separate namespace (`internal`), not in a node's API.

## Special rules

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

`session.approve` is the one exception: it leaves the pool entirely, because a
dialog with a human may hang for a day.

## The socket carries state, not events

`state` is a number, not a notification: the server sends it when it sees
`state > known`, and asking again is always safe. That removes the whole class of
"the event was lost" problems — but only if the client is ready to hear the
answer *before* it asks. Subscribe to the frame first, then send `check_state`;
otherwise the reply can arrive in the gap, find nobody to wake, and the node
sleeps with work waiting in the queue. Nothing will ask a second time.

## Control commands travel through the queue

A control command is an ordinary queued command with:

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

Nodes, tokens, APIs, aliases, notifications, audit and `epoch` are in SQLite.
The command queue and its `seq` counter are in memory: after a restart the queue
is empty, the `epoch` changes, and every client resets its cursor. Do not
persist `seq` — it buys nothing and creates gaps.

## Versions

An API version equals the client version that declares it (`desktop-0.0.81`,
`android-0.9.3`). Two nodes of the same platform must never collide on the API
key, which is derived from name and version.
