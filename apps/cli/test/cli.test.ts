import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { run, type Deps } from "../src/cli";
import type { RunWrangler } from "../src/wrangler";

const ACCOUNT = "98f0ecdd86a00f1677266b31bd313769";
const OTHER = "dc8c09e3fa76dde0af1774ccc77b17da";
// 2026-10-26 10:30 IST (tests run with TZ=Asia/Kolkata).
const NOW = new Date("2026-10-26T05:00:00Z");

let dir: string;
let file: string;
let calls: { args: string[]; env?: Record<string, string> }[];
let out: string[];
let err: string[];

function deps(overrides: Partial<Deps> & { accounts?: { id: string; name: string }[] } = {}): Deps {
	const accounts = overrides.accounts ?? [{ id: ACCOUNT, name: "ScaleXY" }];
	const fake: RunWrangler = async (args, env) => {
		calls.push({ args, env });
		if (args[0] === "whoami") return { code: 0, stdout: JSON.stringify({ loggedIn: true, accounts }), stderr: "" };
		if (args[0] === "auth") return { code: 0, stdout: JSON.stringify({ type: "oauth", token: "tok" }), stderr: "" };
		return { code: 0, stdout: "Upload complete.", stderr: "" };
	};
	return {
		env: { XDG_CONFIG_HOME: join(dir, "config") },
		run: fake,
		fetch: vi.fn<typeof fetch>(),
		now: () => NOW,
		out: (l) => out.push(l),
		err: (l) => err.push(l),
		...overrides,
	};
}

const puts = () => calls.filter((c) => c.args[0] === "r2");

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "planner-test-"));
	file = join(dir, "Weekly Review.html");
	await writeFile(file, "<h1>hi</h1>");
	calls = [];
	out = [];
	err = [];
});

describe("upload", () => {
	it("uploads with the derived slug, local date, content type and --remote", async () => {
		expect(await run([file, "--bucket", "plans"], deps())).toBe(0);
		expect(puts()).toEqual([
			{
				args: ["r2", "object", "put", "plans/2026/10/26/1792990800-weekly-review-pub", "--file", file, "--content-type", "text/html; charset=utf-8", "--remote"],
				env: { CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
			},
		]);
		expect(err).toContain(`Using account ScaleXY (${ACCOUNT})`);
		expect(out).toEqual(["2026/10/26/1792990800-weekly-review-pub"]);
	});

	it("accepts the explicit upload command, --slug and --private", async () => {
		await run(["upload", file, "-b", "plans", "-s", "q4-goals", "--private"], deps());
		expect(puts()[0]!.args[3]).toBe("plans/2026/10/26/1792990800-q4-goals-pri");
	});

	it("prints the public URL when base_url is configured", async () => {
		const d = deps();
		await run(["config", "set", "base_url", "https://plans.athul.dev/"], d);
		await run(["config", "set", "bucket", "plans"], d);
		await run([file], d);
		expect(out.at(-1)).toBe("https://plans.athul.dev/2026/10/26/1792990800-weekly-review-pub");
	});

	it("rejects bad slugs, modes and missing files", async () => {
		expect(await run([file, "-b", "plans", "--slug", "Bad Slug"], deps())).toBe(1);
		expect(await run([file, "-b", "plans", "--mode", "secret"], deps())).toBe(1);
		expect(await run([join(dir, "missing.html"), "-b", "plans"], deps())).toBe(1);
		const junk = join(dir, "!!!.html");
		await writeFile(junk, "");
		expect(await run([junk, "-b", "plans"], deps())).toBe(1);
		expect(err.join("\n")).toMatch(/Invalid slug.*\n.*--mode.*\n.*Not a file.*\n.*Pass one with --slug/s);
		expect(puts()).toEqual([]);
	});

	it("warns about non-HTML files", async () => {
		const txt = join(dir, "notes.md");
		await writeFile(txt, "# notes");
		expect(await run([txt, "-b", "plans"], deps())).toBe(0);
		expect(err[0]).toMatch(/doesn't look like HTML/);
	});

	it("requires a bucket", async () => {
		expect(await run([file], deps())).toBe(1);
		expect(err.at(-1)).toMatch(/No bucket/);
	});

	it("does nothing on --dry-run", async () => {
		expect(await run([file, "-b", "plans", "-n"], deps())).toBe(0);
		expect(puts()).toEqual([]);
		expect(err.join("\n")).toContain("Key:     2026/10/26/1792990800-weekly-review-pub");
		expect(err.join("\n")).toContain("--content-type 'text/html; charset=utf-8' --remote");
	});

	it("passes wrangler's failure through", async () => {
		const failing: RunWrangler = async (args) =>
			args[0] === "r2" ? { code: 7, stdout: "", stderr: "✘ [ERROR] The specified bucket does not exist." } : { code: 0, stdout: "{}", stderr: "" };
		expect(await run([file, "-b", "nope", "-a", ACCOUNT], deps({ run: failing }))).toBe(7);
		expect(err.at(-1)).toContain("The specified bucket does not exist.");
	});
});

describe("account resolution", () => {
	const accountUsed = () => puts()[0]!.env!.CLOUDFLARE_ACCOUNT_ID;

	it("prefers --account-id, then CLOUDFLARE_ACCOUNT_ID, then config", async () => {
		const d = deps({ accounts: [] });
		await run(["config", "set", "account_id", ACCOUNT], d);
		d.env.CLOUDFLARE_ACCOUNT_ID = OTHER;
		await run([file, "-b", "plans", "-a", "11111111111111111111111111111111"], d);
		await run([file, "-b", "plans"], d);
		delete d.env.CLOUDFLARE_ACCOUNT_ID;
		await run([file, "-b", "plans"], d);
		expect(puts().map((c) => c.env!.CLOUDFLARE_ACCOUNT_ID)).toEqual(["11111111111111111111111111111111", OTHER, ACCOUNT]);
		expect(calls.some((c) => c.args[0] === "whoami")).toBe(false);
	});

	it("refuses to guess between several accounts", async () => {
		const d = deps({ accounts: [{ id: ACCOUNT, name: "ScaleXY" }, { id: OTHER, name: "761 Labs" }] });
		expect(await run([file, "-b", "plans"], d)).toBe(1);
		expect(err.at(-1)).toMatch(/2 accounts.*\n  ScaleXY   98f0.*\n  761 Labs  dc8c/s);
		expect(puts()).toEqual([]);
	});

	it("lists accounts through the API for a profile, since whoami rejects --profile", async () => {
		const fetchFn = vi.fn<typeof fetch>(async (input) => {
			const page = Number(new URL(String(input)).searchParams.get("page"));
			const result = page === 1 ? [{ id: ACCOUNT, name: "ScaleXY" }] : [];
			return Response.json({ success: true, result, result_info: { total_pages: 2 } });
		});
		const d = deps({ fetch: fetchFn });
		expect(await run([file, "-b", "plans", "--profile", "work"], d)).toBe(0);
		expect(calls.map((c) => c.args.slice(0, 2))).toEqual([
			["auth", "token"],
			["r2", "object"],
		]);
		expect(calls[0]!.args).toEqual(["auth", "token", "--json", "--profile", "work"]);
		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(fetchFn.mock.calls[0]![1]).toEqual({ headers: { Authorization: "Bearer tok" } });
		expect(puts()[0]!.args.slice(-2)).toEqual(["--profile", "work"]);
		expect(accountUsed()).toBe(ACCOUNT);
	});

	it("reads the profile from PLANNER_PROFILE", async () => {
		const d = deps();
		d.env.PLANNER_PROFILE = "env-profile";
		await run([file, "-b", "plans", "-a", ACCOUNT], d);
		expect(puts()[0]!.args.slice(-2)).toEqual(["--profile", "env-profile"]);
	});
});

describe("config", () => {
	it("sets, gets, lists and unsets values in a private file", async () => {
		const d = deps();
		expect(await run(["config", "set", "account_id", ACCOUNT], d)).toBe(0);
		expect(await run(["config", "set", "bucket", "plans"], d)).toBe(0);
		expect(await run(["config", "get", "bucket"], d)).toBe(0);
		expect(await run(["config", "list"], d)).toBe(0);
		expect(out).toEqual(["plans", `account_id=${ACCOUNT}`, "bucket=plans"]);

		const path = join(dir, "config", "planner", "config.json");
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ account_id: ACCOUNT, bucket: "plans" });

		expect(await run(["config", "unset", "bucket"], d)).toBe(0);
		expect(await run(["config", "get", "bucket"], d)).toBe(1);
	});

	it("validates keys and values", async () => {
		const d = deps();
		expect(await run(["config", "set", "account_id", "nope"], d)).toBe(1);
		expect(await run(["config", "set", "base_url", "ftp://x"], d)).toBe(1);
		expect(await run(["config", "set", "colour", "blue"], d)).toBe(1);
		expect(err.join("\n")).toMatch(/hex.*\n.*http\(s\).*\n.*Unknown config key/s);
	});
});

describe("help and version", () => {
	it("prints the version", async () => {
		expect(await run(["--version"], deps())).toBe(0);
		expect(out).toEqual(["0.1.0"]);
	});

	it("prints usage with no arguments", async () => {
		expect(await run([], deps())).toBe(1);
		expect(err[0]).toMatch(/^planner 0\.1\.0/);
	});
});
