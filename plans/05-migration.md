# 05 — Migrate the existing root object

The bucket contains one object outside the scheme:

| | Value |
|---|---|
| Old key | `headroom-crazy-ideas-20261025T175947Z` |
| Content type | `text/html; charset=utf-8`, 14,196 bytes |
| Instant | 2026-10-25 17:59:47 UTC = 23:29:47 IST → unix `1792951187` |
| **New key** | `2026/10/25/1792951187-headroom-crazy-ideas-pub` |

The date folder is `2026/10/25` under the system-local-time rule (IST); the UTC date is the same here.
Mode is assumed to be `pub`. **There is no redirect:** the old URL
`https://plans.athul.dev/headroom-crazy-ideas-20261025T175947Z` will 404 after the move.

## Steps

```
export CLOUDFLARE_ACCOUNT_ID=98f0ecdd86a00f1677266b31bd313769
wrangler r2 object get plans/headroom-crazy-ideas-20261025T175947Z --remote --file /tmp/migrate.html
wrangler r2 object put plans/2026/10/25/1792951187-headroom-crazy-ideas-pub --remote \
  --file /tmp/migrate.html --content-type "text/html; charset=utf-8"
curl -sI https://plans.athul.dev/2026/10/25/1792951187-headroom-crazy-ideas-pub   # 200, text/html (served by the Worker)
wrangler r2 object delete plans/headroom-crazy-ideas-20261025T175947Z --remote
```

Once the Worker is deployed, check that the plan appears on `https://plans.athul.dev/2026/10/25`.
