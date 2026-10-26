# 02 — Worker (`apps/worker`)

The Worker sits in front of the existing R2 custom domain `plans.athul.dev`. It renders the index pages
and forwards everything else to R2.

## Config (`wrangler.jsonc`)

```jsonc
{
  "name": "planner",
  "main": "src/index.ts",
  "account_id": "98f0ecdd86a00f1677266b31bd313769",
  "compatibility_date": "2026-10-26",
  "workers_dev": false,
  "routes": [
    { "pattern": "plans.athul.dev/*", "zone_name": "athul.dev" }
  ],
  "r2_buckets": [{ "binding": "PLANS", "bucket_name": "plans" }]
}
```

### Why a single `/*` route

Route wildcards are only allowed at the end of the path, so no pattern can match `/2026/10/26` without
also matching `/2026/10/26/<file>` (details in 00). The wildcard route therefore catches every request,
and the Worker decides:

```
GET/HEAD and path matches an index shape  → render a listing (below)
anything else                             → return fetch(request)   // goes to origin = R2 custom domain
```

- The DNS record for `plans.athul.dev` already exists and is proxied (created by the R2 custom domain),
  so the route works without any DNS changes.
- **First-deploy check:** `curl -I https://plans.athul.dev/<some key>` must return the object from R2,
  not a Worker loop or error. **Fallback** if the passthrough doesn't reach R2: serve files from the
  binding with `env.PLANS.get(key, { onlyIf: request.headers, range: request.headers })`, using
  `writeHttpMetadata` + `ETag` and returning 304/206 as appropriate. Keep this fallback behind a
  `SERVE_FROM_BINDING` var so switching is a config change.

## Index routes

Each segment is validated with the regexes from `@planner/core`. Paths with a trailing slash (`/2026/`)
get a 301 to the no-slash form. Index-shaped paths with invalid values (e.g. `/2026/13`) → 404 from the
Worker, not passthrough.

| Path | Action | R2 call |
|---|---|---|
| `/` | List years | `list({ delimiter: "/" })` → `delimitedPrefixes` matching `YEAR_RE` |
| `/:year` | List months | `list({ prefix: "2026/", delimiter: "/" })` → keep `MONTH_RE` |
| `/:year/:month` | List days | `list({ prefix: "2026/10/", delimiter: "/" })` → keep `DAY_RE` |
| `/:year/:month/:day` | List **`pub` files only** | `list({ prefix: "2026/10/26/" })` → `parseFileName`, keep `mode === "pub"` |

- Every list call pages with `cursor` until `truncated === false`.
- Sort order: newest first at every level. Within a day, sort by the numeric unix timestamp.
- Entries that don't match the scheme are ignored.

## Listing HTML

- Server-rendered strings, no framework, small inline CSS. Every interpolated value is HTML-escaped.
- A breadcrumb at the top (`plans.athul.dev › 2026 › October › 26`).
- Year/month/day pages show links. Month names are rendered for display (`10` → "October").
- The day page shows one row per `pub` plan: the title (slug with `-` → space, title-cased) and the time,
  linking to `/<y>/<m>/<d>/<file>`, which R2 serves.
  - Time: `<time datetime="2026-10-26T05:00:00Z">05:00 UTC</time>`, plus a ~5-line inline script that
    rewrites it to the viewer's local time with `toLocaleTimeString`. The Worker can't know the viewer's
    time zone, and the folder date is the uploader's local date.
  - "No public plans" when a day only has `pri` files.
- Listing responses use `Cache-Control: public, max-age=60`.

## Tests (`@cloudflare/vitest-plugin`)

Seed the miniflare R2 with keys across two years, `pub`/`pri` mixes, a malformed key, and more than 1000
objects in one day (to exercise paging). Then assert:

- each level lists only valid children, newest first
- `pri` files never appear in a day listing, and slugs/HTML are escaped
- invalid index shapes → 404, a trailing slash → 301
- a file path or unknown path is passed through (`fetch` is mocked, so assert it was called with the
  original request)
- with `SERVE_FROM_BINDING=true`, files are served from the binding with the right content type, ETag, and 304

## Deploy

`pnpm --filter worker run deploy` runs `wrangler deploy`, which attaches the route. Afterwards, smoke test:

```
curl -s https://plans.athul.dev/            # years
curl -s https://plans.athul.dev/2026/10     # days
curl -sI https://plans.athul.dev/2026/10/25/1792951187-headroom-crazy-ideas-pub   # R2 via passthrough
```

## Update 2026-10-26: Custom Domain instead of a route

The Worker is now attached as the **Custom Domain** `plans.athul.dev`
(`"routes": [{ "pattern": "plans.athul.dev", "custom_domain": true }]`), not a `plans.athul.dev/*` route.
This replaces the routing and passthrough sections above:

- A Worker on a Custom Domain *is* the origin, so it can't forward to R2 with `fetch(request)`. It always
  serves files from the `PLANS` binding (ETag/304, ranges, HEAD, `Cache-Control: public, max-age=300`,
  `X-Robots-Tag: noindex` for `pri`). The `SERVE_FROM_BINDING` switch is gone.
- Custom Domains can't share a hostname with existing DNS records, so the bucket's R2 custom domain on
  `plans.athul.dev` was removed (`wrangler r2 bucket domain remove plans --domain plans.athul.dev`). R2 no
  longer serves the bucket publicly by itself. Every request goes through the Worker. The bucket's `r2.dev`
  URL was already disabled.
- Any key is served at `/<key>`, so the un-migrated root object stays reachable at its old URL until 05 runs.
