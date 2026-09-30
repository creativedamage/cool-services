# Cool Services

A dark-mode Mac app that makes Planning Center People workflows and
Services scheduling faster.

- **Workflows board**: the People workflows assigned or shared to you as a drag-and-drop Kanban board. Each card shows the
  person's photo, email and phone, card and profile notes, staff-only notes, and email sent through
  Planning Center. The **Schedule in Services** button schedules them in one click.
- **Services**: every upcoming plan on one screen. The plan view puts the roster, open slots and
  run sheet side by side. You can fill a slot in one click with conflict checks, and confirm,
  decline, replace or remove people from the row.
- **Matrix**: several weeks of a service type side by side (4–12 weeks, optionally the last two):
  every team and position, who's on it with their status, open slots, and each week's songs and
  keys. Hover a name to see all the weeks that person serves. Open it from "Matrix" in the sidebar.
- **Full run sheet** (the "Run sheet" tab on a service): clock times for the chosen service time,
  lengths, descriptions and Planning Center notes as columns.
  - **Views** for each operator (Lighting, Video, Stage manager…): pick which note categories show,
    their order, one to highlight, and which plan notes appear at the top.
  - **Edit** (E): everything on the sheet becomes editable in place. Click a title, length,
    description or note and type; it saves to Planning Center when you leave the field (Enter on
    one-line fields, Esc to undo). Add headers, items, media and songs from the Planning Center song
    catalog, move and delete items. A song's arrangement and key are still in its item window (the
    pencil).
  - **Planning Center Live**: follows the current item (time used / left), and Previous / Next /
    Take control drive Live from here.
  - **Compare**: actual times against another service time (the 9:00 while you run the 11:00) or
    another campus's service the same day, per item and "how far later/earlier at this item".
  - **Watch**: other services' Live position and over/under in a side panel.
  - Full screen, text size and print. Keys: F, + / −, L, E, P.
- **Dashboard**: widgets for service flow: tuning keys (sends to Waves), SPL from Smaart, Shure wireless (who's on it, battery, RF),
  Planning Center Live, a clock with the countdown to service, and ProPresenter control. Edit to
  add, remove, resize and reorder; the layout is saved on this Mac.
- **ProPresenter**: watch and take over any ProPresenter computer (e.g. side screens): click a slide
  to show it, previous / next, clear layers, clear groups and looks, timers (start, stop, reset,
  change the time, ±30 s / 1 min), stage message and each stage screen's layout. Add computers in
  Preferences → Video; the Kids & Nursery one from paging is included automatically.
- **Chat**: Planning Center Chat inside Cool Services (sidebar → Chat): current conversations, new
  ones, teams and direct messages. Planning Center has no public Chat API, so this is Planning
  Center's own Chat shown in the app window, using your Planning Center sign-in.
- **Message the team**: on any service, text or email one person, a team, or everyone (by status).
  It opens a message in Messages on this Mac addressed with their mobile numbers from Planning
  Center, like Planning Center's mobile app does (there's no API for sending texts).
- **Tuning**: every song's key, big, across the top of each service in service order ("Song 1 · A",
  "Song 2 · Db"). With Waves SuperRack connected in Settings, pressing a key recalls that key's
  SuperRack snapshot over MIDI.
- **Mics & packs**: under each service's info, assign vocal mics and packs to the people
  serving (one person can have a vocal mic and a pack). **Auto-assign** matches by position and
  puts people back on the mic they had last time. With Shure receivers on the network, each tile
  shows live battery, runtime, antennas and signal. The connection is read-only: nothing on the
  receivers or in Wireless Workbench is ever changed.
- **Team check-ins** (sidebar): a tile per team (Safety, Greeters, Production…) showing how many of
  the people scheduled on a service have checked in with Planning Center Check-Ins, like **8/10**,
  grouped under ministries you set up (**Ministries** button). Tap a tile for who's in and who
  isn't, and **Check in** anyone by hand.
- **Team check-ins on phones**: the same page for phones on the church Wi-Fi. **/leads** for team
  leads (every team, with names), **/staff** for staff (plus a big Check in button). Each has its
  own PIN. Friendly addresses like `staff.yourchurch.org` and `leads.yourchurch.org` work too.
- **Check-ins**: a Check-ins tab on every service shows who's checked in (Planning Center
  Check-Ins) for that service, grouped by room, with regulars, guests, volunteers and check-outs.
  It refreshes every 10 seconds and highlights new arrivals.
- **Stage plots**: build plots on a blank stage or on top of your own PDF (any page) or image.
  Link items to a mic or a position and each service's Stage plot tab fills in who's where. Print
  from there.
- **Parent paging (ProPresenter)**: show a child's security code on the auditorium screens as a
  ProPresenter message: from **Parent paging** in the sidebar, the Page button on any service's
  Check-ins tab, or the Kids and Nursery iPads. While a page is on screen (15 seconds by default),
  paging is locked for everyone so one page never replaces another.
- **Kids & Nursery iPad pages**: a separate page for each ministry, locked with its own PIN, that
  iPads open in Safari on the church Wi-Fi. It shows that ministry's checked-in children; tap a
  child, then **Page the Auditorium**.
- **Settings** (⚙ next to your name): dark, light or follow the Mac; your own logo; and which
  screen opens first (a workflow, the services list, the next service, or its check-ins).
- **Sign in with Planning Center**: people click it, log in on Planning Center's own page, and
  they're set up. Nothing else to enter.

## Build the DMG (on your Mac)

You need Node.js 22.12 or newer (`node -v` to check). Get it from https://nodejs.org (LTS).
Nothing is compiled during `npm install` (NDI was removed in 1.13, which is what used to make it slow).

```bash
npm install
npm run dist:mac
```

The installer lands at **`desktop/release/Cool-Services-<version>.dmg`**. It runs on both Apple Silicon
and Intel Macs.

To try the app without making a DMG: `npm run app`.

### Updating

Cool Services updates itself from this project's GitHub Releases: **Cool Services → Check for
Updates…** in the menu bar, or **Preferences → About**. It also checks on its own a few seconds after
opening and every six hours, and shows "Update to x.y.z" at the bottom of the sidebar when there's
one. **Update now** downloads it, checks it against the release's checksums, closes Cool Services,
replaces the app in Applications and opens the new version. Sign-ins, settings, notes and stage plots
stay as they are (they live in `~/Library/Application Support/Cool Services`).

The app must be running from the Applications folder (not from the DMG) to update itself.
Versions before 1.7.0 don’t have the updater: install the first GitHub release from its DMG once.

### Installing on a Mac

1. Open the DMG and drag **Cool Services** into **Applications**.
2. **First open only:** double-click Cool Services. macOS says it can't verify the app. Open
   **System Settings → Privacy & Security**, scroll down, click **Open Anyway** next to Cool
   Services, and confirm. macOS asks this once, because the app isn't signed with a paid Apple
   Developer ID (see below).
3. Click **Sign in with Planning Center**.

Each Mac keeps its own sign-in and staff-only notes in `~/Library/Application Support/Cool Services`.
The key that protects saved sign-ins is stored in the macOS Keychain.

### Skipping the "Open Anyway" step (optional)

With an Apple Developer account ($99/year), sign and notarize the app so it opens normally on any Mac:

1. In `desktop/package.json`, change `"identity": "-"` to your certificate name, e.g.
   `"Developer ID Application: Your Name (TEAMID)"`, and add `"notarize": true` under `"mac"`.
2. Build with your Apple ID details set:
   `APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… APPLE_TEAM_ID=… npm run dist:mac`

## Parent paging and the Kids & Nursery iPads

1. In ProPresenter (7.9 or newer): **Settings → Network → Enable Network**. Note the port.
2. In Cool Services: **Preferences → Network Connections → ProPresenter** → **Find automatically** (or type the computer's IP
   and port) → the status turns green. Set **Page stays on screen for** to match your ProPresenter
   message time (15 seconds by default).
3. **Parent paging**, for Nursery and for Kids:
   - *Cool Services message*: Cool Services creates and keeps a message called "Cool Services ·
     Nursery" in ProPresenter with your text (`{code}` is replaced by the tag code) and the **theme**
     you choose. Or *My existing message*: pick a message you already use and the token the code goes in.
   - Tick that ministry's **Check-Ins rooms**, and set its **iPad PIN** (4–8 digits).
   - **Send a test page** puts "TEST" on the screens.
4. **Kids & Nursery iPads** → turn on. Each ministry gets its own address, e.g.
   `http://192.168.1.30:47130/nursery` and `/kids`, with a QR code. On the iPad, open it in Safari,
   enter that ministry's PIN, then Share → Add to Home Screen. Guided Access keeps it on the page.

Notes:
- Only the security code goes to the screens. Children's names stay on the iPad.
- The Mac running Cool Services must be on, awake and on the same network during services. The first
  time, macOS asks to allow incoming connections for Cool Services: choose **Allow**.
- The iPad pages read Check-Ins with the Planning Center access of whoever last saved these settings.
- The iPad server only serves the iPad page and its own small API. Staff screens, notes, people and
  plans can't be reached from the network. A wrong PIN 5 times locks that iPad out for a minute (doubling).
- Changing a PIN signs out that ministry's iPads.

## Matrix

Services → a service type → **Matrix**: several weeks side by side.

- **Drag** someone onto another position or week to move them there (hold **⌥ Option** to copy
  instead). **Send requests** (top) decides whether Planning Center sends a scheduling request.
- **Hover** someone for **Profile**, **Target** (keeps them highlighted everywhere until you clear it),
  **Change…** (someone else in that spot, or them in another position) and **Remove**.
- **Click** someone for their profile: emails, phones, address, what they're scheduled for, blockouts,
  and **Send an email**. Planning Center's API only sends email to people in a workflow (it goes from
  you and is logged on their card); for anyone else **Open in Mail** starts it addressed to them.

## Campuses

Preferences → **Campuses**: add campuses, choose the campus each service type belongs to, and set **My
default campus**. Cool Services opens on your default campus; the switcher at the top of the sidebar
shows another campus (or all) for now. The Services list, the sidebar and Schedule in Services
follow it (Schedule has an "All campuses" link). Campuses are kept on this Mac; the default is per person.

## Preferences

**Cool Services → Preferences…** (⌘,) opens Preferences in their own window (the ⚙ next to your
name does too):

- **About**: version, and Check for Updates.
- **Appearance**: dark / light / system, and your logo.
- **Default Startup**: what opens first: the Dashboard, Services, the next service, its run sheet or
  check-ins (for "your service" from the Dashboard, or a chosen type), a workflow, ProPresenter or
  Parent paging.
- **Campuses**: group service types by campus, and your default campus.
- **Audio**: Allen & Heath console, Waves SuperRack, Smaart.
- **Network Connections**: ProPresenter for paging, Kids & Nursery paging and the iPad pages.
- **Video**: ProPresenter computers.

## Allen & Heath dLive / Avantis channel names

Put the names from a service's Mics tab on the console's channels.

1. **Preferences → Audio → Allen & Heath console**: turn it on, choose dLive (MixRack or Surface) or
   Avantis, and enter its IP address. The port fills in (dLive MixRack / Avantis 51325, dLive Surface
   51328). **MIDI ch.** is the console's base MIDI channel (dLive: Utility → Control → MIDI, usually
   1; Avantis: usually 12). **Test connection** reads input 1's name.
2. **Set up mics** (⚙ on a service's Mics panel): tick **Console** on each mic and enter its input.
   For a double patch (e.g. a second input for in-ears), enter the second input too; both get the
   same name. Campuses without a double patch just leave it empty.
3. On a service, **Names to dLive** shows what will be written and sends it: first names (with a last
   initial when two people share one), at most 8 characters; mics nobody is on get their own label
   back ("Vox 3"). Only channel names change on the console.

## Waves SuperRack (Tuning keys)

Preferences → **Audio → Waves SuperRack**: turn it on, choose the MIDI output and channel, and enter each key's
snapshot **External ID** as SuperRack shows it (0139 → 139). Pressing a key on a service's Tuning bar
sends Bank LSB (CC 32) + Program Change. SuperRack's External IDs run 125 to a bank (1,000 over 8
banks), so ID 139 is Bank 1 / Program 14. ("Numbers are → Program numbers" switches to plain
1-based numbering, 128 to a bank, for other setups.)

- SuperRack on the same Mac: Audio MIDI Setup → Window → Show MIDI Studio → IAC Driver → tick
  **Device is online**, then choose "IAC Driver Bus 1".
- SuperRack on another Mac: Audio MIDI Setup → MIDI Studio → Network. Create and connect a session on
  both Macs (rtpMIDI on Windows) and choose it in Cool Services. On the SuperRack Mac, if SuperRack
  doesn't react to a "Network MIDI 2.0" session, route the session into IAC Driver Bus 1 (Live
  Routings, incoming only; routing both ways makes a MIDI loop) and have SuperRack listen to Bus 1.
- In SuperRack: Controllers → MIDI Controller → gear → tick that port under MIDI IN, set **Follow
  Program Changes on Channel** to your channel, and give each snapshot an External ID.

Keys come from Planning Center (the key chosen on the service item, otherwise the arrangement's key).
The keys with their own snapshot are C, Db, D, Eb, E, F, F#, Gb, G, Ab, A, Bb and B. A song in C#, D#,
G# or A# uses the flat's snapshot (C# → Db), and a minor key uses its letter's (F#m → F#).

**Chromatic Tune** and **Tuning Off** buttons sit before the songs on the Tuning bar and the
dashboard; give each a snapshot in Preferences → Audio. Song items that aren't songs (e.g. "Vocal Warm
Ups") can be left off the Tuning bar under "Leave off the Tuning bar".

## Dashboard and Smaart

- **Your service**: at the top of the dashboard, pick your campus (service type). The clock, Live,
  tuning and wireless widgets, and the Live widget's Run sheet link, follow that campus's next plan.
  Pick a plan in the second list to pin it; "Next one (automatic)" moves on by itself. A widget can
  still be set to another service type in its options.
- **Smaart v9 SPL**: in Smaart, start logging on a calibrated input and turn on Options → API
  (default port 26000, optional password). In Cool Services, Preferences → Audio → Smaart (SPL): enter the
  computer and password, then Save and connect. Cool Services lists Smaart's measurements (e.g. RTA
  MIC, REF) and streams each one. SPL values Smaart sends are used as they are; otherwise the overall
  level is worked out from the measurement's spectrum (marked ≈, accurate only if the input is
  calibrated). Pick a reading for the SPL widget in its options. Rational Acoustics hasn't published
  the full data format, so if readings don't appear, open "What Smaart is sending" in Settings, press
  Copy and send it to us.

## Page requests (you decide when pages go up)

With **Hold iPad pages until I send them** on (Preferences → Network Connections → ProPresenter,
on by default), the Kids and Nursery iPads **request** a page instead of putting it straight on the
screens. A bar across the top of every Cool Services screen shows each request (ministry, code,
child, how long ago) with **Send now** and **Cancel**, plus **Send all** when there are several.
Sent pages go up as soon as nothing else is on screen, one after another. The iPads show each
request as "Waiting for the auditorium", "On the screens" or "Not sent". Pages started in Cool
Services itself go straight up. Requests are kept while Cool Services is open.

## FOH companion (a second computer at front of house)

A second Mac can run Cool Services as an **FOH companion**: a full-screen panel that only handles
Kids and Nursery page requests.

1. On the main Cool Services Mac: Preferences → Network Connections → **FOH companions** → **Pair a
   companion**. A 6-digit code appears (good for 10 minutes).
2. On the FOH Mac: install Cool Services and choose **FOH companion** when it asks how this computer
   is used (or "Use it as an FOH companion" on the sign-in screen, or Preferences → Default Startup).
   It finds the main Mac on the network; pick it (or enter its address) and type the code.

When a Kids or Nursery iPad asks for a page, the companion takes over its screen with the ministry
and tag code and three big buttons: **Accept** (goes up as soon as the screens are free), **Hold
until clear** (keeps it waiting without taking over the screen) and **Deny**. The companion never
shows a child's name. The main Mac keeps its banner and can accept or cancel requests too; it never
takes over its own screen. Unpair a companion from the same Preferences section.

## Workflows: yours, and asking for others

The Workflows page shows **My workflows**: the ones with cards assigned to you or shared with you
by name in Planning Center. Other workflows are locked with **Request access**. A request shows up
for that workflow's managers (and People managers / site administrators) under **Access requests**
on the Workflows page and as a notification; **Approve** as Viewer, Editor or Manager shares the
workflow with that person in Planning Center, and it appears under their My workflows.

- Managers can also share directly: the **Share** button on a board (or the share icon on its tile).
  This is Planning Center's own workflow sharing, so it applies everywhere.
- Requests are kept on the Mac where they were made. If the manager uses Cool Services on a
  different computer, the requester can send a quick email from the request window and the manager
  adds them with Share.
- People managers and site administrators still see every workflow, under "Other workflows".
- New cards on your workflows pop up as a notification (with Open), checked every minute.

## Volunteer event and areas of serving

Preferences → **Team Check-ins** (the Team check-ins page asks until it's set): for each service
type, choose the Planning Center Check-Ins **event** volunteers check in to (e.g. "Sunday
Volunteers"), then give each **team** its **location** in that event (Hospitality → Main Lobby,
Production → Production Booth). **Match by name** fills in the obvious ones. Press **Save** when
you're done (Discard puts it back). Only your campus's service types show (your default campus in
Preferences → Campuses; "Show all campuses" shows the rest), and saving never changes another
campus's setup.

- Only check-ins to that event count on Team check-ins (checking your own kids in doesn't count as
  serving).
- A staff **Check in** records the person as a **Volunteer** at their team's location, in that event,
  on every service that day they're on. They show on the service's Check-ins tab in that room, marked
  "by staff".
- Tiles show each team's area; anyone who checked in at a different location is flagged.
- Planning Center's API can't create check-ins, so these stay in Cool Services and don't appear in
  Planning Center's own Check-Ins reports.

## Team check-ins on phones (leads and staff)

Preferences → Network Connections → **Team check-ins on phones**: turn it on and set a PIN for
**Team leads** and one for **Staff**. Phones on the church Wi-Fi open the address shown there (or scan
the QR code), enter the PIN once and stay signed in; Share → Add to Home Screen makes it an app.

- **Team leads** (`/leads`): every ministry and team with how many are in (8/10), who's in and who
  isn't. Filter to one ministry, or search for a name.
- **Staff** (`/staff`): the same, plus **Check in** next to everyone who isn't in yet. One tap checks
  that person in on **every service that day** they're scheduled on, on each of their teams (for
  example the 9:00 and 11:00 plans, or two campuses). Staff can add their name so check-ins show
  "by Wayne (staff phone)"; a staff check-in can be undone from the same row.
- The desktop Team check-ins page has the same Check in button.
- Planning Center's Check-Ins can't be written to by other apps (its API is read-only), so staff
  check-ins are kept by Cool Services on this Mac. They count on every Team check-ins screen, marked
  "by staff", but don't show in Planning Center's own Check-Ins reports. Scans in Check-Ins count
  automatically.
- Phones only get names, photos, positions and check-in times, never contact details. They use the
  same port as the Kids & Nursery iPads.
- **Friendly addresses**: enter e.g. `staff.libertychurch.net` and `leads.libertychurch.net`, then
  set them up like the iPad names below (a DNS A record for each pointing at this Mac's fixed IP, and
  Port 80). Any address starting with `staff.` or `leads.` works even before it's entered.

## Friendly iPad addresses (kids.yourchurch.org)

Preferences → Network Connections → Kids & Nursery iPads → **Friendly addresses**: enter e.g.
`kids.libertychurch.net` and `nursery.libertychurch.net`. Then:

1. Give the Cool Services Mac a fixed IP (a DHCP reservation in the router/firewall).
2. Add a DNS **A record** for each name pointing at that IP: in the router/firewall's local DNS, or
   in the domain's public DNS (it only resolves to something useful on the church network, since the
   IP is private).
3. Set the iPad **Port** to **80** so nobody has to type a port.
4. On the iPads open `http://kids.libertychurch.net` (with `http://`), enter the PIN once, and add it
   to the Home Screen again.

Any address starting with `kids.` or `nursery.` goes to that page, even before the names are
entered in Preferences.

## Check-ins permission

Check-ins need Planning Center **Check-Ins** access. Someone who signed in before Check-Ins was
added is asked to sign in again once (and comes back to the same page). If Planning Center still
says no after that, their Planning Center account doesn't have Check-Ins permission: the Check-ins
tab says so (with Planning Center's own message) instead of asking to sign in again. An
administrator can give access in Planning Center People → the person → Permissions → Check-Ins.
With a shared personal access token, that token's account needs Check-Ins access.

## If something feels slow

Planning Center requests that take longer than a second are noted in
`~/Library/Application Support/Cool Services/cool-services.log` (only the request path and timing,
no personal data). Send that file along when reporting slowness.

## GitHub and releases

### One-time setup

1. On github.com, create a new **public** repository (e.g. `cool-services`). Don't add a README or
   license. Leave it empty.
2. In Terminal, in this folder:

   ```bash
   npm run set-repo -- YOUR-GITHUB-NAME/cool-services
   git add -A && git commit -m "Point updates at GitHub"
   git remote add origin https://github.com/YOUR-GITHUB-NAME/cool-services.git
   git push -u origin main
   ```

   The project is already a git repository with its history committed.
3. Optional but recommended: `bash scripts/make-signing-cert.sh`, then add the two values it prints
   as repository secrets (Settings → Secrets and variables → Actions): `MAC_CERT_P12` and
   `MAC_CERT_PASSWORD`. Releases are then signed with the church's own certificate, so macOS keeps
   "Always Allow" for Cool Services' Keychain item after updates instead of asking again. Keep the
   `.p12` file out of the repository (it's in `.gitignore`).
4. Publish the first release (1.8.0, the version already in the project):

   ```bash
   git tag v1.16.1 && git push origin v1.16.1
   ```

   When it finishes (Actions tab, about 15 minutes), download `Cool-Services-1.8.0.dmg` from the
   release and install it on each Mac once. From then on, updates come through the app.

### Publishing a new version

```bash
npm run release -- 1.7.1
```

This sets the version, commits, tags `v1.7.1` and pushes. GitHub Actions
(`.github/workflows/release.yml`) builds the universal Mac app on a GitHub Mac and publishes a
release with `Cool-Services-1.7.1.dmg` (first installs), `Cool-Services-1.7.1-mac.zip` (what the
updater downloads) and `SHA256SUMS.txt`. It takes about 15 minutes; follow it under the repo's
**Actions** tab. Edit the release notes on GitHub if you like: they're what "What's new" shows.

Everyone's Cool Services offers the update the next time it checks. To rebuild an existing tag,
run the Release workflow by hand from the Actions tab.

## Planning Center app registration

Cool Services signs in through one **Public** Planning Center OAuth application. Its Client ID is
built into `server/src/pco/registration.ts`. The registered callback URLs are:

```
http://127.0.0.1:47123/api/auth/callback
http://127.0.0.1:47124/api/auth/callback
http://127.0.0.1:47125/api/auth/callback
```

Add `http://127.0.0.1:5173/api/auth/callback` only if you develop in a browser with `npm run dev`.

**Sign-in button logo:** Planning Center's brand guidelines require their official, unedited logo.
Download it from https://www.planningcenter.com/logos and save the full-colour icon SVG as
`web/public/brand/planning-center-icon.svg` before building. Until then the button shows text only.

## Mics & packs (Shure)

1. Open a service → **Mics & packs** → the ⚙ button (**Set up mics**).
2. Add each receiver: name, model, IP address (from the receiver's network menu or Wireless
   Workbench), and channel count. Click **Test**. This Mac must be on the same network as the receivers.
3. List your mics and packs, which receiver channel each is on, and which positions each is for
   (e.g. Vox 1 → Worship Leader, Vox 2–4 → Vocals, AG Pack → Acoustic Guitar).
4. On each service, click **Auto-assign** or pick people by hand. Assignments stay in Cool Services.

**Read-only:** the app only asks receivers questions (Shure's `GET` commands on TCP port 2202):
battery bars, minutes left, charge, transmitter model, frequency, antennas and signal. It never
sets channel names or anything else. The one exception is ULX-D, QLX-D and SLX-D, which have no
plain question for antenna and RF readings. For those, the app briefly turns on meter reports
(`METER_RATE`) for its own connection and turns them off again. This doesn't change any audio,
RF or channel settings.

## Project layout

```
shared/types.ts            Data shapes shared by the UI and server
server/src/app.ts          Built-in server: API + UI on 127.0.0.1
server/src/auth/oauth.ts   Sign in with Planning Center (OAuth + PKCE), sessions
server/src/pco/            Planning Center client, People/Services calls, app registration
server/src/lib/db.ts       Local data file (users, tokens, sessions, staff notes, mics, history)
server/src/lib/shure.ts    Shure receiver status, read-only (TCP 2202)
server/src/lib/propresenter.ts  ProPresenter API client + finding it on the network
server/src/routes/pro.ts   ProPresenter control (slides, timers, stage) for any computer
server/src/lib/smaart.ts   Smaart v9 API client (SPL readings)
server/src/lib/ahConsole.ts Allen & Heath dLive / Avantis channel names (MIDI over TCP)
web/components/settings/Preferences.tsx  the Preferences window (tabs)
desktop/src/embed.ts       Planning Center Chat inside the window
server/src/lib/paging.ts   Parent paging: the on-screen lock, messages, PINs
server/src/kiosk.ts        Kids & Nursery iPad server (network, PIN-locked)
server/src/demo/demo.ts    Sample data for "Explore with sample data"
web/                       The UI (Next.js + Tailwind, exported as static files)
desktop/src/main.ts        The Mac app (Electron)
desktop/src/updater.ts     Check for Updates (GitHub Releases → verify → replace → reopen)
.github/workflows/         Release build on GitHub (tag → DMG + zip + checksums)
scripts/                   set-repo, release, make-signing-cert
desktop/build.mjs          Bundles UI + server into desktop/app
docs/ARCHITECTURE.md       How it all fits together
```

## Developing in a browser (optional)

```bash
npm install
npm run dev        # http://127.0.0.1:5173 (API on :4000)
```
