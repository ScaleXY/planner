import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CliError } from "./errors";

export const CONFIG_KEYS = ["account_id", "bucket", "profile", "base_url"] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];
export type Config = Partial<Record<ConfigKey, string>>;

const VALIDATORS: Record<ConfigKey, (v: string) => string | null> = {
	account_id: (v) => (/^[0-9a-f]{32}$/.test(v) ? null : "must be a 32-character hex Cloudflare account ID"),
	bucket: (v) => (/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(v) ? null : "must be a valid R2 bucket name"),
	profile: (v) => (v.trim() ? null : "must not be empty"),
	base_url: (v) => {
		try {
			return ["http:", "https:"].includes(new URL(v).protocol) ? null : "must be an http(s) URL";
		} catch {
			return "must be an http(s) URL";
		}
	},
};

export function isConfigKey(key: string): key is ConfigKey {
	return (CONFIG_KEYS as readonly string[]).includes(key);
}

export function validateConfigValue(key: ConfigKey, value: string): void {
	const problem = VALIDATORS[key](value);
	if (problem) throw new CliError(`${key} ${problem}: "${value}"`);
}

export function configPath(env: NodeJS.ProcessEnv): string {
	return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "planner", "config.json");
}

export async function readConfig(path: string): Promise<Config> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw e;
	}
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new CliError(`Config file ${path} is not valid JSON`);
	}
	const config: Config = {};
	for (const [key, value] of Object.entries(data ?? {})) {
		if (isConfigKey(key) && typeof value === "string") config[key] = value;
	}
	return config;
}

export async function writeConfig(path: string, config: Config): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
	await chmod(path, 0o600);
}
