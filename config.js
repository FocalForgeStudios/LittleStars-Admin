/* =====================================================================
   config.js — Supabase connection settings (PUBLIC SITE)

   Fill in the two values below from your Supabase project:
   Supabase Dashboard → Project Settings → API → Project URL / anon public key.

   The "anon" key is safe to expose in frontend code — it has no power
   on its own; every table is locked down by Row Level Security policies
   (see /supabase/schema.sql), so this key can only do what those
   policies allow for whoever is currently signed in.
   ===================================================================== */
const SUPABASE_URL = 'https://mudlitchxcartnfidphl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_HBWI2zlq9dHViUaQv4oPUA_4R1UD_Tx';

window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
