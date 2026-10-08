/**
 * Sundays' cloud (Supabase project "sundays"): settings sync and Sundays | Operations.
 * The publishable key is meant to be in the app (it only identifies the project; every table is
 * protected by row-level security and the functions check who's calling).
 */
export const SUPABASE_URL = "https://sgfdzzgizrvemqczauhu.supabase.co";
/** Where the Sundays | Operations confirmation email lands (also the project's Auth "Site URL"). */
export const CONFIRMED_URL = "https://sgfdzzgizrvemqczauhu.supabase.co/functions/v1/welcome";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_gE2iL8LyEZDBV54yKVKlRw_7Z3nMGKO";
/** Settings sync base URL ("" turns sync off; COOL_SYNC_URL overrides it for testing). */
export const SYNC_URL: string = (typeof process !== "undefined" ? process.env?.COOL_SYNC_URL : undefined) ?? SUPABASE_URL;
/** The Sundays | Operations website (invitations point people here). */
export const WEBSITE_URL = "https://sundays-ops.vercel.app";
/** Team check-ins on phones (the same website, its own address: see vercel.json). */
export const CHECKIN_URL = "https://sundays-checkin.vercel.app";
