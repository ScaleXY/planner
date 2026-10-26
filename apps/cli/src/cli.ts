import { stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { SLUG_RE, buildKey, slugify, type Mode } from "@planner/core";
import pkg from "../package.json" with { type: "json" };
import { resolveAccount } from "./accounts";
import { CONFIG_KEYS, configPath, isConfigKey, readConfig, validateConfigValue, writeConfig, type Config } from "./config";
import { CliError } from "./errors";
import { putArgs, putObject, type RunWrangler } from "./wrangler";

export interface Deps {
	env: NodeJS.ProcessEnv;
	run: RunWrangler;
	fetch: typeof fetch;
	now: () => Date;
	out: (line: string) => void;
	err: (line: string) => void;
}

const HELP = `planner ${pkg.version}: upload HTML plans to Cloudflare R2

Usage:
  planner [upload] <file> [options]
  planner config set <key> <value>
  planner config get <key>
  planner config unset <key>
  planner config list

Upload options:
  -s, --slug <slug>        Name in the URL (default: derived from the file name)
  -p, --private            Upload as "pri": viewable by URL, never listed
      --mode <pub|pri>     Same as --private when "pri" (default: pub)
  -a, --account-id <id>    Cloudflare account (default: $CLOUDFLARE_ACCOUNT_ID, config, or the only account)
  -b, --bucket <name>      R2 bucket (default: $PLANNER_BUCKET or config)
      --profile <name>     wrangler auth profile (default: $PLANNER_PROFILE or config)
  -n, --dry-run            Show what would be uploaded without uploading

Config keys: ${CONFIG_KEYS.join(", ")}
`;

export async function run(argv: string[], deps: Deps): Promise<number> {
	try {
		const [command, ...rest] = argv;
		if (command === "config") return await configCommand(rest, deps);
		return await uploadCommand(command === "upload" ? rest : argv, deps);
	} catch (e) {
		if (e instanceof CliError) {
			deps.err(`✘ ${e.message}`);
			return e.exitCode;
		}
		throw e;
	}
}

async function uploadCommand(argv: string[], deps: Deps): Promise<number> {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			slug: { type: "string", short: "s" },
			private: { type: "boolean", short: "p" },
			mode: { type: "string" },
			"account-id": { type: "string", short: "a" },
			bucket: { type: "string", short: "b" },
			profile: { type: "string" },
			"dry-run": { type: "boolean", short: "n" },
			help: { type: "boolean", short: "h" },
			version: { type: "boolean", short: "v" },
		},
	});
	if (values.version) {
		deps.out(pkg.version);
		return 0;
	}
	if (values.help || positionals.length === 0) {
		(values.help ? deps.out : deps.err)(HELP);
		return values.help ? 0 : 1;
	}
	if (positionals.length > 1) throw new CliError(`Expected one file, got ${positionals.length}: ${positionals.join(" ")}`);

	const file = resolve(positionals[0]!);
	const info = await stat(file).catch(() => null);
	if (!info?.isFile()) throw new CliError(`Not a file: ${positionals[0]}`);
	if (![".html", ".htm"].includes(extname(file).toLowerCase())) {
		deps.err(`! ${basename(file)} doesn't look like HTML; it will be served as text/html anyway.`);
	}

	const slug = values.slug ?? slugify(basename(file));
	if (!SLUG_RE.test(slug)) {
		throw new CliError(
			values.slug
				? `Invalid slug "${slug}": use lowercase letters, digits and single hyphens.`
				: `Couldn't derive a slug from "${basename(file)}". Pass one with --slug.`,
		);
	}
	if (values.mode !== undefined && values.mode !== "pub" && values.mode !== "pri") throw new CliError(`--mode must be "pub" or "pri"`);
	if (values.private && values.mode === "pub") throw new CliError("--private conflicts with --mode pub");
	const mode: Mode = values.private || values.mode === "pri" ? "pri" : "pub";

	const config = await readConfig(configPath(deps.env));
	const bucket = values.bucket || deps.env.PLANNER_BUCKET || config.bucket;
	if (!bucket) throw new CliError("No bucket. Pass --bucket or run `planner config set bucket <name>`.");
	const profile = values.profile || deps.env.PLANNER_PROFILE || config.profile || undefined;
	const account = await resolveAccount(
		{ flag: values["account-id"], env: deps.env.CLOUDFLARE_ACCOUNT_ID, config: config.account_id, profile },
		deps.run,
		deps.fetch,
	);
	if (account.name) deps.err(`Using account ${account.name} (${account.id})`);

	const key = buildKey(deps.now(), slug, mode);
	const url = config.base_url ? `${config.base_url.replace(/\/+$/, "")}/${key}` : undefined;
	const options = { bucket, key, file, accountId: account.id, profile };

	if (values["dry-run"]) {
		deps.err(`Account: ${account.id}\nBucket:  ${bucket}\nKey:     ${key}${profile ? `\nProfile: ${profile}` : ""}${url ? `\nURL:     ${url}` : ""}`);
		deps.err(`Command: CLOUDFLARE_ACCOUNT_ID=${account.id} wrangler ${putArgs(options).map(shellQuote).join(" ")}`);
		return 0;
	}

	await putObject(deps.run, options);
	deps.err(`✔ Uploaded ${key} → ${bucket}${mode === "pri" ? " (private: not listed)" : ""}`);
	deps.out(url ?? key);
	return 0;
}

async function configCommand(argv: string[], deps: Deps): Promise<number> {
	const [action, key, value, ...extra] = argv;
	const path = configPath(deps.env);
	const config = await readConfig(path);
	const needKey = (): keyof Config => {
		if (!key) throw new CliError(`Usage: planner config ${action} <key>${action === "set" ? " <value>" : ""}`);
		if (!isConfigKey(key)) throw new CliError(`Unknown config key "${key}". Keys: ${CONFIG_KEYS.join(", ")}`);
		return key;
	};

	switch (action) {
		case "set": {
			const k = needKey();
			if (value === undefined || extra.length) throw new CliError("Usage: planner config set <key> <value>");
			validateConfigValue(k, value);
			await writeConfig(path, { ...config, [k]: value });
			deps.err(`Set ${k} in ${path}`);
			return 0;
		}
		case "get": {
			const v = config[needKey()];
			if (v === undefined) return 1;
			deps.out(v);
			return 0;
		}
		case "unset": {
			const k = needKey();
			const { [k]: _, ...remaining } = config;
			await writeConfig(path, remaining);
			return 0;
		}
		case "list":
			for (const k of CONFIG_KEYS) if (config[k] !== undefined) deps.out(`${k}=${config[k]}`);
			return 0;
		default:
			throw new CliError("Usage: planner config <set|get|unset|list> …");
	}
}

function shellQuote(s: string): string {
	return /^[\w./:=@-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
