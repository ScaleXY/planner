import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliError } from "./errors";

export interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}

export type RunWrangler = (args: string[], env?: Record<string, string>) => Promise<RunResult>;

export interface Account {
	id: string;
	name: string;
}

/**
 * Spawns wrangler from an empty temp directory, so a nearby wrangler config or a directory-bound
 * auth profile can't change which account or credentials it uses.
 * `PLANNER_WRANGLER` overrides the command, e.g. `npx wrangler`.
 */
export function wranglerRunner(processEnv: NodeJS.ProcessEnv): RunWrangler {
	const [command, ...prefix] = (processEnv.PLANNER_WRANGLER || "wrangler").trim().split(/\s+/);
	return async (args, env = {}) => {
		const cwd = await mkdtemp(join(tmpdir(), "planner-"));
		try {
			return await new Promise<RunResult>((resolve, reject) => {
				const child = spawn(command!, [...prefix, ...args], { cwd, env: { ...processEnv, ...env }, stdio: ["ignore", "pipe", "pipe"] });
				let stdout = "";
				let stderr = "";
				child.stdout.on("data", (d) => (stdout += d));
				child.stderr.on("data", (d) => (stderr += d));
				child.on("error", (e: NodeJS.ErrnoException) =>
					reject(
						e.code === "ENOENT"
							? new CliError(`Couldn't find \`${command}\`. Install it with \`brew install cloudflare-wrangler\`, or set PLANNER_WRANGLER.`)
							: e,
					),
				);
				child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
			});
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	};
}

function parseJson(result: RunResult, what: string): unknown {
	try {
		return JSON.parse(result.stdout);
	} catch {
		throw new CliError(`Couldn't read ${what} from wrangler:\n${tail(result)}`);
	}
}

/** Accounts visible to wrangler's active credentials. `whoami` doesn't accept `--profile`. */
export async function whoamiAccounts(run: RunWrangler): Promise<Account[]> {
	const result = await run(["whoami", "--json"]);
	if (result.code !== 0) throw new CliError(`wrangler isn't logged in. Run \`wrangler login\` first.\n${tail(result)}`);
	const data = parseJson(result, "account list") as { accounts?: Account[] };
	return (data.accounts ?? []).map(({ id, name }) => ({ id, name }));
}

export async function authToken(run: RunWrangler, profile: string): Promise<{ type: string; token: string }> {
	const result = await run(["auth", "token", "--json", "--profile", profile]);
	if (result.code !== 0) throw new CliError(`Couldn't get credentials for wrangler profile "${profile}".\n${tail(result)}`);
	return parseJson(result, "credentials") as { type: string; token: string };
}

export interface PutOptions {
	bucket: string;
	key: string;
	file: string;
	accountId: string;
	profile?: string;
}

export function putArgs({ bucket, key, file, profile }: PutOptions): string[] {
	const args = ["r2", "object", "put", `${bucket}/${key}`, "--file", file, "--content-type", "text/html; charset=utf-8", "--remote"];
	if (profile) args.push("--profile", profile);
	return args;
}

export async function putObject(run: RunWrangler, options: PutOptions): Promise<void> {
	const result = await run(putArgs(options), { CLOUDFLARE_ACCOUNT_ID: options.accountId });
	if (result.code !== 0) throw new CliError(`Upload failed:\n${tail(result)}`, result.code);
}

/** The last lines of wrangler's output, without its banner and colours. */
export function tail({ stdout, stderr }: RunResult, lines = 15): string {
	return `${stdout}\n${stderr}`
		.replace(/\x1b\[[0-9;]*m/g, "")
		.split("\n")
		.filter((l) => l.trim() && !l.includes("⛅️ wrangler") && !/^─+$/.test(l.trim()))
		.slice(-lines)
		.join("\n");
}
