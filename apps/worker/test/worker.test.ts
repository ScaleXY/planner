import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index";

const HTML = { httpMetadata: { contentType: "text/html; charset=utf-8" } };

async function get(path: string, init?: RequestInit) {
	const request = new Request(`https://plans.athul.dev${path}`, init) as Request<unknown, IncomingRequestCfProperties>;
	return worker.fetch(request, env);
}

beforeAll(async () => {
	const keys = [
		"2025/12/31/1767180000-year-end-pub",
		"2026/09/01/1788200000-september-pub",
		"2026/10/25/1792951187-headroom-crazy-ideas-pub",
		"2026/10/26/1792990800-weekly-review-pub",
		"2026/10/26/1793000000-later-plan-pub",
		"2026/10/26/1792995000-secret-plan-pri",
		"2026/10/27/1793080000-only-private-pri",
		"2026/10/26/not-in-the-scheme",
		"2026/xx/01/1792990800-bad-month-pub",
		"headroom-crazy-ideas-20261025T175947Z",
		"2026/10/28/1793160000-tomorrow-pub",
	];
	await Promise.all(keys.map((k) => env.PLANS.put(k, `<p>${k}</p>`, HTML)));
});

describe("index pages", () => {
	it("lists years, newest first, ignoring keys outside the scheme", async () => {
		const res = await get("/");
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
		const html = await res.text();
		expect(html).toMatch(/href="\/2026">2026<.*href="\/2025">2025</s);
		expect(html).not.toContain("headroom-crazy-ideas-20261025T175947Z");
	});

	it("lists months with names", async () => {
		const html = await (await get("/2026")).text();
		expect(html).toMatch(/href="\/2026\/10">October<.*href="\/2026\/09">September</s);
		expect(html).not.toContain("xx");
	});

	it("lists days, including days with only private plans", async () => {
		const html = await (await get("/2026/10")).text();
		expect(html).toMatch(/\/2026\/10\/28.*\/2026\/10\/27.*\/2026\/10\/26.*\/2026\/10\/25/s);
		expect(html).toContain(`<nav><a href="/">Plans</a> › <a href="/2026">2026</a></nav>`);
	});

	it("lists only public plans for a day, newest first, with times", async () => {
		const html = await (await get("/2026/10/26")).text();
		expect(html).toMatch(/1793000000-later-plan-pub">Later Plan<.*1792990800-weekly-review-pub">Weekly Review</s);
		expect(html).toContain(`<time datetime="2026-10-26T05:00:00.000Z">05:00 UTC</time>`);
		expect(html).not.toContain("secret-plan");
		expect(html).not.toContain("not-in-the-scheme");
	});

	it("shows an empty state for a day with only private plans", async () => {
		const res = await get("/2026/10/27");
		expect(res.status).toBe(200);
		expect(await res.text()).toContain("No public plans.");
	});

	it("404s for invalid or empty index paths", async () => {
		for (const path of ["/2026/13", "/2026/10/32", "/26", "/2031", "/2026/11", "/2026/10/29"]) {
			expect((await get(path)).status, path).toBe(404);
		}
	});

	it("redirects trailing slashes", async () => {
		const res = await get("/2026/10/");
		expect(res.status).toBe(301);
		expect(res.headers.get("Location")).toBe("https://plans.athul.dev/2026/10");
	});

	it("rejects other methods", async () => {
		expect((await get("/2026", { method: "POST" })).status).toBe(405);
	});

	it("answers HEAD without a body", async () => {
		const res = await get("/2026", { method: "HEAD" });
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("");
	});

	it("pages through more than 1000 objects in a day", async () => {
		await Promise.all(
			Array.from({ length: 1005 }, (_, i) => env.PLANS.put(`2024/01/01/${1704067200 + i}-bulk-${i}-pub`, "x", HTML)),
		);
		const html = await (await get("/2024/01/01")).text();
		expect(html.match(/<li>/g)).toHaveLength(1005);
		expect(html.indexOf("Bulk 1004")).toBeLessThan(html.indexOf("Bulk 0<"));
	});
});

describe("files", () => {
	const path = "/2026/10/26/1792990800-weekly-review-pub";

	it("serves the object with its content type, ETag and cache headers", async () => {
		const res = await get(path);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
		expect(res.headers.get("ETag")).toMatch(/^"/);
		expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
		expect(res.headers.has("X-Robots-Tag")).toBe(false);
		expect(await res.text()).toBe("<p>2026/10/26/1792990800-weekly-review-pub</p>");
	});

	it("serves private plans by URL, marked noindex", async () => {
		const res = await get("/2026/10/26/1792995000-secret-plan-pri");
		expect(res.status).toBe(200);
		expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
	});

	it("returns 304 for a matching If-None-Match", async () => {
		const etag = (await get(path)).headers.get("ETag")!;
		expect((await get(path, { headers: { "If-None-Match": etag } })).status).toBe(304);
	});

	it("supports ranges", async () => {
		const res = await get(path, { headers: { Range: "bytes=0-2" } });
		expect(res.status).toBe(206);
		expect(res.headers.get("Content-Range")).toMatch(/^bytes 0-2\/\d+$/);
		expect(await res.text()).toBe("<p>");
	});

	it("answers HEAD without a body", async () => {
		const res = await get(path, { method: "HEAD" });
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("");
	});

	it("404s for missing objects and junk paths", async () => {
		for (const p of ["/2026/10/26/1792990801-missing-pub", "/favicon.ico", "/%E0%A4%A"]) {
			expect((await get(p)).status, p).toBe(404);
		}
	});

	it("rejects other methods", async () => {
		expect((await get(path, { method: "PUT", body: "x" })).status).toBe(405);
	});
});
