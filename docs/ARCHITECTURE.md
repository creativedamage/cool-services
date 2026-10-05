# Sundays — Architecture

A macOS app (Electron) for Cool Church (Miramar, FL) built on Planning Center People + Services.
Everything runs inside the app: nothing to host.

```
┌─────────────────── Sundays.app ────────────────────┐
│  Window (Electron)                                  │         ┌──────────────────────────┐
│    loads http://127.0.0.1:47123                     │  HTTPS  │ api.planningcenteronline │
│  Built-in server (127.0.0.1 only)                   │ ──────▶ │  /oauth/*                │
│    • static UI (Next.js export, Tailwind dark)      │         │  /people/v2/*            │
│    • /api: sign-in, sessions, PCO client, routes    │         │  /services/v2/*          │
│  Data: ~/Library/Application Support/Sundays        │         └──────────────────────────┘
│    cool-services.json · key.txt (not the Keychain)  │
└─────────────────────────────────────────────────────┘
```

Ports: 47123, falling back to 47124 then 47125 if taken (never 3000/3001). The server binds to
127.0.0.1 only, so nothing on the network can reach it.

## 1. Sign in with Planning Center

The same model as ProDeck: one **Public** OAuth application ("Sundays"), registered once.
Its Client ID is built into the app (`server/src/pco/registration.ts`), and a Public app has no
secret. PKCE proves each sign-in is genuine.

1. **Sign in** → `/api/auth/login` makes a `state` + PKCE verifier (short-lived httpOnly cookies)
   and opens Planning Center's own sign-in page **inside the app window**.
2. Planning Center returns to `http://127.0.0.1:<port>/api/auth/callback`. The app exchanges the
   code plus verifier for tokens, reads `/people/v2/me`, and saves the tokens encrypted (AES-256-GCM).
   The key lives in the macOS Keychain (Electron `safeStorage`).
3. A 30-day session cookie keeps the person signed in. Access tokens (2 h) refresh automatically,
   and refresh tokens last 90 days.
4. Optional shared Personal Access Token mode (`PCO_PAT_APP_ID` / `PCO_PAT_SECRET` env vars). Data
   calls use the token, and sign-in only admits people from the token's church.

Registered redirect URIs: `http://127.0.0.1:47123|47124|47125/api/auth/callback`
(plus `http://127.0.0.1:5173/api/auth/callback` if you develop in a browser).

## 2. PCO client (`server/src/pco/client.ts`)

- **JSON:API flattening** — `data` + `included` are merged into plain objects
  (`{ id, type, ...attributes, rel: { person: {...} } }`) so the frontend never sees JSON:API.
- **Pagination** — follows `links.next` (`per_page=100`) with a hard page cap.
- **Rate limits** — PCO allows ~100 requests / 20s per user. The client serialises through a
  small token bucket and honours `Retry-After` on 429 with backoff.
- **Refresh** — single-flight refresh (concurrent requests await one refresh promise).

## 3. Endpoint map

### People (Kanban)
| UI action | PCO call |
|---|---|
| List workflows | `GET /people/v2/workflows` |
| Columns | `GET /people/v2/workflows/{wf}/steps` (ordered by `sequence`) |
| Cards | `GET /people/v2/workflows/{wf}/cards?include=person,assignee` |
| Card contact info | `GET /people/v2/people/{id}?include=emails,phone_numbers` (batched, cached) |
| Drag right one step | `POST /people/v2/people/{p}/workflow_cards/{c}/promote` |
| Drag left one step | `POST …/workflow_cards/{c}/go_back` |
| Drag across N steps | N sequential promote / go_back calls (PCO has no "jump to step"); optimistic UI, rollback on failure. `skip_step` is used when the user holds ⇧ to mark skipped steps as skipped rather than completed. |
| Card notes (read/write) | `GET/POST /people/v2/people/{p}/workflow_cards/{c}/notes` |
| Profile notes (read) | `GET /people/v2/people/{p}/notes?include=category` |
| Email from card | `POST …/workflow_cards/{c}/send_email` `{subject, note}` — sent by PCO from the staff member's address and logged on the card |
| Snooze / remove | `…/snooze`, `…/remove` |

### Services (Scheduling)
| UI action | PCO call |
|---|---|
| Service types | `GET /services/v2/service_types` |
| Upcoming plans | `GET /services/v2/service_types/{st}/plans?filter=future&order=sort_date` |
| Plan detail | `GET …/plans/{p}?include=plan_times` |
| Run sheet | `GET …/plans/{p}/items?include=item_notes` |
| Roster | `GET …/plans/{p}/team_members?include=person,team` |
| Open slots | `GET …/plans/{p}/needed_positions?include=team` |
| Teams + positions | `GET /services/v2/service_types/{st}/teams?include=team_positions` |
| Eligible people | `GET /services/v2/team_positions/{tp}/person_team_position_assignments?include=person` |
| **Schedule someone** | `POST …/plans/{p}/team_members` `{person_id, team_position_name, status:"U", prepare_notification:true}` + `team` relationship |
| Accept / decline on behalf | `PATCH …/team_members/{tm}` `{status:"C"|"D", decline_reason}` |
| Unschedule | `DELETE …/team_members/{tm}` |
| Conflicts | `GET /services/v2/people/{id}/blockouts?filter=future` + `GET /services/v2/people/{id}/schedules` |

People and Services share the same person id, which is what makes the Kanban → "Schedule"
quick action a single call.

## 4. Sync strategy

| Data | Strategy | TTL |
|---|---|---|
| Workflows, steps, teams, positions, service types | In-memory read-through cache | 10 min |
| Cards, roster, needed positions | Always live on board/plan open; cached 30s for rapid re-renders | 30 s |
| Person contact info / avatars | Cache | 1 h |
| Writes (move, note, schedule, status) | **Write-through**: call PCO first, then invalidate the affected cache keys and return the fresh object. Frontend applies optimistic updates and rolls back on error. | — |
| External changes | Clients poll with React Query `refetchInterval` (20s on an open board/plan) and short cache lifetimes | — |

Internal notes: every note written from a card goes to PCO as a workflow-card note (so it shows up
in PCO too). Notes marked **"Staff-only"** are stored only in the app's data file — useful for
pastoral context you do not want in PCO.

## 5. Data model (`server/src/lib/db.ts`)

A single JSON file, `cool-services.json`, written atomically. There's no database engine to break.

- `users`: Planning Center person id, org id, name, avatar, email
- `tokens`: encrypted access/refresh tokens and their expiry, one per user
- `sessions`: opaque id (the cookie), user, demo flag, expiry
- `notes`: staff-only notes, keyed by Planning Center person id (and optionally card id)
- `audit`: who moved, scheduled or emailed whom, and when (last 5,000 entries)

Planning Center responses are cached in memory only.

## 5b. Mics & packs

- Setup (receivers + channels) and per-plan assignments live in the local data file. `micUsual`
  remembers each person's last channel per mic kind for Auto-assign. A person can hold one mic of
  each kind (e.g. a vocal and a pack).
- `server/src/lib/shure.ts` is read-only. It sends one GET batch per receiver every 4s while the
  panel is open: battery, runtime, charge, transmitter, frequency, interference and mute, plus
  antennas/RSSI on Axient. ULX-D-family antenna/RF levels come from a brief METER_RATE sample.
  It never sends CHAN_NAME or any other SET.
- Tested against simulated ULX-D and AD4D receivers.

## 5c. Check-ins

`GET /api/services/plans/:st/:plan/checkins` reads `/check-ins/v2/check_ins` created between 2h
before the plan's first time and 2h after its last one. Every 10s only new check-ins are fetched;
every 60s there's a full refresh, which picks up check-outs. Check-ins are kept in memory only and
never written to disk. Medical notes and emergency contacts are never passed to the app. Requires
the `check_ins` OAuth scope; older sign-ins get a "Sign in again" prompt.

## 5d. (Stage plots were removed in 1.22)

## 5r. Resi (1.23)

`lib/resi.ts`: Resi's public API (`https://api.resi.io/v1`, override with `COOL_RESI_API`), OAuth
client credentials (`/oauth/token`), `GET /encoders` and `GET /schedules` every 10 s. Live = a
schedule destination STARTING/STARTED (or, if the account can't list schedules, the encoder's own
status). The secret is stored with `crypto.ts`. `/api/resi` (status), `/api/resi/settings`,
`/api/resi/test`. Web: `components/resi/Resi.tsx` (`ResiBadge`, `ResiWidget`), Preferences → Video.

## 5e. Modes (1.22)

`lib/appMode.ts`: `appMode` in the data file is `full`, `service` or `companion`. Service Mode keeps
Services, ProPresenter, Clock, Mic board and Parent paging; `serviceModeGuard` (before every API
router) answers 403 `service_mode` for Workflows, Check-Ins (`/services/plans/:st/:plan/checkins`,
`team-checkins`), the Dashboard, team groups/phones, volunteer check-in and the Chat embed. The
PIN is stored as a scrypt hash; `PUT /api/app-mode` needs it to leave Service Mode, and
`POST /api/app-mode/unlock` opens everything for 15 minutes (5 wrong PINs → a minute's wait). Web:
`lib/appMode.tsx` (`useAppMode`, `PinDialog`), the sidebar filter and closed-page screen in
`(app)/layout.tsx`, `/setup-mode` (the mode picker) and the Preferences lock.

## 5f. (NDI output was removed in 1.13)

## 5g. Parent paging and the Kids & Nursery iPads

- `lib/propresenter.ts`: ProPresenter 7.9+ Network API over HTTP (`/version`, `/v1/themes`,
  `/v1/messages`, `/v1/message/{id}/trigger` with `[{name, text:{text}}]`, `/clear`). Discovery runs
  Bonjour (any service type containing "pro", plus `_pro7proremote._tcp`) and a /24 scan of this Mac's
  networks on the configured and common ports; every hit is confirmed with `GET /version`.
- `lib/paging.ts`: one page at a time. `page()` takes a server-side lock for `onScreenSeconds`
  (default 15) before calling ProPresenter, so the app and all iPads share it; a second page gets
  409 with the seconds left. The message is cleared when the time is up. Managed mode keeps a
  "Sundays · <Ministry>" message (text with a `{code}` token, chosen theme slide); existing
  mode triggers a chosen message/token. Only the security code is sent.
- `kiosk.ts`: a second Express app on 0.0.0.0:47130 (only when enabled) serving `kiosk.html`,
  `/_next/static` and `/api/kiosk/:ministry/*`. Per-ministry PIN (scrypt), httpOnly session cookie
  tied to the PIN version, rate-limited unlock. Children = today's check-ins in the ministry's
  rooms, not volunteers, not checked out. Check-Ins access borrows the "owner" (who last saved
  paging settings) via `pcoForUser`. Token refreshes are single-flight per refresh token across clients.

## 5h. Tuning keys and Waves SuperRack

`SongKeys` lists song items in sequence with `songKey` (item `key_name`, else included `key`).
`lib/waves.ts` parses keys (sharps and flats kept separate, minor → its letter) and sends over Web MIDI
from the renderer (Electron grants MIDI to our origin only): `[0xB0|ch, 32, bank]`, `[0xC0|ch, pc]`
for snapshot N (bank = (N-1)/128, pc = (N-1)%128). Settings live in `AppSettings.waves`.

## 5i. Loading services

The services list loads per service type (`usePlans`: service types, then one query per type), so
each type shows and opens as soon as it arrives. Roster counts on tiles load only when a tile is on
screen, two at a time in the browser, and on the server with low priority (`lowPriority` limits them
to 60% of the Planning Center rate budget) so opening a service never waits behind them.

## 5j. Updates

`desktop/src/updater.ts` checks `GET /repos/{owner}/{repo}/releases/latest`, compares versions,
downloads `*-mac.zip`, verifies it against `SHA256SUMS.txt`, unpacks with `ditto`, checks the new
bundle's id, version and code signature, then a detached script waits for the app to quit, moves the
old bundle aside, copies the new one in (restoring the old one on failure), clears quarantine and
reopens it. Squirrel/electron-updater isn't used because it requires a Developer ID signature. The
updater registers with the server (`/api/updates`) so Settings can drive it; the app menu has
"Check for Updates…". Releases are built by `.github/workflows/release.yml` on tag push, optionally
re-signed with a self-made certificate (`build/after-sign.cjs`) so the Keychain ACL for safeStorage
survives updates.

## 5k. Run sheet editing, Live, compare

Edits go through PcoApi (createItem/updateItem/deleteItem/reorderItems via `item_reorder`,
saveItemNote/deleteItemNote with item note categories, song catalog `songs` + `arrangements?include=keys`)
and return the fresh item list. Live control posts `live/go_to_next_item | go_to_previous_item |
toggle_control`; "you control" = the Live controller is the signed-in person. Actual times come from
`items?include=item_times` (each ItemTime names its plan_time) and are compared per item
(`web/lib/runsheet.ts`), matching another plan's items by title. Operator views are stored in the
data file (`runSheetViews`).

## 5l. Dashboard, ProPresenter control, Smaart

`/api/pro` aggregates a ProPresenter computer's state (active presentation with slides, slide index,
current/next text, timers with their durations, stage message/screens/layouts, clear groups, looks)
and performs actions; slide thumbnails are proxied and cached. Smaart: a
WebSocket client to `ws://host:26000/api/v4/` (password when asked). A plain `get` lists the measurements with
their `streamEndpoint`s; each active one is streamed over its own WebSocket. Any SPL-looking numbers
(LAeq, LASlow, LCeq…) are kept; failing that, an approximate overall level (dBZ, and dBA when
frequencies come too) is summed from the spectrum. Unknown targets are remembered by sequence
number and not asked again. Dashboard layout and these settings live in
the data file (`extras`).

## 5e. Settings

Theme (dark / light / system), logo (a data URL) and start-up view live in the data file.
`/start` routes to the chosen first screen after launch or sign-in. Every color is a CSS variable
(`globals.css`), so switching theme is instant, and a tiny inline script applies the saved theme
before the first paint.

## 6. Frontend state

- **React Query** owns server state (`['board', wfId]`, `['plan', stId, planId]`, …).
- **Zustand** (`kanbanStore`) owns ephemeral UI state: active drag, open card drawer, filters, and
  the optimistic column map used during a move. On drop: `moveCard` updates the column map
  immediately → mutation calls `/api/workflows/:wf/cards/:id/move` → on error, restore snapshot
  and toast.
- **dnd-kit** for accessible drag (mouse, touch, keyboard).

## 7. Demo sessions

"Explore with sample data" (`/api/auth/demo`) creates a session flagged `demo`, which swaps the PCO
client for an in-memory fake with realistic Cool Church data. Real and demo sessions can coexist;
hide the option with `ALLOW_DEMO=false`.

## 8. Building and shipping

- `npm run app`: build and open the app (development).
- `npm run dist:mac` (on a Mac) → `desktop/release/Sundays-<version>.dmg` (universal: Apple
  Silicon + Intel). It's ad-hoc signed. For friction-free installs on other Macs, sign with an
  Apple Developer ID and notarize (see README).

## 5m. Allen & Heath consoles and the Preferences window

`server/src/lib/ahConsole.ts` speaks A&H "MIDI over TCP/IP" (dLive MixRack / Avantis 51325, dLive
Surface 51328, unencrypted): SysEx `F0 00 00 1A 50 10 01 00 0N 03 CH <ASCII> F7` sets input CH+1's
name on base MIDI channel N+1; `0N 01 CH` asks for a name (reply `0N 02 CH <ASCII>`), used by Test
connection. `MicChannel.consoleInputs` (0–2 inputs; two = a double patch) says where each mic's
name goes. `/api/console/plans/:plan` previews and `/send` writes: first names (last initial when
two people share one), ASCII, 8 characters; unassigned mics get their label back. Config lives in
`extras.console`.

Preferences are one component (`web/components/settings/Preferences.tsx`) with tabs picked by the
URL hash (section ids map to tabs in `web/lib/prefs.ts`). The Mac app opens `/preferences` in its
own BrowserWindow (menu, ⌘, or `POST /api/desktop/preferences`); in a browser it's a page, and old
`/settings` links render the same component. Windows keep each other current: every successful
mutation posts on a BroadcastChannel and the other windows invalidate their queries; the theme
follows through the `storage` event.

## 5n. Staying signed in to Planning Center

Access tokens last two hours; the refresh token can be used once. Every request builds its own
`PcoClient` from the saved tokens, so two requests can find the token expired at the same moment.
`refreshesInFlight` shares one refresh per refresh token (kept 15 minutes, so a request started with
the old tokens gets the new ones), and each client re-reads the saved tokens before refreshing and
again if Planning Center refuses (someone else may have just rotated them). A 401 right after a
refresh isn't treated as expiry (no refresh storms). If Planning Center really refuses the refresh
token, the saved tokens are removed and the API answers 401 `reauth_required`; the web app then
shows the sign-in page with "Planning Center signed you out" (it doesn't bounce back to /start) and
signing in returns to the page you were on. Sign-in problems are written to `cool-services.log`.

Planning Center answers **401** (not 403) when a sign-in can't use one product (seen with Check-Ins)
while the same token works for Services. Treating that as an expired token rotated the tokens on
every Check-Ins poll and eventually signed people out. `tokenLastOk` remembers when each access
token last worked (or probes `/people/v2/me` once); a 401 from a token that works elsewhere is a
`productDenied` PcoError: no refresh, answered as 403 `no_access` (or the Check-Ins message), and
logged with Planning Center's reason and the token's scopes. Sign-in also logs the scopes granted.

## 5o. FOH companion (1.14)

`appMode` (extras) is `full` or `companion`; `/start` and the sign-in page send a companion to
`/companion`, and an unset mode to `/setup-mode`. Main side (`server/src/lib/companion.ts`):
`startPairing()` makes a 6-digit code (10 minutes); `POST /api/companion/pair` on the LAN listener
(`kiosk.ts`, the iPad port) swaps it for a random token, stored only as a sha256 hash in the paging
store. `GET /api/companion/state` (Bearer) returns requests **without child names**;
`POST /api/companion/act` accepts / holds / denies (`paging.sendRequest`, `holdRequest`,
`cancelRequest`, with `decidedBy` = "FOH (name)"). The LAN listener runs when iPads are on, a pairing
code is open, or a companion is paired. Companion side: `findMains()` scans local subnets for
`/api/companion/hello`, `linkTo()` pairs, and `poll()` runs every second. Attention (any waiting,
un-held request) goes through `setAttentionBridge` to Electron, which loads `/companion`, puts the
window always-on-top at screen-saver level, simple-full-screen on every Space, and focuses it; it
undoes that when attention clears. The main app only shows its banner.

## 5p. Team check-ins (1.14)

`GET /api/services/plans/:st/:plan/team-checkins` takes the plan roster (not declined) and
`getCheckIns` rows, and marks each person with their first check-in time (matched by person id).
Check-Ins errors come back as `checkInsError` (roster still shown). Ministries are `teamGroups`
(extras, a team in one ministry); `knownTeams` remembers every team seen so ministries can be set
up for teams not on the current service. The page polls every 15 seconds.

## 5q. Workflow access (1.14)

`listWorkflows()` adds `myReadyCount` (Planning Center's `my_ready_card_count`; not used with a
shared token, where "my" is the token owner), `myShare` (from `include=shares`, when the person may
see shares), `mine`, `canOpen` (mine, or People manager / site administrator from
`/people/v2/me`), and `canManage` (share group Manager, or admin). Sharing uses Planning Center
WorkflowShares (`/people/v2/workflows/:id/shares`, create / patch group / delete), allowed only
when `canManage`. Access requests are local (`workflowRequests` extra): the requester's pending
requests, and pending requests for workflows the viewer manages; approving creates the share. The
board page shows a locked screen for workflows that aren't `canOpen` (the gate is in Sundays;
Planning Center's own permissions still apply underneath). `WorkflowWatcher` in the app layout
fetches boards of `mine` workflows each minute, compares card ids with those seen before (per person,
localStorage) and toasts new ones; it also toasts new requests to review and answers to yours.

## 5r. Run sheet inline editing (1.14)

In Edit mode the run sheet swaps titles, lengths, descriptions and the visible note columns for
`Inline` fields (with "Everyone", every note category shows so a new note can be added). A field
saves on blur via `editItem` / `saveNote` / `deleteNote` and applies the returned items; a refused
save keeps the text and focus. The 10-second refresh pauses while editing.

## 5s. Team check-ins on phones and staff check-ins (1.15)

`server/src/lib/teamCheckins.ts` builds the Team check-ins view for both the desktop route and the
phones: roster (not declined) + Check-Ins rows + **staff check-ins** (`staffCheckIns` extra). Planning
Center's Check-Ins API has no create endpoint, so a staff check-in is local: `staffCheckIn()` finds
every plan the same local day (`listUpcomingPlans`) where the person is scheduled and records one row
per plan and team; `staffUndo()` removes that day's rows. Each person carries `checkedInVia`
("checkins" | "staff") and `checkedInBy`. Phone requests share one computation per plan for 8 s.

The phone pages ride on the LAN listener in `kiosk.ts` (the iPad port): `/leads` and `/staff` serve
`team.html` (the static export of `web/app/team`), and `/api/team/:role/{info,unlock,lock,data,checkin}`
is all a phone can reach. Settings live in the `teamPhones` extra: on/off, friendly hostnames, a
scrypt-hashed PIN per role (a new PIN signs that role's phones out), sessions (httpOnly `cs_team`
cookie; a staff session may also read the leads view, not the other way), and the owner whose
Planning Center access is used (whoever last saved them). `GET /` on a host matching a saved name, or
starting with `staff.` / `leads.`, redirects to that page. Desktop settings: `/api/team-phones`.

## 5t. Volunteer event and team locations (1.16)

`volunteerCheckIn` (extras): `events[serviceTypeId] = {id, name}` (a Check-Ins event) and
`teamLocations[teamId] = {id, name}` (a location in it). Set in Preferences → Team Check-ins via
`/api/volunteer-checkin` (GET returns service types with `listTeams()`, and events grouped from
`listCheckInLocations()`, which now carries `eventId`; check-in rows carry `eventId` too).
`teamCheckIns()` keeps only rows for the chosen event, adds `location` / `expectedLocation` per
person and `event` (null → the page prompts for setup). `staffCheckIn()` stamps kind Volunteer, the
event and the team's location; `staffRows()` turns a plan's staff check-ins into `CheckInRow`s
(`byStaff`) merged into `/plans/:st/:plan/checkins` unless Check-Ins already has that person.

## 5u. Production clock (1.17)

- `shared/clock.ts`: types and `readClock()`. The state stores absolute times (startedAt, elapsedMs,
  durationMs, targetAt), so each screen computes the display from its own clock plus the server's
  offset (`serverNow`); nothing is pushed every second.
- `server/src/lib/clock.ts`: the engine. Actions (start/pause/toggle/reset/add/set/message/blank/
  load/next/prev/colors/info/style), presets with `nextPresetId` (loaded and started when the main
  timer reaches zero) and weekday/time schedules (checked each minute), a secondary that can start
  when the main ends, and Planning Center lookups for "until service" (next service time, re-checked
  each minute) and "Live item" (polled every 3 s) using whoever last used the clock. Persisted in the
  `clock` extra.
- `server/src/routes/clock.ts`: `/api/clock` (signed in) and `/api/clock-out` (no sign-in, also on
  the LAN listener when "On the church network" is on): `/state`, `/stream` (server-sent events) and
  `/control/<key>/<action>[/<value>]` for Stream Deck / Companion.
- Web: `/clock` (control), `/clockout` (the output: `ClockFace`, laid out like a broadcast production
  clock; `?ndi=1` uses the transparent setting), the Dashboard widget, Preferences → Video → Clock
  outputs. The LAN listener serves `clockout.html` at `/clock`.
- Desktop: `clockOut.ts` renders `/clockout?ndi=1` in an off-screen window and sends each frame
  through `ndiLib.ts` (koffi → `NDIlib_send_send_video_v2` on a worker thread, BGRA with alpha or
  BGRX, clock_video off and paced by Sundays); it also opens the second-display window and
  reports displays. `build.mjs` copies koffi's Mac binaries to `app/native/koffi` and extracts
  `libndi.dylib` from NDI's SDK installer to `app/native/ndi` (unpacked from asar; `x64ArchFiles`
  covers them for the universal build). `COOL_NDI_FAKE=<folder>` writes frames as PNGs for testing.

## 5v. Mic board & stage display (1.18)

- `shared/board.ts`: settings and `DisplayState` (view, banner, service, tiles, Micboard).
- `server/src/lib/board.ts`: picks the service (`serviceTypeId` or any; the first upcoming plan that
  isn't over), the view (manual, or auto from the plan's rehearsal/service times), and builds tiles
  from the mic setup + this plan's assignments + `micStatuses()` (receivers read at most every 2 s,
  shared with `/api/mics/status`; the ULX-D sample now also gives `audioLevel`). Status: no receiver /
  offline / TX off / critical (interference, ≤1 bar or ≤30 min) / low (≤2 bars or ≤60 min) / ok. Pictures:
  `customImages["person:<id>"|"mic:<channelId>"]` (uploaded files) and/or the roster's Planning Center
  photo. The state is shared for 1.5 s however many displays poll it. Uses the access of whoever last
  opened the Mic board.
- `server/src/routes/board.ts`: `/api/board` (signed in: settings, pictures) and `/api/board-out`
  (no sign-in: `/state`, `/image/<file>` limited to board pictures). The LAN
  listener serves `/display` (`displayout.html`) and `/api/board-out` when the network display is on,
  and lets `/api/clock-out` through for the Clock view.
- Web: `/micboard` (control + preview + settings drawer), `/displayout` (polls every 2 s),
  `components/board/` (`MicBoard` tiles sized with container units, `DisplayView` with the banner,
  Micboard in an iframe, and the clock through `ClockFace`). Desktop: `boardOut.ts` opens the second-display window.
