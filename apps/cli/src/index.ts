import { run } from "./cli";
import { wranglerRunner } from "./wrangler";

process.exitCode = await run(process.argv.slice(2), {
	env: process.env,
	run: wranglerRunner(process.env),
	fetch,
	now: () => new Date(),
	out: (line) => process.stdout.write(`${line}\n`),
	err: (line) => process.stderr.write(`${line}\n`),
});
