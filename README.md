# Cycle

**Coming soon — private period tracker.** A free app on [FreeAppStore](https://freeappstore.online),
live at https://cycle.freeappstore.online.

Right now this is a shell: the four planned screens (Today, Calendar, Insights, Settings) exist
but don't store anything yet. Progress is tracked in
[freeappstore-online/platform#135](https://github.com/freeappstore-online/platform/issues/135).

## Develop

```bash
pnpm install
pnpm dev      # local dev server
pnpm build    # production build in web/dist
fas check     # FreeAppStore compliance checks
```

Pushes to `main` auto-deploy via GitHub Actions.

## License

MIT.
