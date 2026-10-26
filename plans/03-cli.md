# 03 — CLI (`apps/cli`, binary `planner`)

A TypeScript CLI bundled into one `planner.mjs`, which shells out to `wrangler`. Node is already a hard
dependency of wrangler, so writing the CLI in Node adds no new runtime, and it shares `@planner/core`
with the Worker.

## Usage

```
planner upload <file> [--slug <slug>] [--private] [--account-id <id>] [--bucket <name>] [--profile <p>] [--dry-run]
planner <file> …                       # shorthand for `upload`

planner config set <key> <value>       # keys: account_id, bucket, profile, base_url
planner config get <key>
planner config unset <key>
planner config list

planner --version | --help
```

- `--slug`: if omitted, derived from the file name with `slugify("Weekly Review.html")` → `weekly-review`.
  The result is validated against `SLUG_RE`, and the CLI errors on an empty or invalid slug.
- `--private` → mode `pri`. The default is `pub` (`--mode pub|pri` is accepted as an alias).
- `--dry-run` prints the resolved account, bucket, key, URL, and the wrangler command, then exits without uploading.

## Config storage

`$XDG_CONFIG_HOME/planner/config.json` (default `~/.config/planner/config.json`), mode `0600`:

```json
{ "account_id": "98f0ecdd86a00f1677266b31bd313769", "bucket": "plans", "profile": null, "base_url": "https://plans.athul.dev" }
```

`base_url` is optional. When it is set, the CLI prints the public URL of the uploaded plan.

## Resolution order

| Setting | Order (first match wins) |
|---|---|
| bucket | `--bucket` → `PLANNER_BUCKET` → config `bucket` → **error** |
| profile | `--profile` → `PLANNER_PROFILE` → config `profile` → none |
| account | `--account-id` → `CLOUDFLARE_ACCOUNT_ID` → config `account_id` → **auto-detect** → error |

### Account auto-detect

1. Without a profile, run `wrangler whoami --json` and read `accounts`.
2. With a profile (`whoami` rejects `--profile`), run `wrangler auth token --json --profile P` to get
   `{type, token}`, then call `GET https://api.cloudflare.com/client/v4/accounts?per_page=50` (paged) with
   `Authorization: Bearer <token>`. The token is kept in memory only and never logged.
3. Exactly one account → use it and print `Using account <name> (<id>)`.
   No accounts or more than one → error that lists `name  id` and suggests
   `--account-id` or `planner config set account_id <id>`.

## Upload

```
wrangler r2 object put <bucket>/<key> \
  --file <abs path> --content-type "text/html; charset=utf-8" --remote [--profile P]
```

- `key = buildKey(new Date(), slug, mode)`. The date folder comes from the **system's local date**, and
  the timestamp is unix seconds. The CLI does not set or override `TZ`, so the user's system time zone applies.
- Run with env `CLOUDFLARE_ACCOUNT_ID=<resolved>` and `cwd` set to an empty temp dir, so a nearby
  `wrangler.jsonc` or a directory-bound profile can't change the target.
- The content type must be set: R2's custom domain serves objects with their stored content type, and
  with no extension a browser would otherwise download the file instead of rendering it.
- Pre-flight checks: the file exists and is readable, and `wrangler` is on PATH (otherwise the error says
  `brew install cloudflare-wrangler`). Non-HTML extensions produce a warning, not an error.
- wrangler's stdout/stderr is captured. On failure, the CLI shows the tail of the output and exits with
  wrangler's code. On success it prints:

  ```
  ✔ Uploaded 2026/10/26/1792990800-weekly-review-pub → plans
    https://plans.athul.dev/2026/10/26/1792990800-weekly-review-pub
  ```
- The wrangler binary can be overridden with `PLANNER_WRANGLER` (useful for `npx wrangler` and for tests).

## Modules

| File | Responsibility |
|---|---|
| `index.ts` | Argument parsing (`node:util` `parseArgs`, no deps), command dispatch |
| `config.ts` | Read, write, and validate the config file |
| `wrangler.ts` | The only place that spawns wrangler (`whoami`, `auth token`, `r2 object put`) |
| `accounts.ts` | Account resolution + Cloudflare API call (`fetch`) |

## Tests

- `core`: `buildKey`/`parseFileName` round-trip, slugify, local-date folder under different `TZ` values.
- CLI: point `PLANNER_WRANGLER` at a fake script that records argv/env and prints canned `whoami` /
  `auth token` JSON (and mock `fetch` for `/accounts`). Assert resolution order, single- vs multi-account
  behaviour, `--profile` passthrough, `--remote` and `--content-type` always present, and the neutral cwd.
- Manual e2e: upload `pub` and `pri` files to the demo bucket. Check that the day listing on
  plans.athul.dev shows only the `pub` one and that both URLs render as HTML. Then delete both.
