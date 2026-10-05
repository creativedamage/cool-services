# Sundays' cloud (Supabase project "sundays")

* `functions/sundays-sync` — settings sync across your Macs. Checks the Mac's Planning Center sign-in
  with Planning Center, then stores that person's settings (encrypted) in `public.sync_settings`.
* `functions/ops` — Church Ops (request hub, facilities work orders, AVL quoting, vendors, people and
  access). Checks the Church Ops (Supabase Auth) sign-in on every call and reads/writes the `ops`
  schema, which the public API doesn't expose (RLS on, no policies).
* `migrations/` — the tables. The first person to create a Church Ops account becomes System admin;
  everyone after that waits for a manager to approve them.

Deploying the ops function: `node supabase/build-ops.mjs` (copies `shared/ops` into `functions/ops/lib`),
then `supabase functions deploy ops --no-verify-jwt` (it checks sign-ins itself, so it works with
Supabase's newer signing keys) and `supabase functions deploy sundays-sync --no-verify-jwt`.

Testing locally: run the function under Node against a local Postgres with `OPS_DB_URL=… OPS_TEST_AUTH=1`
(test sign-ins look like `test:<user id>:<email>`), and start Sundays with
`COOL_OPS_URL=http://127.0.0.1:<port>/ops COOL_OPS_TEST_TOKEN=test:…`.
