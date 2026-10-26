import { createExecutionContext, createMessageBatch, env, getQueueResult } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker, { type QueueMessage } from "../src/index";

const HTML = { httpMetadata: { contentType: "text/html; charset=utf-8" } };

async function send(...bodies: QueueMessage[]) {
	const batch = createMessageBatch<QueueMessage>(
		"planner-r2-events",
		bodies.map((body, i) => ({ id: String(i), timestamp: new Date(), attempts: 1, body })),
	);
	await worker.queue(batch, env);
	return getQueueResult(batch, createExecutionContext());
}

const put = (key: string) => ({ action: "PutObject", bucket: "plans", object: { key }, eventTime: "" });
const del = (key: string) => ({ action: "DeleteObject", bucket: "plans", object: { key }, eventTime: "" });

async function upload(key: string) {
	await env.PLANS.put(key, `<p>${key}</p>`, HTML);
	return put(key);
}

async function page(key: string) {
	const object = await env.PLANS.get(key);
	return object && { html: await object.text(), contentType: object.httpMetadata?.contentType, cache: object.httpMetadata?.cacheControl };
}

async function keys() {
	return (await env.PLANS.list()).objects.map((o) => o.key).sort();
}

beforeEach(async () => {
	for (let page = await env.PLANS.list(); page.objects.length; page = await env.PLANS.list()) {
		await env.PLANS.delete(page.objects.map((o) => o.key));
	}
});

describe("index pages", () => {
	it("writes year, month and day pages as HTML objects", async () => {
		const result = await send(await upload("2026/10/26/1792990800-weekly-review-pub"));
		expect(result.ackAll).toBe(true);
		expect(await keys()).toEqual(["2026", "2026/10", "2026/10/26", "2026/10/26/1792990800-weekly-review-pub"]);

		const day = await page("2026/10/26");
		expect(day).toMatchObject({ contentType: "text/html; charset=utf-8", cache: "public, max-age=60" });
		expect(day!.html).toContain(`<title>26 October 2026</title>`);
		expect(day!.html).toContain(`<nav><a href="/">Plans</a> › <a href="/2026">2026</a> › <a href="/2026/10">October</a></nav>`);
		expect(day!.html).toContain(`<a href="/2026/10/26/1792990800-weekly-review-pub">Weekly Review</a><time datetime="2026-10-26T05:00:00.000Z">05:00 UTC</time>`);
		expect((await page("2026/10"))!.html).toContain(`<a href="/2026/10/26">26 October</a>`);
		expect((await page("2026"))!.html).toContain(`<a href="/2026/10">October</a>`);
	});

	it("lists newest first and only public plans", async () => {
		await upload("2026/10/26/1792990800-weekly-review-pub");
		await upload("2026/10/26/1792995000-secret-plan-pri");
		await upload("2026/10/25/1792951187-headroom-crazy-ideas-pub");
		await upload("2026/09/01/1788200000-september-pub");
		await send(await upload("2026/10/26/1793000000-later-plan-pub"), put("2026/09/01/1788200000-september-pub"));

		const day = (await page("2026/10/26"))!.html;
		expect(day).toMatch(/Later Plan<.*Weekly Review</s);
		expect(day).not.toContain("secret");
		expect((await page("2026/10"))!.html).toMatch(/2026\/10\/26.*2026\/10\/25/s);
		expect((await page("2026"))!.html).toMatch(/October<.*September</s);
		expect(await page("2026/09")).not.toBeNull();
	});

	it("gives days with only private plans no page", async () => {
		await upload("2026/10/27/1793080000-only-private-pri");
		await send(await upload("2026/10/26/1792990800-weekly-review-pub"), put("2026/10/27/1793080000-only-private-pri"));
		expect(await page("2026/10/27")).toBeNull();
		expect((await page("2026/10"))!.html).not.toContain("27 October");
	});

	it("updates and removes pages when plans are deleted", async () => {
		await upload("2026/10/26/1792990800-weekly-review-pub");
		await send(await upload("2025/12/31/1767180000-year-end-pub"), put("2026/10/26/1792990800-weekly-review-pub"));

		await env.PLANS.delete("2026/10/26/1792990800-weekly-review-pub");
		await send(del("2026/10/26/1792990800-weekly-review-pub"));
		expect(await keys()).toEqual(["2025", "2025/12", "2025/12/31", "2025/12/31/1767180000-year-end-pub"]);
	});

	it("escapes slugs and ignores keys outside the scheme", async () => {
		await send(await upload("2026/10/26/1792990800-a-b-pub"), put("2026/10/26/not-a-plan"), put("2026/10/26"), put("readme-pub"));
		expect(await keys()).toEqual(["2026", "2026/10", "2026/10/26", "2026/10/26/1792990800-a-b-pub"]);
	});

	it("pages through more than 1000 plans", async () => {
		await Promise.all(Array.from({ length: 1005 }, (_, i) => env.PLANS.put(`2024/01/01/${1704067200 + i}-bulk-${i}-pub`, "x", HTML)));
		await send(put("2024/01/01/1704067200-bulk-0-pub"));
		const html = (await page("2024/01/01"))!.html;
		expect(html.match(/<li>/g)).toHaveLength(1005);
		expect(html.indexOf("Bulk 1004")).toBeLessThan(html.indexOf("Bulk 0<"));
	});

	it("rebuilds everything on request, including stale pages", async () => {
		await upload("2026/10/26/1792990800-weekly-review-pub");
		await env.PLANS.put("2023/05/05", "stale", HTML);
		await env.PLANS.put("2023/05", "stale", HTML);
		await env.PLANS.put("2023", "stale", HTML);
		await send({ rebuild: "all" });
		expect(await keys()).toEqual(["2026", "2026/10", "2026/10/26", "2026/10/26/1792990800-weekly-review-pub"]);
	});
});

describe("root page", () => {
	const get = (path: string, init?: RequestInit) =>
		worker.fetch(new Request(`https://plans.athul.dev${path}`, init) as Request<unknown, IncomingRequestCfProperties>, env);

	it("lists the years that have index pages, newest first", async () => {
		await send(await upload("2026/10/26/1792990800-weekly-review-pub"), await upload("2025/12/31/1767180000-year-end-pub"));
		await upload("2024/01/01/1704067200-private-only-pri");
		const res = await get("/");
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
		const html = await res.text();
		expect(html).toMatch(/<title>Plans<\/title>.*href="\/2026">2026<.*href="\/2025">2025</s);
		expect(html).not.toContain("2024");
		expect(html).not.toContain("<nav>");
	});

	it("links generated pages back to the root", async () => {
		await send(await upload("2026/10/26/1792990800-weekly-review-pub"));
		expect((await page("2026"))!.html).toContain(`<nav><a href="/">Plans</a></nav>`);
		expect((await page("2026/10/26"))!.html).toContain(`<nav><a href="/">Plans</a> › <a href="/2026">2026</a> › <a href="/2026/10">October</a></nav>`);
	});

	it("answers HEAD without a body, rejects other methods and paths", async () => {
		const head = await get("/", { method: "HEAD" });
		expect(head.status).toBe(200);
		expect(await head.text()).toBe("");
		expect((await get("/", { method: "POST" })).status).toBe(405);
		expect((await get("/2026")).status).toBe(404);
	});
});
