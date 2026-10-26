import { chmod, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CliError } from "../src/errors";
import { tail, wranglerRunner } from "../src/wrangler";

describe("wranglerRunner", () => {
	it("runs from an empty temp dir with the extra env, and captures output", async () => {
		const dir = await mkdtemp(join(tmpdir(), "planner-fake-"));
		const log = join(dir, "log.json");
		const fake = join(dir, "fake-wrangler");
		await writeFile(
			fake,
			`#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), files: fs.readdirSync("."), account: process.env.CLOUDFLARE_ACCOUNT_ID }));
console.log("out"); console.error("err"); process.exit(3);
`,
		);
		await chmod(fake, 0o755);

		const run = wranglerRunner({ ...process.env, PLANNER_WRANGLER: `${fake} --extra` });
		const result = await run(["r2", "object", "put"], { CLOUDFLARE_ACCOUNT_ID: "abc" });
		expect(result).toEqual({ code: 3, stdout: "out\n", stderr: "err\n" });

		const seen = JSON.parse(await readFile(log, "utf8"));
		expect(seen.args).toEqual(["--extra", "r2", "object", "put"]);
		expect(seen.cwd.startsWith(join(await realpath(tmpdir()), "planner-"))).toBe(true);
		expect(seen.files).toEqual([]);
		expect(seen.account).toBe("abc");
	});

	it("explains how to install wrangler when it's missing", async () => {
		const run = wranglerRunner({ ...process.env, PLANNER_WRANGLER: "/nonexistent/wrangler" });
		await expect(run(["whoami"])).rejects.toThrow(CliError);
		await expect(run(["whoami"])).rejects.toThrow(/brew install cloudflare-wrangler/);
	});
});

describe("tail", () => {
	it("drops the banner and colours", () => {
		const stdout = "\n ⛅️ wrangler 4.152.0\n───────────────\nCreating object\n";
		const stderr = "\x1b[31m✘ \x1b[41;31m[ERROR]\x1b[0m bucket missing\n";
		expect(tail({ code: 1, stdout, stderr })).toBe("Creating object\n✘ [ERROR] bucket missing");
	});
});
