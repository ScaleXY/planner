# 00 — Feasibility study

Verdict: **feasible**, with the adjustments listed below.

All checks were run on 2026-10-26 against the demo account `98f0ecdd86a00f1677266b31bd313769`
(ScaleXY) using the local wrangler (`cloudflare-wrangler` 4.148.0 via Homebrew, logged in with OAuth).

## What was verified

| Check | Command / method | Result |
|---|---|---|
| wrangler installed | `which wrangler` | `/opt/homebrew/bin/wrangler` (Homebrew formula `cloudflare-wrangler`) |
| Bucket exists | `CLOUDFLARE_ACCOUNT_ID=… wrangler r2 bucket info plans` | Exists, APAC, Standard class, 1 object |
| OAuth token can write R2 | `wrangler r2 object put plans/_probe/feasibility --file … --ct 'text/html; charset=utf-8' --remote` | Upload complete. The OAuth scope list has no explicit `r2` entry, but R2 writes still work |
| Read back + cleanup | `r2 object get --pipe --remote`, `r2 object delete --remote` | Round trip OK, probe deleted |
| Account selection | `r2 object put` has **no `--account-id` flag** | Account is chosen through the `CLOUDFLARE_ACCOUNT_ID` env var |
| Wrangler profiles | global `--profile <name>` flag | Exists (experimental). Accepted by `r2 object put` and `auth token` |
| Account listing | `wrangler whoami --json` | Returns `accounts[]` (30 on this login). **But `whoami` rejects `--profile`** |
| Account listing per profile | `wrangler auth token --json --profile <p>` → `GET /client/v4/accounts` with Bearer token | Works (`success: true`, 30 accounts) |
| Zone | `GET /zones?name=athul.dev` | Active, **in the same account** (ScaleXY), Free plan, zone id `0005df2adefef0b93359e076fc0e63f6` |
| Hostname | `wrangler r2 bucket domain list plans` | **`plans.athul.dev` is already an R2 custom domain on `plans`** (enabled, SSL active). R2 already serves objects there, and the proxied DNS record that Worker routes need already exists. The `r2.dev` URL is disabled |
| Route permission | OAuth scopes | `workers_routes:write` is present, so `wrangler deploy` can attach routes |
| Brew tap | `gh repo view ScaleXY/homebrew-tap` | Exists, public. It holds the `ai-headroom` cask (only `Casks/`, no `Formula/` yet), which is updated by `ScaleXY/headroom`'s release workflow using the org secret `HOMEBREW_TAP_TOKEN` |
| Brew name | `brew info planner` | No formula named `planner` in homebrew-core, so there is no clash |
| Source repo | `gh repo view ScaleXY/planner` | Doesn't exist yet. The user (an org admin) will create it |
| Existing content | R2 REST list | One object, `headroom-crazy-ideas-20261025T175947Z`, at the bucket root (see 05) |

## Worker routes vs. index paths

> **Superseded:** the Worker was deployed as a Custom Domain instead (see the update at the end of 02).

Workers route patterns only allow a `*` at the **start of the hostname** or the **end of the path**.
Infix wildcards (`/*/`) are rejected, and the most specific pattern wins. Index paths (`/2026/10/26`)
and file paths (`/2026/10/26/<file>`) share prefixes, so no set of wildcard patterns can select
*only* the index paths. Exact-path routes would need one route per year, month, and day.

**Approach:** one route, `plans.athul.dev/*`. The Worker answers index paths itself and forwards everything
else with `fetch(request)`. A Worker's subrequest to its own zone goes to the origin, which here is the
R2 custom domain, so R2 keeps serving the files (with its own caching, ranges, and ETags). This
passthrough must be **verified on first deploy**. If it doesn't work, the fallback is to serve files from
the R2 binding (`env.PLANS.get`) inside the Worker.

## Worker-side R2 API

- `env.PLANS.list({ prefix, delimiter: "/", cursor })` returns `delimitedPrefixes`, which maps directly onto `/`, `/<year>` and `/<year>/<month>`.
- `list({ prefix: "YYYY/MM/DD/" })` returns objects for a day. Filtering on the `-pub` suffix happens in the Worker.
- One list call returns at most 1000 entries, so the Worker pages with `cursor` while `truncated`.

## Required adjustments to the brief

1. **No leading slash in object keys.** Keys are `2026/10/26/<file>`, and the URLs still look like `/2026/10/26`.
2. **Always pass `--remote`** to `wrangler r2 object put`.
3. **Account auto-detect with a profile:** use `wrangler auth token --json --profile P` plus the Cloudflare API,
   because `whoami` refuses `--profile`.
4. **A single `/*` route** instead of index-only wildcard routes (see above).

## Risks / caveats

| Risk | Impact | Mitigation |
|---|---|---|
| `--profile` / `wrangler auth *` profile commands are **experimental** | Flags could change | All wrangler calls live in one module, plus a clear error when `--profile` is unsupported |
| A directory-bound wrangler profile or a stray `wrangler.jsonc` in the cwd changes which account or credentials are used | Upload goes to the wrong account | Spawn wrangler with a neutral cwd. Always set `CLOUDFLARE_ACCOUNT_ID` and pass `--profile` explicitly |
| Global API key auth (`type: api_key`) | Bearer-token account listing fails | Only matters with `--profile` + auto-detect. The error asks for `--account-id` |
| `pri` files are public on the R2 custom domain if the name is guessed (unix seconds + slug) | Low-grade privacy leak | Accepted under Q1 = unlisted. Real privacy would need Cloudflare Access or a random suffix |
| Days/months that contain only `pri` files still appear in the parent listings | Shows that *something* was uploaded on that date | Accepted. The day page shows "No public plans" |
| Date folders use the uploader's local date; times are absolute | A plan made at 23:30 IST sits under that IST date even though it's 18:00 UTC | Intended (Q4). Within a day, ordering uses the unix timestamp |
| Same slug uploaded twice in the same second | Overwrite | Negligible; documented |
| Passthrough `fetch(request)` to the R2 custom domain doesn't reach R2 | Files 404 or loop | Verify on first deploy. Fallback is binding-based serving (02) |
| `ScaleXY/planner` must be public | Otherwise `brew install` can't download release assets | Create it public |
