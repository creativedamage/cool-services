# What's new

Each version's notes become its GitHub release notes (and what "What's new" shows in the app). Put
the newest version first. The line right under a version heading is its one-line summary: it names
the GitHub Actions run and the release commit.

## 1.28.0
Sundays is now seven Mac apps (Services, Workflows, Paging, FOH, Operations, AVL and the full Sundays app) that share your sign-in and open each other.
- **Separate apps.** Sundays Services (services, run sheets, team check-ins, ProPresenter, the
  Clock, the Mic board and the Dashboard), Sundays Workflows (workflows and Chat), Sundays Paging
  (parent paging and the Kids & Nursery iPads), Sundays FOH (the FOH companion), Sundays Operations
  and Sundays AVL. Each has its own icon, Dock name and updates. The full Sundays app still has
  everything.
- **They share one Sundays.** Open more than one on the same Mac and they use the same sign-in,
  settings, weekend and Micboard. Whichever opens first runs Sundays in the background; if it quits,
  another app takes over without you noticing.
- **They link to each other.** A link to a screen another app has (a workflow card from the
  Dashboard, say) offers to open it in that app. The new Apps menu and "Sundays apps" in the sidebar
  open the others. Apps you don't have open in the full Sundays app instead, and Operations and AVL
  open on the website.
- **Signing out** in any of them signs you out of all of them on that Mac.
- **Sundays FOH** is always an FOH companion, with its own settings, so it can run on the same Mac
  as the main Sundays.
- **Sundays Operations and Sundays AVL** on the Mac: the same screens as the website, in their own
  app, each linking to the other.

## 1.27.1
The Mic board (and everywhere else that lists service types) now finds service types kept in Planning Center folders.
- **All your service types.** Service types filed in folders in Planning Center now show up in the
  Mic board's service type list, the Clock presets and Services, not just the top-level ones.

## 1.27.0
Sundays | Operations is now a service any church or team can sign up for, with plans, add-on modules, church pricing and a Sundays admin console.
- **Anyone can start an organization.** Sign up, pick a plan and you get your own organization with a
  main campus and the usual request types and supply lists ready to go. Everything is kept separate
  per organization.
- **Belong to more than one organization.** The organization switcher (top of the sidebar) moves
  between them and starts new ones.
- **Invite people by email.** Inviting someone copies a ready-to-send invitation; when they create
  their account with that email they're straight in.
- **Modules.** Technology requests, supply requests, facilities work orders, multiple campuses, custom
  branding and AVL quoting are each a module. A plan includes some, and others can be added on per
  organization. Anything an organization doesn't have is hidden.
- **Plans and pricing.** A public pricing page, monthly or yearly billing, free trials. Churches get
  15% off automatically.
- **Plan & billing** in Settings → Organization shows your plan, modules, discounts and invoices.
- **Sundays admin console** for super admins: every organization (status, plan, modules, discounts,
  full licenses, notes), plans and add-on prices (changes show on the pricing page right away),
  invoices (generate, send, mark paid or void) and who the super admins are. Super admins can open
  any organization to help out without showing up in its people list.

## 1.26.0
Sundays | AVL is its own app with a client list, Sundays | Operations and AVL are on the web for your team, and request types get icons.
- **Sundays | AVL** is now separate from Operations, with its own sidebar and teal look. Operations is
  just the church's business (requests, work queue, teams, campuses, request types). AVL is where you
  handle the other churches you work with.
- **Clients** in AVL: each church you quote for, with its address, notes, tax-exempt status, contacts
  (one marked as the main contact) and every quote it has had. Quotes are filtered by client instead
  of campus.
- **Separate access, one sign-in.** Each person has Operations access and an AVL level, set
  separately. AVL Managers approve AVL sign-ups and give access under AVL → People, and only AVL
  Managers and admins hand out AVL access. Executives no longer see AVL automatically.
- **AVL → Business**: AVL's own name, address, logo, quote prefix and quoting defaults for proposals.
  It starts from the church's details, so nothing changes until you edit it.
- **Add products by hand.** On a vendor or in Product pricing, add a single product (SKU, name, cost,
  MSRP, MAP and more) without a spreadsheet. Click any product to change or remove it.
- **New request types** have an icon picker (or any emoji), a title and a line of subtext, with a live
  preview of the tile staff will see. Managers can also add a type straight from New request.
- **On the web**: a website version of Operations and AVL (in `ops-web`, ready for Vercel), so your team
  can use it from any browser or phone without installing Sundays. Same accounts and data as the
  Mac app; each person sees only the apps they have access to.
- The Mac app's switcher now has three tabs (Sundays, Operations, AVL) and reopens the one you used last.

## 1.25.2
Church Ops is now **Sundays | Operations**, and Smaart SPL readings come through.
- Church Ops is renamed **Sundays | Operations** everywhere: the switcher (Sundays / Operations), the
  sidebar, sign-in and the email confirmation page.
- **Smaart SPL**: Sundays now reads the level however Smaart sends it (meter names with their values,
  text like "LAeq 10m 93.2 dB", or raw meter numbers), asks each measurement for its meters every
  second, and keeps the last reading on screen for up to a minute instead of falling back to
  "Waiting for level data". If it still waits, Preferences → Audio → Smaart → "What Smaart is
  sending" shows exactly what came in.

## 1.25.1
Sundays and Church Ops now feel like two apps in one window, and creating a Church Ops account no longer ends on a broken page.
- A Sundays / Church Ops switcher at the top of the sidebar. Each side has its own sidebar, look
  (Church Ops is violet, with your church's logo once you add it) and home, and the switcher goes back
  to where you were on the other side. Sundays reopens on the side you used last.
- Church Ops is gone from the Sundays menu, and the Weekend picker and campus switcher stay on the
  Sundays side.
- After you create a Church Ops account, Sundays waits for you to click the confirmation link in the
  email and signs you in by itself. The link now opens a short "Your email is confirmed" page instead
  of a broken localhost page.

## 1.25.0
Church Ops inside Sundays (requests, facilities, AVL quoting, with your own accounts), one Weekend everywhere, and settings that follow you to every Mac.
- **Church Ops** (Full Mode only, sidebar → Church Ops): ask for technology, supplies and building
  repairs; a work queue for the teams that handle them (approve, assign, start, hold, order, complete,
  with every step on the record); AVL quotes with vendor price lists, margins, print / PDF; vendors
  with CSV and Excel price-list import; and Settings for users, teams, request types and routing,
  campuses, activity and the organization's logo and quoting defaults.
- Church Ops has its own accounts: people create one with their email, and a manager approves them and
  sets their role (Staff, Manager, Executive, System admin), AVL access and campus. The first account
  becomes System admin. Someone a manager adds ahead of time is straight in when they register.
- Quotes are locked when they're sent; print them or save the PDF for the customer, then record the
  answer (accepted, wants changes, declined). Online sign-and-pay comes later.
- **Weekend picker** in the sidebar: pick the weekend you're working on, and the Dashboard, Mic board
  and displays, Clock, Tuning strip, FOH companion, team check-ins and the start-up view all use that
  weekend's service. Nothing moves on to the next weekend by itself.
- **Sync across your Macs**: sign in with Planning Center on another Mac and it gets the same setup
  (Preferences → About shows when it last synced). Each Mac keeps its own mode, PIN, screens, MIDI
  output and FOH links.

## 1.24.0
Cool Services is now Sundays, with a new icon: a countdown ring around a live dot.
- New name everywhere: the app, its menus and windows, the sign-in screen, the installer
  (Sundays-<version>.dmg) and the GitHub releases.
- New app icon and logo.
- Updating keeps everything: Cool Services.app becomes Sundays.app, and your sign-in, settings, notes
  and Micboard move to ~/Library/Application Support/Sundays on the first launch.

## 1.23.0
Resi: a "Resi live" badge on Services and a Resi widget on the Dashboard showing when you're streaming.
- Connect Resi in Preferences → Video → Resi with an API Client ID and Secret from Resi Studio.
- Services shows a red **Resi live** badge (with the time live) while you're streaming, amber while
  it's starting.
- New Dashboard widget, **Resi live stream**: time live, each encoder's state, the title, and every
  destination (Web, YouTube, Facebook, RTMP) with its state; when you were last live.
- Read-only: Cool Services never starts or stops a stream.

## 1.22.0
Three modes after signing in: Full Mode, Service Mode for a shared computer (PIN to leave it), and FOH Companion; stage plots are removed.
- **Service Mode**: only Services, ProPresenter, Clock, Mic board and Parent paging. Workflows,
  Check-Ins (Team check-ins and the services' Check-ins tab), the Dashboard and Chat are closed, in
  the app and on its server. A PIN you choose is needed to switch back to Full Mode or to open
  Preferences; it unlocks everything for 15 minutes.
- The first sign-in on a computer asks for its mode: **Full Mode**, **Service Mode** or **FOH
  Companion**. Change it in Preferences → Default Startup → This computer (also the PIN).
- **Stage plots are removed** (the Stage plots page, each service's Stage plot tab, and the stage
  plot on the stage display). Auto on the stage display now shows the mic board around rehearsals
  too; a display set to the stage plot shows the mic board.

## 1.21.0
FOH companion: a Tuning strip above the mic strip (the main computer sends the keys to Waves), and you choose which display the strip is on.
- Tuning strip on the FOH companion, right above the mics: Chromatic, Off and each song's key in
  service order, from the service the main computer's Mic board follows.
- Pressing a key sends it to Waves SuperRack from the main computer (its Cool Services window sends
  the MIDI, exactly like its own Tuning bar), so nothing on the companion changes. The key lights
  up there and on the strip.
- The strip no longer takes the focus from the app you're working in when you press it.
- Choose the strip's display in the companion window from a picture of your displays (found again
  by name if macOS renumbers them), or move it to the next display from the strip itself.

## 1.20.2
Mics show up again: receivers Micboard doesn't have are read directly, and a new Micboard starts with the mics from Mic setup.
- Since 1.20.0 the mics showed as not found: Cool Services read the receivers only through Micboard,
  and a new Micboard has no receivers yet. Now any receiver Micboard isn't connected to (not added
  yet, SLX-D which Micboard doesn't support, or one it can't reach) is read directly, as before.
- A Micboard with no slots yet starts with the receivers and mics from Mic setup (through Micboard's
  own config), so it shows them right away. After that, set them up in Micboard as usual.
- The app tells macOS why it uses the local network, for the Local Network permission prompt.

## 1.20.1
Fixes the Mac build for 1.20.0 (Micboard built in): Micboard's Python now ships next to the app archive instead of inside it.
- The 1.20.0 release didn't build: the universal (Apple silicon + Intel) build couldn't merge an app
  archive with all of Python's files unpacked from it. Micboard and its Python now live in
  Cool Services.app/Contents/Resources/micboard.
- Everything from 1.20.0: Micboard built in (creativedamage/micboard, unchanged), names and photos
  from Planning Center, your own backgrounds in Preferences → Micboard, and no more Keychain
  password after updates.

## 1.20.0
Micboard built in (creativedamage/micboard), with names and photos from Planning Center and your own backgrounds; no more Keychain password after updates.
- The mic board is now Micboard itself: creativedamage/micboard, unchanged, running inside the app
  with its own Python (nothing to install). It's on the network at `http://<this Mac>:8058`, and the
  stage display (banner, Auto, network page, second display) shows it.
- Micboard's slots appear in Mic setup by themselves, so people can be put on them in each service's
  Mics panel; their names go to Micboard as extended names.
- Preferences → Micboard: on/off and port, its address and QR code, names (first or full),
  Planning Center photos, and your own background pictures and videos.
- Display settings → Mic board: which Micboard group, TV view and info drawer, and backgrounds.
- While Micboard runs, Cool Services reads the receivers through it instead of connecting twice.
- Updates no longer ask for your Keychain password. The sign-in key moves out of the Keychain on the
  first launch of this version (one last prompt), and the app doesn't use the Keychain after that.

## 1.19.0
FOH companion mic strip: the mics along the bottom of the screen, with page requests still taking over the full screen until answered.
- On an FOH companion, a short always-on-top bar across the bottom of the screen shows every wireless
  mic: name, who's on it, status color, battery, audio and RF. Everything above it stays clickable
  (Waves SuperRack, the console app).
- A page request still takes the full screen; once it's accepted, held or denied, the strip comes back.
- Hover the strip and press the gear (or click Cool Services in the Dock) for the companion window:
  turn the strip on or off, choose its height and which display it's on.
- Also includes 1.18.4 (mic board: hide/show mics, a person's mics stacked on one tile, mics that
  aren't on the network; the board follows the service you have open; Services reopens where you left it).

## 1.18.4
Mic board: hide or show mics, stack a person's mics on one tile, add mics that aren't on the network; the board follows the service you have open; Services reopens where you left it.
- Mic board → Display settings → **Mics on the board**: show or hide each mic, and add mics that
  aren't on the network (they show who has them, without battery or RF).
- **One tile per person**: someone on two mics (a vocal and the acoustic guitar's pack) gets one tile,
  with the other mic stacked under the mic name.
- The board now follows the service you have open in Services (or, if you choose, always the next
  service).
- Services in the sidebar takes you back to the service and tab you were last on.

## 1.18.3
README with screenshots and download links; releases named by version and what changed.
- The README shows every part of the app, with links to download the latest version and to all releases.
- Releases: `npm run release` names the GitHub Actions run and the release after the version and its
  summary, and the release notes come from this file.

## 1.18.2
Mic board: up to 12 tiles per row.
- Tiles per row now goes up to 12 (Fit already puts 10 mics side by side on a widescreen TV).

## 1.18.1
Micboard-style mic board.
- Tall columns: the mic in italics, the person's name, a status block (green, yellow, red, striped when off),
  battery, audio and RF graphs, antennas.
- Pictures behind the name, as a round photo above the name, or none.

## 1.18.0
Mic board and stage display.
- A board of your wireless mics with pictures (Planning Center or your own), battery, RF and audio.
- Banner message across the top (your mission statement or anything else).
- The display switches between the mic board, the stage plot and the clock, by hand or automatically
  (stage plot during rehearsal, mic board for the service).
- Open it on another computer at `http://<this Mac>/display`, or on a second display.

## 1.17.0
Production clock with NDI output.
- Countdown, count up, count to a time, time of day, until service and Live item.
- Saved timers with schedules and "what's next"; title bar, second timer, Information box, messages.
- Outputs: NDI, the church network, a second display, Stream Deck / Companion links.

## 1.16.1
Team Check-ins settings save with a Save button, for your campus only.

## 1.16.0
Volunteer Check-Ins event and each team's area of serving.

## 1.15.0
Team check-ins on phones for team leads and staff.

## 1.14.0
Team check-ins by ministry, FOH companion, workflow access and notifications, inline run sheet editing.

## 1.13.1
A Check-Ins permission problem no longer signs you out.

## 1.13.0
Stay signed in; NDI removed (it returned in 1.17 without needing a compiler).
