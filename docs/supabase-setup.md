# Supabase Setup

## What already persists

The app already saves the full planner locally on the machine through Electron's renderer storage. That includes:

- canvas positions
- card sizes
- collapse state
- split items
- debt models
- income and timing settings
- theme

So if you move a card, resize it, or edit data, it should still be there after closing and reopening the app on the same machine.

## Recommended architecture

Keep the app local-first, then add cloud sync on top:

1. Local state stays in the desktop app so the workspace always opens fast.
2. Supabase handles accounts and cloud backup/sync.
3. The cloud table stores the full planner JSON for the signed-in user.

That is the simplest setup for this app right now.

## Environment variables

Create a `.env.local` file in the project root:

```bash
cp .env.example .env.local
```

Then fill in:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Use the project URL and the public anon key from Supabase.

Do not put the service role key in the Electron app.

## SQL setup

Run the SQL in:

`supabase/sql/finance_app_schema.sql`

This creates one prefixed table:

- `finance_app_workspaces`

That table stores one workspace per user, with row-level security enabled.

## How local development works

For this Electron app, Vite reads `.env.local` and exposes `VITE_*` variables to the renderer through `import.meta.env`.

So your local flow is:

1. Put the Supabase URL and anon key in `.env.local`.
2. Start the app with `npm run dev`.
3. Use the Supabase client from the renderer with the public anon key.
4. Let RLS enforce that users can only access their own workspace row.

## Files added

- `src/lib/supabase.ts`
- `src/lib/cloudWorkspace.ts`
- `supabase/sql/finance_app_schema.sql`

## Live sync note

The SQL now also adds `finance_app_workspaces` to the `supabase_realtime` publication.

If you created the table before this was added, run the updated SQL file again so cross-device live updates work.
