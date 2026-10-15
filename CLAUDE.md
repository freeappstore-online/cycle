# cycle

Cycle: a private period & cycle tracker on FreeAppStore. Currently a "Coming soon" shell
with four screens (Today, Calendar, Insights, Settings); see freeappstore-online/platform#135.

- Live: https://cycle.freeappstore.online
- Dev: `pnpm install && pnpm dev`
- Build: `pnpm build`
- Test: `pnpm test` (Vitest + fake-indexeddb)
- Check: `fas check`
- Deploy: `git push origin main` (auto-deploys to R2 via GitHub Actions)

## Notes

- Fonts are self-hosted (`@fontsource-variable/*`); the app makes no third-party requests
  beyond the platform API and analytics loader. Keep it that way.
- Data layer: `web/src/data` (IndexedDB via `idb`, local-only). The `periods` store is the
  source of truth for period ranges; `DayLog.flow` is per-day detail. Schema changes need a
  `MIGRATIONS` step in `migrations.ts` and a fixture test.

Platform conventions: https://raw.githubusercontent.com/freeappstore-online/freeappstore/main/SKILLS.md
