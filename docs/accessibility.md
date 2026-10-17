# Accessibility and polish check — 18 October 2026

Scope: issue #9, onboarding, Today, Calendar, day logging, reminders and existing
Settings dialogs. Existing calendar states use solid/dashed outlines, stripes,
icons and descriptive day names; charts retain text/table equivalents.

Changes:

- All app confirmations now use named dialogs with initial heading focus,
  Tab/Shift+Tab containment, Escape dismissal and focus restoration. Confirmation
  actions have explicit button types and wrap on narrow screens.
- Focus outlines use the high-contrast ink token. Form and chip boundaries use
  the muted token for stronger contrast in both themes. Close controls have a
  44px minimum target. Reduced-motion preferences suppress animations.
- Setup and report validation errors are associated with their fields. Setup
  and report columns stack on phones; native inputs and long notes can shrink.

Verification:

- `pnpm test -- --maxWorkers=2`: 221 passed, 4 skipped. An initial unconstrained
  run timed out waiting for the calendar under concurrent browser load; the
  complete suite passed with bounded workers.
- `pnpm build` and `pnpm typecheck` pass.
- `fas check`: all hard checks passed. Playwright trace artifacts were moved
  outside the repository before checking because the CLI scans generated CSS.
- `pnpm e2e e2e/a11y.spec.ts --workers=2`: targeted Chromium checks run in
  desktop/mobile, light/dark projects. Axe WCAG A/AA scans cover every screen,
  onboarding validation, day editor and delete confirmation. All 20 tests passed.
- Keyboard checks save a log using native radio/textarea controls, verify forward
  and reverse focus wrapping, open/cancel deletion, dismiss with Escape and
  verify focus returns to the initiating control.
- Screen-reader smoke is automated: role/name queries verify named dialogs,
  headings, groups, controls and the associated validation description. No
  NVDA/VoiceOver audio session was performed.
- Live system dark/light switching is verified. All core screens are checked for
  horizontal overflow at 320px and 768px, alongside the configured Pixel 7 and
  desktop viewports.

Platform limitations: the existing axe suite separately records the SDK header
contrast result and excludes that platform-owned header from the app gate;
brand tokens are controlled by the platform's `fas check` rules. This is not a
claim of whole-platform WCAG certification. `fas screencheck --skip-build`
timed out navigating to localhost while waiting for network idle; the targeted
Playwright layout checks use the production build and completed independently.
