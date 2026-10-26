# 04 — Release & Homebrew distribution

## Tap

Use the existing public **`ScaleXY/homebrew-tap`**. It currently holds only `Casks/ai-headroom.rb`. Add
`Formula/planner.rb` there. Install with:

```
brew install scalexy/tap/planner
```

`planner` is not taken in homebrew-core, so there is no name clash.

## Artifact

There is no native compilation, so a single bundled JS file is enough:

- `pnpm --filter cli build` → `apps/cli/dist/planner.mjs` (bundles `@planner/core`, shebang `#!/usr/bin/env node`)
- Release asset on `ScaleXY/planner` (**public**): `planner-<version>.tar.gz` containing `planner.mjs` and `LICENSE`, plus a `.sha256` file
- Tag scheme: `cli-v<semver>`. The Worker deploys independently and isn't versioned through brew.

## Formula (`Formula/planner.rb` in `ScaleXY/homebrew-tap`)

The header comment follows the convention of the existing cask.

```ruby
# Homebrew formula for planner, published to ScaleXY/homebrew-tap by ScaleXY/planner's .github/workflows/release.yml.
# The workflow fills in version and sha256 for each tagged release; the rest is maintained here.
class Planner < Formula
  desc "Upload HTML plans to Cloudflare R2 (plans.athul.dev)"
  homepage "https://github.com/ScaleXY/planner"
  url "https://github.com/ScaleXY/planner/releases/download/cli-v0.1.0/planner-0.1.0.tar.gz"
  sha256 "<sha>"
  license "MIT"

  depends_on "cloudflare-wrangler"
  depends_on "node"

  def install
    libexec.install "planner.mjs"
    (bin/"planner").write <<~SH
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/planner.mjs" "$@"
    SH
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/planner --version")
  end
end
```

`depends_on "cloudflare-wrangler"` guarantees that wrangler exists. Users with wrangler from npm get a
second copy. That's acceptable, and `PLANNER_WRANGLER` lets them pick which one is used.

## Release workflow (`ScaleXY/planner/.github/workflows/release.yml`)

This mirrors `ScaleXY/headroom`'s release workflow, which already pushes to the tap.

On push of a `cli-v*` tag:

1. `pnpm i --frozen-lockfile && pnpm test && pnpm --filter cli build`
2. Check that the tag version equals `apps/cli/package.json` version (and the `--version` output)
3. Pack the tarball and `.sha256`, then `gh release create` with both assets (`GH_TOKEN: github.token`)
4. Job `homebrew`: using the **existing org secret `HOMEBREW_TAP_TOKEN`**, check out
   `ScaleXY/homebrew-tap`, rewrite `url`/`sha256` in `Formula/planner.rb`, and commit
   `planner <version>` as `github-actions[bot]`, then push. If the secret is unavailable, skip with a
   `::notice::` (same as headroom).
   - Confirm that the fine-grained token's repo access already covers `ScaleXY/homebrew-tap`
     (it does for headroom). It's an org secret, so it should be visible to the new repo. If its
     repository access policy is "selected repositories", add `ScaleXY/planner`.

The first formula commit (creating `Formula/`) can be done by hand for v0.1.0. The workflow handles updates after that.

## Verification

- `brew install --build-from-source ./Formula/planner.rb` locally, then `brew test planner`, then `brew audit --strict --new planner`
- `brew install scalexy/tap/planner` on a clean user, then `planner --version`, plus a real upload that shows up on plans.athul.dev
