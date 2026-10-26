# 01 — Monorepo layout & conventions

## Tooling

- **pnpm workspaces** (pnpm is already installed). Node ≥ 22.
- **TypeScript** everywhere, strict.
- **vitest** for tests. The Worker uses `@cloudflare/vitest-plugin` (the renamed `vitest-pool-workers`).
- **esbuild** to bundle the CLI into a single `planner.mjs`.
- The repo is `ScaleXY/planner` (public). `git init` comes first, since the directory is not a repo yet.

## Layout

```
planner/
├── package.json              # private root, scripts: build, test, typecheck
├── pnpm-workspace.yaml       # apps/*, packages/*
├── tsconfig.base.json
├── plans/                    # these documents
├── .github/workflows/
│   ├── ci.yml                # typecheck + test on PRs
│   └── release.yml           # cli-v* tags → release + tap update (see 04)
├── packages/
│   └── core/                 # shared, zero-dependency, runs in Node + workerd
│       └── src/key.ts
└── apps/
    ├── worker/               # Cloudflare Worker (index listings on plans.athul.dev)
    │   ├── wrangler.jsonc
    │   └── src/index.ts
    └── cli/                  # `planner` CLI
        └── src/{index,config,wrangler,accounts}.ts
```

## `packages/core`: single source of truth for the key format

The CLI writes keys and the Worker parses them. Both import from here so the two can't drift.

```ts
export type Mode = "pub" | "pri";

export const SLUG_RE  = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;      // lowercase, hyphen-separated
export const YEAR_RE  = /^\d{4}$/;
export const MONTH_RE = /^(0[1-9]|1[0-2])$/;
export const DAY_RE   = /^(0[1-9]|[12]\d|3[01])$/;
export const FILE_RE  = /^(\d{10})-([a-z0-9]+(?:-[a-z0-9]+)*)-(pub|pri)$/;

// Date folder from the *local* calendar date of `now` (system TZ); timestamp = unix seconds.
export function buildKey(now: Date, slug: string, mode: Mode): string;
//   → "2026/10/26/1792990800-weekly-review-pub"

export function parseFileName(name: string): { timestamp: number; slug: string; mode: Mode } | null;
export function slugify(input: string): string;            // for deriving a slug from a filename
```

### Key format decisions

- **Prefix:** `YYYY/MM/DD/`, zero-padded, using the **local date of the uploading machine**
  (`getFullYear/getMonth/getDate`, not the UTC getters). No leading slash.
- **Timestamp:** unix epoch **seconds**, exactly 10 digits (valid until the year 2286). Sorting numerically gives time order.
- **Slug:** `[a-z0-9-]`. Hyphens and leading digits are fine, because parsing anchors on the fixed
  10-digit timestamp at the start and `-(pub|pri)` at the end.
- **Extension:** none. The content type is set on the object (`text/html; charset=utf-8`). R2's custom
  domain returns that stored content type, so setting it at upload time is required.
- Tests run `buildKey` with `TZ=Asia/Kolkata` and `TZ=UTC` around midnight, to pin down the local-date behaviour.
