import { DAY_RE, MONTH_RE, YEAR_RE, parseFileName, type ParsedFile } from "@planner/core";
import { monthName, renderPage, slugTitle, type Crumb } from "./html";

export const SITE = "Plans";
const ROOT: Crumb = { label: SITE, href: "/" };
const INDEX_METADATA: R2HTTPMetadata = { contentType: "text/html; charset=utf-8", cacheControl: "public, max-age=60" };

export interface PlanKey extends ParsedFile {
	key: string;
	year: string;
	month: string;
	day: string;
	name: string;
}

/** Parses `YYYY/MM/DD/<unix seconds>-<slug>-<mode>`; anything else (including index pages) is null. */
export function parsePlanKey(key: string): PlanKey | null {
	const [year, month, day, name, ...rest] = key.split("/");
	if (rest.length || !name || !YEAR_RE.test(year!) || !MONTH_RE.test(month!) || !DAY_RE.test(day!)) return null;
	const parsed = parseFileName(name);
	return parsed && { ...parsed, key, year: year!, month: month!, day: day!, name };
}

/** The index pages a plan appears on, by year: the months and days whose pages need rebuilding. */
export type Affected = Map<string, { months: Set<string>; days: Set<string> }>;

export function addAffected(affected: Affected, plan: PlanKey): void {
	const entry = affected.get(plan.year) ?? { months: new Set(), days: new Set() };
	entry.months.add(`${plan.year}/${plan.month}`);
	entry.days.add(`${plan.year}/${plan.month}/${plan.day}`);
	affected.set(plan.year, entry);
}

/** Every public plan under `prefix`. */
export async function listPublicPlans(bucket: R2Bucket, prefix: string): Promise<PlanKey[]> {
	const plans: PlanKey[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, cursor });
		for (const { key } of page.objects) {
			const plan = parsePlanKey(key);
			if (plan?.mode === "pub") plans.push(plan);
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return plans;
}

/**
 * Rewrites the year, month and day index objects (`YYYY`, `YYYY/MM`, `YYYY/MM/DD`) for the affected
 * pages from the current bucket contents, and deletes pages that no longer have any public plans.
 * Only public plans are counted, so a day with only private plans gets no page at all.
 */
export async function rebuild(bucket: R2Bucket, affected: Affected): Promise<void> {
	for (const [year, { months, days }] of affected) {
		const plans = await listPublicPlans(bucket, `${year}/`);
		const writes: Promise<unknown>[] = [];
		const write = (key: string, html: string | null) =>
			writes.push(html === null ? bucket.delete(key) : bucket.put(key, html, { httpMetadata: INDEX_METADATA }));

		for (const dayKey of days) {
			const dayPlans = plans.filter((p) => `${p.year}/${p.month}/${p.day}` === dayKey);
			write(dayKey, dayPlans.length ? dayPage(dayPlans) : null);
		}
		for (const monthKey of months) {
			const monthPlans = plans.filter((p) => `${p.year}/${p.month}` === monthKey);
			write(monthKey, monthPlans.length ? monthPage(monthPlans) : null);
		}
		write(year, plans.length ? yearPage(plans) : null);
		await Promise.all(writes);
	}
}

/** Rebuilds every index page in the bucket, e.g. after changing the templates. */
export async function rebuildAll(bucket: R2Bucket): Promise<void> {
	const affected: Affected = new Map();
	for (const plan of await listPublicPlans(bucket, "")) addAffected(affected, plan);
	// Also clear out pages for folders that no longer have any public plans.
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ cursor });
		for (const { key } of page.objects) {
			const [year, month, day, ...rest] = key.split("/");
			if (rest.length || !YEAR_RE.test(year!) || (month !== undefined && !MONTH_RE.test(month)) || (day !== undefined && !DAY_RE.test(day))) continue;
			const entry = affected.get(year!) ?? { months: new Set(), days: new Set() };
			if (month) entry.months.add(`${year}/${month}`);
			if (day) entry.days.add(`${year}/${month}/${day}`);
			affected.set(year!, entry);
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	await rebuild(bucket, affected);
}

/**
 * The root page, rendered per request because R2 can't serve `/`: an object key can't be empty.
 * Years come from the `YYYY` index objects, which exist only for years with public plans.
 */
export async function rootPage(bucket: R2Bucket): Promise<string> {
	const years: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ delimiter: "/", cursor });
		for (const { key } of page.objects) if (YEAR_RE.test(key)) years.push(key);
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return renderPage(SITE, [], newestFirst(years).map((y) => ({ label: y, href: `/${y}` })));
}

const newestFirst = (values: Iterable<string>) => [...new Set(values)].sort().reverse();

function yearPage(plans: PlanKey[]): string {
	const { year } = plans[0]!;
	const items = newestFirst(plans.map((p) => p.month)).map((m) => ({ label: monthName(m), href: `/${year}/${m}` }));
	return renderPage(year, [ROOT], items);
}

function monthPage(plans: PlanKey[]): string {
	const { year, month } = plans[0]!;
	const items = newestFirst(plans.map((p) => p.day)).map((d) => ({ label: `${Number(d)} ${monthName(month)}`, href: `/${year}/${month}/${d}` }));
	return renderPage(`${monthName(month)} ${year}`, [ROOT, { label: year, href: `/${year}` }], items);
}

function dayPage(plans: PlanKey[]): string {
	const { year, month, day } = plans[0]!;
	const crumbs: Crumb[] = [
		ROOT,
		{ label: year, href: `/${year}` },
		{ label: monthName(month), href: `/${year}/${month}` },
	];
	const items = [...plans]
		.sort((a, b) => b.timestamp - a.timestamp || b.name.localeCompare(a.name))
		.map((p) => ({ label: slugTitle(p.slug), href: `/${p.key}`, time: p.timestamp }));
	return renderPage(`${Number(day)} ${monthName(month)} ${year}`, crumbs, items);
}
