import { DAY_RE, MONTH_RE, YEAR_RE, parseFileName } from "@planner/core";
import { monthName, renderPage, slugTitle, type Crumb } from "./html";
import { listDay, listFolders } from "./listing";

const SITE = "Plans";
const SEGMENT_RE = [YEAR_RE, MONTH_RE, DAY_RE];
const LISTING_CACHE = "public, max-age=60";

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		const segments = url.pathname.split("/").filter(Boolean);

		// Index pages are `/`, `/YYYY`, `/YYYY/MM` and `/YYYY/MM/DD`. Anything with up to three
		// all-digit segments is treated as one, so `/2026/13` is a 404 here rather than an R2 lookup.
		if (segments.length <= 3 && segments.every((s) => /^\d+$/.test(s))) {
			if (request.method !== "GET" && request.method !== "HEAD") {
				return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
			}
			if (url.pathname !== "/" && url.pathname.endsWith("/")) {
				return Response.redirect(new URL(`/${segments.join("/")}${url.search}`, url).toString(), 301);
			}
			if (!segments.every((s, i) => SEGMENT_RE[i]!.test(s))) return notFound();
			const html = await renderIndex(env.PLANS, segments);
			if (html === null) return notFound();
			return new Response(request.method === "HEAD" ? null : html, {
				headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": LISTING_CACHE },
			});
		}

		const key = decodeURIComponent(url.pathname.slice(1));
		const isPrivate = parseFileName(key.split("/").pop() ?? "")?.mode === "pri";
		const response = env.SERVE_FROM_BINDING === "true" ? await serveFromBucket(env.PLANS, key, request) : await fetch(request);
		if (!isPrivate) return response;
		const unlisted = new Response(response.body, response);
		unlisted.headers.set("X-Robots-Tag", "noindex");
		return unlisted;
	},
} satisfies ExportedHandler<Env>;

/** Returns the page for an index path, or null when nothing has been uploaded under it. */
async function renderIndex(bucket: R2Bucket, segments: string[]): Promise<string | null> {
	const [year, month, day] = segments;
	const prefix = segments.map((s) => `${s}/`).join("");
	const crumbs: Crumb[] = [{ label: SITE, href: "/" }];
	if (year) crumbs.push({ label: year, href: `/${year}` });
	if (month) crumbs.push({ label: monthName(month), href: `/${year}/${month}` });

	if (day) {
		const { exists, plans } = await listDay(bucket, prefix);
		if (!exists) return null;
		const items = plans.map((p) => ({ label: slugTitle(p.slug), href: `/${prefix}${p.name}`, time: p.timestamp }));
		return renderPage(`${Number(day)} ${monthName(month!)} ${year}`, crumbs, items, "No public plans.");
	}

	const folders = await listFolders(bucket, prefix);
	if (year && folders.length === 0) return null;
	const items = folders.map((f) => ({ label: month ? `${Number(f)} ${monthName(month)}` : year ? monthName(f) : f, href: `/${prefix}${f}` }));
	const title = month ? `${monthName(month)} ${year}` : (year ?? SITE);
	return renderPage(title, crumbs.slice(0, -1), items, "Nothing uploaded yet.");
}

/** Fallback for when passing file requests through to the R2 custom domain doesn't work. */
async function serveFromBucket(bucket: R2Bucket, key: string, request: Request): Promise<Response> {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
	}
	const object = await bucket.get(key, { onlyIf: request.headers, range: request.headers });
	if (!object) return notFound();

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("ETag", object.httpEtag);
	headers.set("Accept-Ranges", "bytes");
	if (!headers.has("Content-Type")) headers.set("Content-Type", "text/html; charset=utf-8");

	if (!("body" in object)) {
		const conditional = request.headers.has("If-None-Match") || request.headers.has("If-Modified-Since");
		return new Response(null, { status: conditional ? 304 : 412, headers });
	}
	const range = object.range as { offset: number; length: number } | undefined;
	if (range && request.headers.has("Range")) {
		headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
		return new Response(request.method === "HEAD" ? null : object.body, { status: 206, headers });
	}
	return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

function notFound(): Response {
	return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
