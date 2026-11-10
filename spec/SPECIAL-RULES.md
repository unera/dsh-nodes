# Special rules for node commands

A node says, in `announce`, which of its methods want special treatment — in a
separate `applyRules` list, **not** inside the api def:

```json
"applyRules": [
  { "api": "session", "method": "chdir", "rule": "flushAround" },
  { "api": "session", "method": "ping", "rule": "timing",
    "rulesOpts": { "retNames": { "durationMs": "durationMs", "clockSkewMs": "skewMs" } } }
]
```

Why separate: a rule says how **this machine** executes a command, not what the
API contract is. Two nodes may hold the same contract and treat it differently,
and an api def that arrived from an outside source (an MCP server, say) must not
have to carry server-only fields.

The set of rules lives on the server and grows only with code — a node cannot
invent one. This file is the registry: keep it in sync with the server.

## A binding is checked, not trusted

A rule is only as good as what it can rely on, and a binding that quietly does
nothing is worse than a refusal. So the server checks every entry against the
announcement and refuses the whole announce (`400 apply-rules-invalid`) when:

- the rule is unknown;
- the `api` is not one this node holds, or `version` names one it does not hold;
- the `api` does not declare `method`;
- the same `(api, method)` is bound twice;
- `rulesOpts` carries an option the rule does not have, or a canonical name the
  rule does not compute.

A rule that would measure nothing — `timing` without `retNames` — is accepted
with a warning: measuring into nowhere is a legitimate choice, losing the
measurement by accident is not.

Rules impose **no** requirements on the api def. The binding carries what the
rule needs, which is why an outside source can announce a contract without
knowing that rules exist.

## The rule set

## The rule set

### `timing` — measure how long the command took

The rule is a wrapper and it relies on itself first. Two numbers, two different
sources:

| number | where it comes from |
| --- | --- |
| `durationMs` | the server's own stamps: `startedAt` when the command is handed out, `finishedAt` when the answer arrives. The node is not involved at all — it may send nothing |
| `clockSkewMs` | needs the node's clock: how far ahead of the server's it is. No clock in the answer — no skew, and none is invented |

`startedAt` and `finishedAt` live in the rule's own state inside the command and
never appear in the answer.

Where the numbers go is decided by `rulesOpts.retNames`: canonical name → field
in the node's reply. A canonical name left out (or set to `null`) is not placed
anywhere — so a method whose reply has no such field simply keeps its own shape.

The node's clock arrives in the result envelope as `now` — one field for every
command, not per rule. The rule reads it only when it needs skew; when it does
not, `now` costs nobody anything.

Why this is not called `ping`: any command may ask to be measured — a backup
run, a health probe, a status read. `ping` is just the first user of the rule.

### `flushBefore` — nothing before me may still be running

The server puts `#INTERNAL.FLUSH` before the command. When the flush completes,
every command issued earlier has finished. The command itself may run in
parallel with what comes after.

### `flushAfter` — nothing after me may start until I finish

The server puts `#INTERNAL.FLUSH` after the command. Later work starts only
once the flush drains the pool.

### `flushAround` — both of the above

Equivalent to `flushBefore` + `flushAfter`: the command is alone between two
empty pools. This is the rule for anything that changes the conditions of other
commands — `chdir` above all: it must not be overtaken by a parallel command,
and nothing may start while it is applied.

## The `#INTERNAL.FLUSH` command

- lives in the reserved namespace (`api = -1`, name starts with `#`);
- is never declared by a node — the server strips reserved names and warns;
- is taken **alone**, and nothing queued behind it is handed out while it is
  pending (a client must see the barrier as the only command in its batch);
- inherits the priority of the command it was placed for — so it holds user work
  and lets control commands through;
- is executed from the ordinary stream: it occupies a worker slot like any other
  command, and "wait for everything before me" means *everything except itself* —
  waiting for a pool that includes the barrier never ends;
- reports `ok: true` when it had something to wait for and when it had nothing:
  "there was nothing running" is a success, not an error.

## How the client uses it

Nothing about rules appears in the client's dispatch: it sees `#INTERNAL.FLUSH`
as an ordinary command with the special name, waits for the pool to drain, and
answers. All knowledge about which method wants which rule stays on the server.

The one thing every client does unconditionally is stamp its own clock into the
result envelope (`now`). That is not rule-awareness: it is a plain fact about the
answer, and the rule reads it only if it needs it.
