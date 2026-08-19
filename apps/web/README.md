# @job-hunt/web

## Environment

Copy `.env.example` to `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL` — the local Supabase API URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the local Supabase anon key.

Both values come from `supabase status` (run locally by the operator) once the
local stack is running. Google OAuth is configured on the Supabase project
side by the operator — no client secrets live in this repo.
