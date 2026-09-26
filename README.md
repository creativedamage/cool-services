# Cool Services

A dark-mode Mac app that makes Planning Center People workflows and
Services scheduling faster.

- **Workflows board**: your People workflows as a drag-and-drop Kanban board. Each card shows the
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
  - **Edit** (E): add headers, items, media and songs from the Planning Center song catalog (with
    arrangement and key), change titles, lengths, descriptions and notes, move and delete items.
    Everything saves to Planning Center.
  - **Planning Center Live**: follows the current item (time used / left), and Previous / Next /
    Take control drive Live from here.
  - **Compare**: actual times against another service time (the 9:00 while you run the 11:00) or
    another campus's service the same day, per item and "how far later/earlier at this item".
  - **Watch**: other services' Live position and over/under in a side panel.
  - Full screen, text size and print. Keys: F, + / −, L, E, P.
- **Dashboard**: widgets for service flow: tuning keys (sends to Waves), ProPresenter outputs over NDI
  (side screens, confidence monitors), SPL from Smaart, Shure wireless (who's on it, battery, RF),
  Planning Center Live, a clock with the countdown to service, and ProPresenter control. Edit to
  add, remove, resize and reorder; the layout is saved on this Mac.
- **ProPresenter**: watch and take over any ProPresenter computer (e.g. side screens): click a slide
  to show it, previous / next, clear layers, clear groups and looks, timers (start, stop, reset,
  change the time, ±30 s / 1 min), stage message and each stage screen's layout. Add computers in
  Settings → ProPresenter computers; the Kids & Nursery one from paging is included automatically.
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
- **Check-ins**: a Check-ins tab on every service shows who's checked in (Planning Center
  Check-Ins) for that service, grouped by room, with regulars, guests, volunteers and check-outs.
  It refreshes every 10 seconds and highlights new arrivals.
- **Stage plots**: build plots on a blank stage or on top of your own PDF (any page) or image.
  Link items to a mic or a position and each service's Stage plot tab fills in who's where. Print
  from there.
- **Stage plot over NDI®**: send the next service's stage plot as a live NDI source (for example
  "YOUR-MAC (Cool Services Stage Plot)"), then add it as an input in ProPresenter for a multiview.
  Turn it on and choose the name, resolution, frame rate and service in Settings.
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
For NDI output you also need Apple's command-line developer tools, since the NDI add-on is compiled
during install: run `xcode-select --install` once. `npm install` downloads the NDI SDK from ndi.video.
If NDI can't be built, the app still builds and Settings says NDI isn't available.

```bash
npm install
npm run dist:mac
```

The installer lands at **`desktop/release/Cool-Services-<version>.dmg`**. It runs on both Apple Silicon
and Intel Macs.

To try the app without making a DMG: `npm run app`.

### Updating

Cool Services updates itself from this project's GitHub Releases: **Cool Services → Check for
Updates…** in the menu bar, or **Settings → Updates**. It also checks on its own a few seconds after
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

## NDI output

Settings → **Stage plot over NDI** → turn it on. Cool Services renders the next service's stage
plot in the background and sends it over NDI. It updates on its own as mics and the team change,
and moves on to the following service after Sunday. In ProPresenter, add it as a video input
(Screens/Inputs → NDI) and place it on your multiview. The Settings screen shows a live preview,
the source name, and how many receivers are connected.

NDI output works in the Mac app only, and on Apple Silicon Macs when you build the universal DMG
on an Apple Silicon Mac. NDI® is a registered trademark of Vizrt NDI AB (https://ndi.video).

## Parent paging and the Kids & Nursery iPads

1. In ProPresenter (7.9 or newer): **Settings → Network → Enable Network**. Note the port.
2. In Cool Services: **Settings → ProPresenter** → **Find automatically** (or type the computer's IP
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

## Waves SuperRack (Tuning keys)

Settings → **Waves SuperRack**: turn it on, choose the MIDI output and channel, and enter the
SuperRack snapshot number for each key (C, C#, Db, D … B; sharps and flats separately). Pressing a key
on a service's Tuning bar sends Bank LSB (CC 32) + Program Change, which is how SuperRack recalls
snapshots 1–384.

- SuperRack on the same Mac: Audio MIDI Setup → Window → Show MIDI Studio → IAC Driver → tick
  **Device is online**, then choose "IAC Driver Bus 1".
- SuperRack on another computer: Audio MIDI Setup → MIDI Studio → Network. Create and connect a
  session on both Macs (rtpMIDI on Windows), then choose that session.
- In SuperRack: Controllers → MIDI Controller → gear → tick that port under MIDI IN. Save one
  snapshot per key (e.g. Waves Tune Real-Time set to that key).

Keys come from Planning Center (the key chosen on the service item, otherwise the arrangement's key).
C# and Db (and every other sharp/flat pair) are matched separately; a minor key uses its letter's snapshot (F#m → F#).

## Dashboard: ProPresenter outputs and Smaart

- **ProPresenter outputs**: in ProPresenter, turn on NDI for each screen you want to watch (Screens →
  the screen → NDI). On the dashboard, add a "ProPresenter output (NDI)" widget and pick the source.
  Previews use NDI's low-bandwidth stream (about 5 frames a second). Needs the NDI add-on (see
  "Build the DMG").
- **Smaart v9 SPL**: in Smaart, start logging on a calibrated input and turn on Options → API
  (default port 26000, optional password). In Cool Services, Settings → Smaart (SPL): enter the
  computer and password, then Save and connect. The readings Smaart sends are listed there; pick one
  for the SPL widget. Rational Acoustics hasn't published the full API command list, so if your
  readings don't appear, open "What Smaart is sending" in Settings and send it to us.

## Check-ins permission

Check-ins need Planning Center **Check-Ins** access. The first time someone opens the Check-ins tab
after updating, the app asks them to sign in again once to approve it.

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
   git tag v1.8.0 && git push origin v1.8.0
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
desktop/src/ndiIn.ts       NDI previews of ProPresenter outputs for the dashboard
desktop/src/embed.ts       Planning Center Chat inside the window
server/src/lib/paging.ts   Parent paging: the on-screen lock, messages, PINs
server/src/kiosk.ts        Kids & Nursery iPad server (network, PIN-locked)
server/src/demo/demo.ts    Sample data for "Explore with sample data"
web/                       The UI (Next.js + Tailwind, exported as static files)
desktop/src/main.ts        The Mac app (Electron)
desktop/src/ndi.ts         Stage plot → NDI output (off-screen render + NDI SDK)
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
