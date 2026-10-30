# Threshold

Migraine bucket, craving check and trigger insights. Mobile-first React + Framework7 + TypeScript PWA, built with Vite. No backend. Spec: v1, `out/threshold-spec.txt` in the KiroCrew workspace.

    npm install
    npm run dev        # http://127.0.0.1:5173
    npm test           # logic tests (vitest)
    npm run build      # type-check + production build into dist/
    npm run preview    # http://127.0.0.1:4173
    node scripts/smoke.mjs http://127.0.0.1:4173/ out   # phone smoke test (Playwright, 390x844)
    python3 scripts/make_icons.py                       # redraw icons

Code
- `src/logic/`: pure logic with tests: bucket score, craving routing, let-down windows, episodes, calm-day tests, P_trigger verdicts, pressure, report, backup.
- `src/views/`: Today, Check-in, Insights, Settings, Attack mode, sheets, report.
- `src/store.ts` + `src/db.ts`: in-memory store, write-through to IndexedDB.

Deploy
- Zip the contents of `dist/` as `site.zip`. In a GitHub Pages repo, commit `site.zip` and `deploy/pages.yml` (as `.github/workflows/pages.yml`).
- Or host `dist/` on any static HTTPS host. On iPhone: Safari > Share > Add to Home Screen.

Notes
- Data: IndexedDB (logs, events, episodes, blocks, tests), localStorage (profile, alert state). No auto-delete; export reminder every 30 days.
- Only network call: Open-Meteo pressure, opt-in, location rounded to 2 decimals.
- Not medical advice.
