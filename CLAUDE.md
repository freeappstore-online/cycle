# cycle

Cycle: a private period & cycle tracker on FreeAppStore. Today and Calendar log periods,
flow, symptoms, mood and notes; Insights charts cycle length and symptoms; Settings has
optional encrypted sync, JSON backup/restore and a doctor PDF. See
freeappstore-online/platform#135.

- Live: https://cycle.freeappstore.online
- Dev: `pnpm install && pnpm dev`
- Build: `pnpm build`
- Test: `pnpm test` (Vitest + fake-indexeddb)
- Check: `fas check`, then `pnpm build && fas screencheck --skip-build` (its own build step
  can't spawn pnpm on Windows). The SDK Shell's skip link is flagged on every viewport;
  that's a platform issue, not the app's.
- Deploy: `git push origin main` (auto-deploys to R2 via GitHub Actions)

## Notes

- Fonts are self-hosted (`@fontsource-variable/*`); the app makes no third-party requests
  beyond the platform API and analytics loader. Keep it that way.
- Data layer: `web/src/data` (IndexedDB via `idb`, local-only). The `periods` store is the
  source of truth for period ranges; `DayLog.flow` is per-day detail. Schema changes need a
  `MIGRATIONS` step in `migrations.ts` and a fixture test.
- Sync (`web/src/sync`) is optional and off by default; only ciphertext goes to `fas.kv`
  (PBKDF2 → AES-GCM, gzip first, `cycle:meta` + one blob per year). Merges are three-way
  against the last-synced state so deletions propagate. No crypto dependencies.
- Backups (`web/src/backup`) reuse `exportAll`/`importAll` and the sync envelope. The doctor
  PDF (`web/src/report`) loads jsPDF via `import()` only; its html2canvas/canvg/dompurify are
  aliased to a stub in `vite.config.ts` to keep them out of the precache.
- Insights (`screens/InsightsScreen.tsx`, data in `web/src/insights/shape.ts`) is lazy-loaded
  so Recharts is its own chunk. Chart colours are accent-hue steps from theme tokens
  (`--chart-*` in `index.css`); every chart has a text/table equivalent.
- The document never scrolls (screencheck); the Shell's `<main>` does (see end of `index.css`).
- Predictions (`predict.ts`) are estimates: label them so, and never frame anything as
  contraception or "safe days".

Platform conventions: https://raw.githubusercontent.com/freeappstore-online/freeappstore/main/SKILLS.md
