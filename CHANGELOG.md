# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.3] - 2026-11-19
### Fixed
- **A host path from a command is checked against the session that issued it.** `nodes_call` could
  name any `hostPath`, and the transfer endpoint wrote that file as the server process — the host
  side of a copy had no permission check at all. The command now carries the session's allowed
  directories (`hostRoots`), decided where the session still exists, and the transfer refuses a
  command without that stamp instead of trusting it.
- **Paths are canonical before they are compared.** The old check was a string prefix, so `..`
  walked out of the directory and a symlink pointed out of it; `/tmp/work-evil` also passed for
  `/tmp/work`. `lib/paths.mjs` resolves the existing part of a path through `realpath`, appends the
  rest, and compares the result with a separator — and the canonical path is what gets opened, so
  the checked path and the used path are the same string.
- The voice upload route and the voice commands stamp their authority too: their paths are computed
  by the server, and the transfer layer no longer has a way to skip the check.

## [0.4.2] - 2026-11-17
### Changed
- **"Удалить узел 21?" names the node.** The delete dialog used to print the bare id, which is
  the kind of label one confirms without reading — the token revoke dialog next to it already
  named the device. It now says «Удалить узел «matrix.uvw.ru» (id 21)?», with a separate wording
  for a node that has no name yet, in all three languages.

A version number is a commit that bumps `package.json`; git tags are not kept for every
release, so the history of a version is the range between two such commits.

**Which versions were actually published:** the registry has `0.3.25`, then `0.4.x`.
Versions `0.3.26`–`0.3.40` exist only as commits in this repository — they were written down
here while the package was not being published, and the sections below are kept as history,
not as releases. A consumer comparing this file with npm should read the delta as
`0.3.25 → 0.4.0`, not as forty releases.

## [0.4.1] - 2026-11-16

### Fixed
- The "events allowed" checkbox in the node form was stretched to the full width by the
  shared `input { width: 100% }` rule, so it sat centred on its own line. A checkbox now
  keeps its own size.

## [0.4.0] - 2026-11-16

### Added

- `CHANGELOG.md`, with the history of 0.3.26–0.3.40 reconstructed from the commits.
- A node has an owner-controlled switch for device events: the column
  `events_enabled INTEGER NOT NULL DEFAULT 0`, `eventsEnabled` in `nodeView`, the operation
  `{op: "events", id, body: {enabled}}` (and `/nodes/{id}/events`), and a checkbox
  "Events allowed" on the node's page in the panel. `updateNode` takes the same flag as
  `events_enabled`, a boolean normalised to 0/1.
- The panel's explanation names exactly what the switch covers — `notify-button`,
  `notify-session`, `new-session`, `voice-warmup`, `bug-report` and the legacy `voice.want` —
  and says that voice recordings (`/v1/upload-file?type=voice`) and commands keep working.
  A node with the switch off gets a grey `events off` badge, not a failure mark.
- `updateNode` refuses an unknown field with `400` instead of ignoring it: a typo like `events`
  used to look applied while nothing changed.

### Changed

- **breaking for existing nodes:** a node no longer widens its own permissions. `announce`
  used to let a device ask for `access`, `base`, `allowEscalation` and `approver`, and the
  request was honoured; after this release those fields are ignored and the node stays inside
  the ceiling its owner set. A device that was running with wider rights than the admin panel
  shows comes back to the owner's limit on the next announce.
- **breaking for existing nodes:** events are now off unless the owner allows them. The column
  defaults to `0`, so **after the upgrade every node that already exists stops accepting
  events** until the switch is turned on: `/v1/events` answers `403 events_disabled` for
  `notify-button`, `notify-session`, `new-session`, `voice-warmup`, `bug-report` and the legacy
  `voice.want`. Nothing else changes — the socket stays up, commands run, `/v1/state` and
  `/v1/commands` answer, and recordings still arrive at `/v1/upload-file?type=voice`. A voice
  plugin therefore stops receiving `voice-warmup` and `new-session` on its own nodes.
- `test/voice-upload.test.mjs`: its `stand()` now allows events on the node explicitly. Those
  tests are about the event routes, and the default they relied on no longer exists.

- `PUT /v1/announce` can no longer widen a node's permissions. `access`, `base`,
  `allowEscalation` and `approver` are written by both the admin panel and the node, so one
  side has to win: the owner does. An announcement narrows and never widens, and what was
  refused comes back in the answer's `warnings` (log line `policy-narrowed`).
- The admin API accepts `base` and `approver`, and refuses values it does not know instead of
  storing them. `access` takes both spellings (`ro` and `read-only`) and keeps the DSH one —
  a `ro` used to reach SQLite and fail its CHECK constraint.
- `spec/openapi.yaml`: `/v1/events` describes the real vocabulary (`type`, its `enum` and the
  fields of each type) instead of `required: [session, text]`; `/v1/upload-file` knows
  `type=voice` with `filetype`, `id` and `synth`; `/v1/download-file` documents which commands
  may serve a file. The machine-readable list lives in `x-device-events`.
- `README.md` and `docs/guide.ru.md`: the package *is* published to npm, the route list matches
  the code (no `/v1/catalog`, the device routes are there), the event types are the real ones,
  and the admin routes are the `/api/dsh-nodes/*` ones behind the DSH login.

### Fixed

- A pipe (`pipeFromDevice`) whose command was closed without a verdict left its
  `<hostPath>.inprogress` on disk — up to `maxTransferBytes` per lost pipe — and kept one entry
  in the server's `pendingPipes` map forever. The queue now reports every abandonment
  (`timeout`, `lost`, `expired`, `cancelled`, `node_restarted`) and one function closes both the
  file and the entry.
- `test/schema.test.mjs` looked for the client repository one directory too high, so the
  cross-repository check was skipped for ever. It compares against `x-client-methods` now and
  skips only when the sibling checkout is really absent, naming the path it tried.
- The admin JSON body (`/api/dsh-nodes/op`) is read under `maxBodyBytes` like the node routes:
  413 before the whole thing is in memory, 400 for a body that is not a JSON object.

### Documentation

- `docs/device-events.md` describes `{"voice":{"want":"record"}}` — deprecated, still
  supported, and the only shape without a `type`.
- `README.md` and `docs/guide.ru.md`: the events switch, its default and what an upgrade does to
  a node that is already connected; `docs/device-events.md` describes the `403
  events_disabled` answer and that a recording is not an event.

## [0.3.40] - 2026-11-15

### Fixed

- The legacy "I want to talk" branch (`{"voice":{"want":"record"}}`) read `sessionId` above its
  own declaration: every installed client that still sent that shape got a 500. It is answered
  by `acceptVoiceWant` again.
- A recording pushed with `type=voice` has its own ceiling: the JSON body limit no longer
  applies to it, `maxTransferBytes` does.

## [0.3.39] - 2026-11-15

### Added

- `type: "voice-warmup"`: the person opened the voice screen, so the host may warm its model up
  before the first words. Nothing is delivered, the host emits `dsh-nodes/voice-warmup`.

## [0.3.38] - 2026-11-15

### Added

- `type: "bug-report"`: the app reports its own degradation (`kind`, `text`, `app`). The host
  emits `dsh-nodes/bug-report`; the report itself never becomes a session message.

### Documentation

- `docs/device-events.md` describes the `bug-report` event.

## [0.3.37] - 2026-11-14

### Added

- A voice command (`voice.answer`, `voice.play`) may serve its own file over
  `POST /v1/download-file`: the answer is the only live command, and without this the device
  could not download the audio the answer points at.

## [0.3.36] - 2026-11-14

### Added

- One vocabulary for device events: `type` on `POST /v1/events` (`notify-button`,
  `notify-session`, `new-session`, `voice-warmup`, `bug-report`, `form`), with the legacy
  `notify` and a body without `type` read by their fields and logged once as a guess.

### Documentation

- `docs/device-events.md` becomes the single reference for messages a device starts itself.

## [0.3.35] - 2026-11-14

### Added

- `type: "new-session"`: the device starts a new conversation without text and without naming
  a session.

## [0.3.34] - 2026-11-14

### Added

- The device chooses who speaks the answer: `synth=host` makes the host synthesize the audio,
  `synth=device` (the default, and what a typo becomes) means the phone reads the text itself.

## [0.3.33] - 2026-11-14

### Added

- The client's record and send times (`x-record-start`, `x-record-stop`, `x-sent-at`) travel
  with the voice event as `at: {recordStart, recordStop, sentAt, receivedAt}`; a nonsense
  value is ignored, never a reason to refuse a recording.

## [0.3.32] - 2026-11-13

### Added

- Devices push their own recordings: `POST /v1/upload-file?type=voice` with no `seq` and no
  command. The path is chosen by the server, the write is atomic, and the host emits
  `dsh-nodes/voice`.
- Event types on `POST /v1/events`: an event is no longer only a button press.

## [0.3.31] - 2026-11-13

### Added

- `devices()` on the `nodes` service: the roster of known devices for pickers and settings
  pages, without waking a single one of them.

## [0.3.30] - 2026-11-13

### Added

- The `nodes` service for other plugins: the same queue and audit trail as the tools, without
  the approval dialogue a tool call goes through.
- A `voice-want` event: the device asks to be listened to, and the host emits
  `dsh-nodes/voice-want` for whichever plugin cares.

## [0.3.29] - 2026-11-13

### Fixed

- Confirming a request from a device that is already known revives that node: it keeps its
  name, aliases and rights and gets a fresh token, instead of appearing as a twin `A059P-2`
  while the old one stays dead in the list.

## [0.3.28] - 2026-11-13

### Fixed

- The "requests without a code" section is rendered again, and hides only while there is
  nothing in it: a node waiting for confirmation has somewhere to appear.

## [0.3.27] - 2026-11-13

### Changed

- Revoking a token asks about the device by name («Отозвать токен у устройства «Телефон»
  (id 17)?»): a bare node number is a label one confirms without reading.

## [0.3.26] - 2026-11-11

### Changed

- The connections table shows results and requests as a pair, not one number: twenty requests
  and two results is a different node from one request and one result.

## [0.3.25] - 2026-11-11

The version published on npm; this changelog starts one release after it.

### Changed

- Transfers are bounded by `maxTransferBytes`, not by the JSON body limit.
