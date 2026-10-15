# Cycle

**Private period & cycle tracker: your data stays on your device.** A free, MIT-licensed app on
[FreeAppStore](https://freeappstore.online), live at https://cycle.freeappstore.online.

- Log periods, flow, symptoms, mood and notes; see them on a calendar.
- Estimated next period and fertile window from your own history (estimates only, not
  medical advice, and not for contraception).
- Insights: cycle-length history and a symptom heatmap.
- Optional end-to-end encrypted sync between devices, JSON backup/restore and a PDF summary
  for a doctor.
- Works offline as an installable PWA. No account needed.

Privacy details are in the app under Settings → Privacy.

## Develop

```bash
pnpm install
pnpm dev                 # local dev server
pnpm test                # unit tests (Vitest)
pnpm build && pnpm e2e   # Playwright end-to-end tests against the production build
fas check                # FreeAppStore compliance checks
```

Pushes to `main` auto-deploy via GitHub Actions.

## License

MIT.
