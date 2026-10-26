# Planner — plans

Monorepo with a Cloudflare Worker that serves HTML "plans" stored in R2, with directory listings, at
**https://plans.athul.dev**, plus a `planner` CLI (`brew install scalexy/tap/planner`) that
uploads plans through wrangler. Source repo: **`ScaleXY/planner`**.

| Doc | Contents |
|---|---|
| [00-feasibility.md](00-feasibility.md) | What was verified against the demo account, required adjustments, risks |
| [01-monorepo.md](01-monorepo.md) | Layout, tooling, shared key format (`packages/core`) |
| [02-worker.md](02-worker.md) | Routes on `plans.athul.dev`, R2 listing, rendering, tests, deploy |
| [03-cli.md](03-cli.md) | CLI interface, config, account resolution, wrangler invocation |
| [04-release-brew.md](04-release-brew.md) | Formula in `ScaleXY/homebrew-tap`, release workflow |
| [05-migration.md](05-migration.md) | Moving the existing root object into the new layout |

## Object key (summary)

```
2026/10/26/1792990800-weekly-review-pub
└ date ──┘ └ unix ts ┘└─ slug ─────┘└mode┘   content-type: text/html; charset=utf-8, no extension
```

The date folder is the **uploader's local calendar date** (system time zone). The timestamp is unix
seconds, so it doesn't depend on any time zone.

## Decisions

| # | Topic | Decision |
|---|---|---|
| — | Timestamp | Unix epoch **seconds** (10 digits) |
| Q1 | `pri` meaning | Unlisted: never in listings, but viewable by exact URL |
| Q2 | Hostname | `plans.athul.dev` as a **Worker Custom Domain** (not a route). The Worker serves both index pages and files (see 02) |
| Q3 | Repo / tap | `ScaleXY/planner` (public; the user will create it) + the existing public `ScaleXY/homebrew-tap` |
| Q4 | Day boundary | System local time for the date folder |
| Q5 | Existing root object | Move it into the new layout, with no redirect from the old URL (see 05) |

## Build order

1. `git init` (the user creates `ScaleXY/planner`, public). Set up the pnpm workspace skeleton, plus `packages/core` and its tests
2. Worker: index pages, file serving, and tests. Deploy as the Custom Domain `plans.athul.dev` ✅ deployed 2026-10-26
3. Migration of the existing object (05)
4. CLI: config, account resolution, upload, and tests, then a manual e2e on plans.athul.dev
5. Release: bundle, formula in `ScaleXY/homebrew-tap`, release workflow, and `brew install` on a clean user
