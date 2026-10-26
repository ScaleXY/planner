import { describe, expect, it } from "vitest";
import { buildKey, datePrefix, fileName, parseFileName, slugify } from "../src/index";

describe("buildKey", () => {
	it("uses the local date for the folder and unix seconds for the name", () => {
		// TZ is pinned to Asia/Kolkata by the test script: 2026-10-25T18:59:47Z is 00:29 IST on the 26th.
		const now = new Date("2026-10-25T18:59:47Z");
		expect(buildKey(now, "weekly-review", "pub")).toBe("2026/10/26/1792954787-weekly-review-pub");
	});

	it("zero-pads month and day", () => {
		expect(datePrefix(new Date(2026, 0, 5, 12))).toBe("2026/01/05/");
	});

	it("rejects invalid slugs", () => {
		expect(() => fileName(1792954787, "Bad Slug", "pub")).toThrow(/Invalid slug/);
		expect(() => fileName(1792954787, "a--b", "pub")).toThrow(/Invalid slug/);
		expect(() => fileName(1792954787, "", "pri")).toThrow(/Invalid slug/);
	});
});

describe("parseFileName", () => {
	it("round-trips names, including hyphenated and numeric slugs", () => {
		for (const slug of ["x", "weekly-review", "2026-goals", "a-b-pub"]) {
			for (const mode of ["pub", "pri"] as const) {
				expect(parseFileName(fileName(1792954787, slug, mode))).toEqual({ timestamp: 1792954787, slug, mode });
			}
		}
	});

	it("rejects names outside the scheme", () => {
		for (const name of [
			"headroom-crazy-ideas-20261025T175947Z",
			"1792954787-slug",
			"1792954787-slug-public",
			"179295478-slug-pub",
			"1792954787--pub",
			"1792954787-Slug-pub",
		]) {
			expect(parseFileName(name)).toBeNull();
		}
	});
});

describe("slugify", () => {
	it.each([
		["Weekly Review.html", "weekly-review"],
		["  Q4 -- Plan!! ", "q4-plan"],
		["Café déjà vu", "cafe-deja-vu"],
		["notes", "notes"],
		["***", ""],
	])("%s → %s", (input, expected) => {
		expect(slugify(input)).toBe(expected);
	});
});
