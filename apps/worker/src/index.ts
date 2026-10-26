import { addAffected, parsePlanKey, rebuild, rebuildAll, rootPage, type Affected } from "./indexes";

/** R2 event notification, plus `{ "rebuild": "all" }` sent by hand to regenerate every page. */
export type QueueMessage =
	| { action: string; bucket: string; object: { key: string }; eventTime: string }
	| { rebuild: "all" };

export default {
	// Only `/` is routed here (exact-path route, see wrangler.jsonc). Everything else is served by R2.
	async fetch(request, env): Promise<Response> {
		if (new URL(request.url).pathname !== "/") return new Response("Not Found", { status: 404 });
		if (request.method !== "GET" && request.method !== "HEAD") {
			return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
		}
		const html = await rootPage(env.PLANS);
		return new Response(request.method === "HEAD" ? null : html, {
			headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" },
		});
	},

	// Events arrive for `-pub` objects only (see the notification rules in plans/06). Pages are rebuilt
	// from a fresh listing, so a batch only needs to know which pages it touched, not what changed.
	async queue(batch, env): Promise<void> {
		if (batch.messages.some((m) => "rebuild" in m.body && m.body.rebuild === "all")) {
			await rebuildAll(env.PLANS);
		} else {
			const affected: Affected = new Map();
			for (const { body } of batch.messages) {
				const plan = "object" in body ? parsePlanKey(body.object.key) : null;
				if (plan) addAffected(affected, plan);
			}
			await rebuild(env.PLANS, affected);
		}
		batch.ackAll();
	},
} satisfies ExportedHandler<Env, QueueMessage>;
