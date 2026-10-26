import { addAffected, parsePlanKey, rebuild, rebuildAll, type Affected } from "./indexes";

/** R2 event notification, plus `{ "rebuild": "all" }` sent by hand to regenerate every page. */
export type QueueMessage =
	| { action: string; bucket: string; object: { key: string }; eventTime: string }
	| { rebuild: "all" };

export default {
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
