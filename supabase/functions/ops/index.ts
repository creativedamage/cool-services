// Church Ops for Sundays (Supabase Edge Function "ops"). See app.ts.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handle } from "./app.ts";

Deno.serve(handle);
