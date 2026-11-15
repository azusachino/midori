# midori

assistant on ever green

A self-hosted Apple Health admin dashboard: periodic `export.zip` imports into SQLite,
deterministic per-source deviation analysis, a briefing UI, and a read-only MCP server for
agents. Single user, tailnet-only. See `docs/design.md` for the approved design.

## Commands

| Command                       | What it does                           |
| ----------------------------- | -------------------------------------- |
| `bun run check`               | typecheck + lint + tests (the CI gate) |
| `bun run typecheck`           | `tsc --noEmit` (strict)                |
| `bun run lint`                | biome check                            |
| `bun test`                    | test suite                             |
| `bun run privacy-guard`       | refuse tracked personal-data files     |
| `bun run import <export.zip>` | import an Apple Health export (T6+)    |
| `bun run dev`                 | API (:5174) + Vite web (:5173, /api proxied) |
| `bun run build`               | production web build into `web/dist`   |
| `bun run start`               | serve API + built web on :5174         |

## Rules

- **TypeScript only** — no `.js`/`.mjs` sources.
- **Personal data never enters git or images**: health data lives under `data/` (gitignored);
  CI enforces the tracked-file privacy guard; tests use synthetic fixtures only.
- Deterministic stats first — LLM narration never computes over raw series.

## Layout

- `src/domain/` — pinned contracts (types, stats semantics, DTOs)
- `src/ingest/` — zip/XML parsing and the transactional store
- `src/stats/` — day/night assembly, baselines, findings
- `src/http/` — REST API + import job route
- `src/mcp/` — MCP server (stdio + streamable HTTP)
- `web/` — briefing/investigate/import UI
- `tasks/` — plan and per-task acceptance criteria
- `docs/` — design, reviews
