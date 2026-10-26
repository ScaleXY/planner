import { CliError } from "./errors";
import { authToken, whoamiAccounts, type Account, type RunWrangler } from "./wrangler";

const API = "https://api.cloudflare.com/client/v4";

export interface ResolvedAccount {
	id: string;
	/** Set when the account was auto-detected. */
	name?: string;
}

export interface AccountSources {
	flag?: string;
	env?: string;
	config?: string;
	profile?: string;
}

/** `--account-id` → `CLOUDFLARE_ACCOUNT_ID` → config → the only account the credentials can see. */
export async function resolveAccount(sources: AccountSources, run: RunWrangler, fetchFn: typeof fetch): Promise<ResolvedAccount> {
	const explicit = sources.flag || sources.env || sources.config;
	if (explicit) return { id: explicit };

	const accounts = sources.profile ? await profileAccounts(run, sources.profile, fetchFn) : await whoamiAccounts(run);
	if (accounts.length === 1) return accounts[0]!;
	if (accounts.length === 0) throw new CliError("These credentials can't see any Cloudflare accounts.");
	const width = Math.max(...accounts.map((a) => a.name.length));
	throw new CliError(
		[
			`These credentials can see ${accounts.length} accounts, so pick one with --account-id or \`planner config set account_id <id>\`:`,
			...accounts.map((a) => `  ${a.name.padEnd(width)}  ${a.id}`),
		].join("\n"),
	);
}

/** `wrangler whoami` rejects `--profile`, so list accounts with the profile's token instead. */
async function profileAccounts(run: RunWrangler, profile: string, fetchFn: typeof fetch): Promise<Account[]> {
	const { type, token } = await authToken(run, profile);
	if (type !== "oauth" && type !== "api_token") {
		throw new CliError(`Can't list accounts for wrangler profile "${profile}" (credential type "${type}"). Pass --account-id.`);
	}
	const accounts: Account[] = [];
	for (let page = 1; ; page++) {
		const res = await fetchFn(`${API}/accounts?per_page=50&page=${page}`, { headers: { Authorization: `Bearer ${token}` } });
		const body = (await res.json().catch(() => null)) as {
			success?: boolean;
			result?: Account[];
			result_info?: { total_pages?: number };
		} | null;
		if (!res.ok || !body?.success) throw new CliError(`Listing accounts for wrangler profile "${profile}" failed (HTTP ${res.status}). Pass --account-id.`);
		accounts.push(...(body.result ?? []).map(({ id, name }) => ({ id, name })));
		if (page >= (body.result_info?.total_pages ?? 1)) return accounts;
	}
}
