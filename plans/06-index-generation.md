# 06 — Index pages generated from R2 events

**Status: live since 2026-10-26.** This replaces the request-serving Worker in 02.

`plans.athul.dev` is the bucket's **R2 custom domain** again, so R2 serves everything, plan files and
index pages alike. The Worker has no HTTP trigger. It consumes R2 event notifications and writes the index
pages into the bucket as ordinary objects (`text/html; charset=utf-8`, `Cache-Control: public, max-age=60`):

| Object key | URL | Lists |
|---|---|---|
| `2026` | `/2026` | Months with at least one public plan |
| `2026/10` | `/2026/10` | Days with at least one public plan |
| `2026/10/26` | `/2026/10/26` | Public plans of that day, newest first |

## Pipeline

```
planner upload ─▶ R2 put 2026/10/26/<ts>-<slug>-pub
                     │  event notification (suffix "-pub")
                     ▼
              queue planner-r2-events ─▶ Worker `planner` (queue consumer)
                                           list 2026/ → rewrite 2026, 2026/10, 2026/10/26
```

- **Notification rules** on `plans`, both delivering to queue `planner-r2-events` with suffix `-pub`:
  - `object-create` (PutObject, CopyObject, CompleteMultipartUpload)
  - `object-delete` (DeleteObject, LifecycleDeletion)
- **`pri` plans emit no events**, and pages only count public plans. A day with only private plans gets no
  page, which closes the leak noted in 00.
- **No feedback loop:** index keys (`2026/10/26`) don't end in `-pub`, so writing them emits no events.
- **Rebuild strategy:** each batch collects the affected years, months and days, lists the affected year's
  plans once, and rewrites those pages from that listing. A page with no public plans left is
  deleted. Rebuilding from a listing makes duplicate or out-of-order events harmless.
- **Consumer settings:** `max_concurrency: 1`, so batches can't race and write a stale listing over a newer
  one. Also `max_batch_size: 100`, `max_batch_timeout: 5`, `max_retries: 10`. A failing batch throws and is retried.
- **Full rebuild:** `pnpm --filter @planner/worker run rebuild` sends `{ "rebuild": "all" }` to the queue,
  which regenerates every page and deletes stale ones. Use it after template changes. It was used once to backfill.

## Limits

- **No root page.** An R2 custom domain can't map `/` to an object (there is no empty key and no index
  document), so `https://plans.athul.dev/` stays 404. Entry points are `/<year>`.
- **No trailing slash.** `/2026/10/` looks up the key `2026/10/`, which doesn't exist, so it 404s.
  Generated links never use a trailing slash.
- **Updates take a few seconds** (about 4 s measured for an upload, about 7 s for a delete).

## Setup (already done; kept for reference)

```sh
export CLOUDFLARE_ACCOUNT_ID=98f0ecdd86a00f1677266b31bd313769
wrangler queues create planner-r2-events
pnpm --filter @planner/worker run deploy          # registers the queue consumer
wrangler r2 bucket notification create plans --event-type object-create --queue planner-r2-events --suffix=-pub
wrangler r2 bucket notification create plans --event-type object-delete --queue planner-r2-events --suffix=-pub
pnpm --filter @planner/worker run rebuild          # backfill
```

(`--suffix=-pub` needs the `=`; otherwise the argument parser reads `-pub` as flags.)
