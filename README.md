# planner

HTML plans on Cloudflare R2, browsable at **https://plans.athul.dev**.

- `apps/worker`: queue consumer for the bucket's R2 events. When a public plan is added or removed, it
  regenerates the index pages `/<year>`, `/<year>/<month>` and `/<year>/<month>/<day>` as HTML objects in
  the bucket. `plans.athul.dev` is the bucket's R2 custom domain, so R2 serves everything
  ([details](plans/06-index-generation.md)).
- `apps/cli`: the `planner` CLI, which uploads a plan through wrangler.
- `packages/core`: the object key format shared by both.

Plans are stored as `<year>/<month>/<day>/<unix seconds>-<slug>-<pub|pri>` (local date of the uploader,
`text/html`, no extension). `pri` plans are viewable by URL but never listed.

## CLI

```sh
planner config set account_id 98f0ecdd86a00f1677266b31bd313769
planner config set bucket plans
planner config set base_url https://plans.athul.dev

planner "Weekly Review.html"                 # → https://plans.athul.dev/2026/10/26/1792990800-weekly-review-pub
planner notes.html --slug q4-goals --private
planner --help
```

When no account is given or configured and the wrangler login sees exactly one account, that account is used.

## Development

```sh
pnpm install
pnpm test        # all packages
pnpm typecheck
pnpm build       # apps/cli/dist/planner.mjs
pnpm --filter @planner/worker run deploy
pnpm --filter @planner/worker run rebuild   # regenerate every index page
```

Design notes and decisions are in [`plans/`](plans/README.md).
