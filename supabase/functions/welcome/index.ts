// Where the Sundays | Operations confirmation email lands (Supabase Auth Site URL). Nothing to sign in here:
// the email is confirmed by the time this opens, and Sundays carries on by itself.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve((req) => {
  const u = new URL(req.url);
  const failed = u.searchParams.get("error") || (u.hash && u.hash.includes("error"));
  const body = failed
    ? "Sundays | Operations\n\nThat confirmation link didn't work (it may have expired or already been used).\n\nGo back to Sundays and sign in. If it says your email isn't confirmed, create the account again to get a new link.\n"
    : "Sundays | Operations\n\nYour email is confirmed. ✓\n\nGo back to Sundays: it signs you in by itself (or sign in with your email and password).\nA manager approves new accounts before you can use Sundays | Operations.\n\nYou can close this window.\n";
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
});
