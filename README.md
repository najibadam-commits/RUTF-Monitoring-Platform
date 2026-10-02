# RUTF Monitoring Platform

Digital RUTF commodity tracking, accountability and reporting for Katsina State health facilities,
with supervisor verification. Spec of record: [RUTF_BUILD_BRIEF.md](RUTF_BUILD_BRIEF.md).
Decisions: [DECISIONS.md](DECISIONS.md).

| Folder | What |
| --- | --- |
| `web-platform/` | Next.js web app (`web/`), Supabase migrations (`supabase/`), DB and GIS tools |
| `android/` | Offline Android app (Kotlin, Room, sync queue) |
| `data/reference/` | Katsina health facility list |
| `data/dummy/` | Generated demo data (`tools/dummy-data/`) |

Supabase applies `web-platform/supabase/migrations` on every push to `main` (GitHub integration,
Supabase directory = `web-platform`). Secrets live only in untracked `web-platform/web/.env.local`,
`web-platform/tools/db/.env` and `android/local.properties`; copy the `*.example` files.
