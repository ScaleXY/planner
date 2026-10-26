import { DAY_RE, MONTH_RE, YEAR_RE, parseFileName, type ParsedFile } from "@planner/core";

const CHILD_RE = [YEAR_RE, MONTH_RE, DAY_RE];

/** Names of the folders directly under `prefix` that match the scheme for that level, newest first. */
export async function listFolders(bucket: R2Bucket, prefix: string): Promise<string[]> {
	const depth = prefix === "" ? 0 : prefix.split("/").length - 1;
	const re = CHILD_RE[depth]!;
	const names: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, delimiter: "/", cursor });
		for (const p of page.delimitedPrefixes) {
			const name = p.slice(prefix.length, -1);
			if (re.test(name)) names.push(name);
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return names.sort().reverse();
}

export interface DayListing {
	/** Whether the day has any plan at all, public or private. */
	exists: boolean;
	/** Public plans, newest first. */
	plans: (ParsedFile & { name: string })[];
}

export async function listDay(bucket: R2Bucket, prefix: string): Promise<DayListing> {
	const listing: DayListing = { exists: false, plans: [] };
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, cursor });
		for (const obj of page.objects) {
			const name = obj.key.slice(prefix.length);
			const parsed = parseFileName(name);
			if (!parsed) continue;
			listing.exists = true;
			if (parsed.mode === "pub") listing.plans.push({ ...parsed, name });
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	listing.plans.sort((a, b) => b.timestamp - a.timestamp || b.name.localeCompare(a.name));
	return listing;
}
