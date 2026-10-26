export type Mode = "pub" | "pri";

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const YEAR_RE = /^\d{4}$/;
export const MONTH_RE = /^(0[1-9]|1[0-2])$/;
export const DAY_RE = /^(0[1-9]|[12]\d|3[01])$/;
// <unix seconds>-<slug>-<mode>. The timestamp is fixed-width and the mode is anchored at the end,
// so slugs may contain hyphens and start with digits.
export const FILE_RE = /^(\d{10})-([a-z0-9]+(?:-[a-z0-9]+)*)-(pub|pri)$/;

export interface ParsedFile {
	timestamp: number;
	slug: string;
	mode: Mode;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Folder prefix (`YYYY/MM/DD/`) for the local calendar date of `now`, in the system time zone. */
export function datePrefix(now: Date): string {
	return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}/`;
}

export function fileName(timestamp: number, slug: string, mode: Mode): string {
	if (!SLUG_RE.test(slug)) throw new Error(`Invalid slug "${slug}": use lowercase letters, digits and single hyphens`);
	const ts = String(timestamp);
	if (!/^\d{10}$/.test(ts)) throw new Error(`Timestamp ${timestamp} is not 10-digit unix seconds`);
	return `${ts}-${slug}-${mode}`;
}

/** Object key for an upload made at `now`, e.g. `2026/10/26/1792990800-weekly-review-pub`. */
export function buildKey(now: Date, slug: string, mode: Mode): string {
	return datePrefix(now) + fileName(Math.floor(now.getTime() / 1000), slug, mode);
}

export function parseFileName(name: string): ParsedFile | null {
	const m = FILE_RE.exec(name);
	if (!m) return null;
	return { timestamp: Number(m[1]), slug: m[2]!, mode: m[3] as Mode };
}

/** Derives a slug from free text or a file name: `"Weekly Review.html"` → `"weekly-review"`. */
export function slugify(input: string): string {
	return input
		.replace(/\.[a-z0-9]+$/i, "")
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}
