# Special rules for node commands

A node declares, in `announce`, which of its methods want special treatment.
The set of rules lives on the server and grows only with code — a node cannot
invent one. This file is the registry: keep it in sync with the server.

If a node declares a rule the server does not know, the command runs as usual
and the node gets a warning in the announce response. Silence is not allowed
here: a "special" command that nobody treats specially is how quiet bugs start.

## Rules impose requirements on the declaring API

A rule is only as good as the contract it needs. `timing` is meaningless if the
method does not expose the fields the server fills, so the server checks each
declaration at announce time and:

- logs `special-rule-violated` at **error** level and adds a warning to the
  announce response when a required field is missing;
- logs `special-rule-unknown` at error level when the node names a rule the
  server does not have.

Loud is the point: a rule applied to a method that cannot honour it produces
numbers that look real and mean nothing.

## The rule set

### `timing` — measure how long the command took

The server stamps the moment it hands the command out, and on the answer it
computes `rttMs`, `clockSkewMs` and `durationMs`.

The contract: the command **must leave the timing fields empty in its reply** —
the server fills them. The node reports `now` (its own clock) and does not fill
anything else. If the node pre-fills them, the number stops meaning anything,
so "leave them empty" is a requirement, not advice.

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
- executes only when the worker pool is empty, and holds the "take more work"
  side of the loop while it is pending;
- reports `ok: true` when it had something to wait for and when it had nothing:
  "there was nothing running" is a success, not an error.

## How the client uses it

Nothing about rules appears in the client's dispatch: it sees `#INTERNAL.FLUSH`
as an ordinary command with the special name, waits for the pool to drain, and
answers. All knowledge about which method wants which rule stays on the server.
