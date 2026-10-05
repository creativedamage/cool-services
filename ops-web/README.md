# Sundays | Operations and Sundays | AVL on the web

The same Operations and AVL screens as the Mac app (they live in `web/app/(app)/ops` and
`web/app/(app)/avl`), as a website your team opens in any browser or phone. Same accounts, same
data, same access levels: each person sees only the apps they've been given.

## Put it on Vercel (once)

1. In Vercel: **Add New → Project → Import** `creativedamage/sundays`.
2. Leave **Root Directory** as the repo root. `vercel.json` there already sets the install and
   build commands and the output folder (`ops-web/out`). Framework preset: **Other**.
3. Deploy. Every push to `main` redeploys it.
4. Optional: **Settings → Domains** to add something like `ops.yourchurch.org`.

Then in Supabase (project "sundays") → **Authentication → URL Configuration**:

- **Site URL**: the website's address (e.g. `https://ops.yourchurch.org`).
- **Redirect URLs**: add the website's address with `/**` on the end, and keep
  `https://sgfdzzgizrvemqczauhu.supabase.co/functions/v1/welcome` (the Mac app's confirmation page).

## Working on it

    npm run site          # http://127.0.0.1:5180
    npm run build:site    # static site in ops-web/out

`sync-pages.mjs` (run before every build) adds a page here for each Operations / AVL screen in
`web/`, so new screens show up on the website without touching this folder.
