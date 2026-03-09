# Quarterly

Quarterly is a desktop-first finance planner scaffold built with Electron, React, TypeScript, and Vite.

## Product direction

This initial scaffold is centered on the workflow described for desktop users:

- onboarding collects split-month budget capacity and debt details
- the main planner shows month-by-month tables split into first-half and second-half payment windows
- each debt keeps its own visible ledger with month owed, amount paid, amount left, and percent left
- recommendation logic applies an avalanche-style strategy so extra budget flows toward the highest APR debt first

## Stack

- Electron for the desktop shell
- React + TypeScript for the interface
- Vite for the renderer build
- localStorage for first-pass persistence
- Supabase-ready cloud sync scaffold for accounts and workspace backup
- Electron auto-update scaffold for GitHub Releases

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run generate:icons
npm run build
npm run dist
```

## What is scaffolded

- secure Electron window with `contextIsolation` enabled and no `nodeIntegration`
- editable onboarding panel with debt capture
- horizontal month planner cards for the next 3-12 months
- debt ledgers that stay in the same scrollable dashboard view
- a clean starter workspace with local-first persistence
- local-first persistence of planner data, card placement, card size, and theme
- Supabase client scaffold and prefixed SQL schema for cloud workspace sync

## Supabase

The app now includes:

- `.env.example` for `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- `src/lib/supabase.ts` for the client
- `src/lib/cloudWorkspace.ts` for loading and saving one user workspace
- `supabase/sql/finance_app_schema.sql` with the `finance_app_` table prefix

Setup notes are in `docs/supabase-setup.md`.

## Auto Updates

The app now includes:

- `electron-updater` wiring in the Electron shell
- renderer update status in the `Controls` card
- `electron-builder.config.cjs` for GitHub Release publishing
- `.env.local` support for `GH_RELEASE_OWNER`, `GH_RELEASE_REPO`, and `GH_TOKEN`
- separate `dist:*` and `publish:*` scripts so local builds and GitHub release uploads are distinct

Setup notes are in `docs/auto-updates.md`.

## Recommended next steps

1. Add a small auth + sync modal for sign in, sign up, sign out, and sync now.
2. Add SQLite or file exports for stronger local desktop durability beyond browser storage.
3. Introduce due dates, income events, and calendar-aware split planning.
4. Add PDF/CSV export for the planner tables and debt ledgers.
