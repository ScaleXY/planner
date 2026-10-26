// Sends { "rebuild": "all" } to the planner-r2-events queue, so the Worker regenerates every index page
// from the bucket contents (e.g. after a template change). Uses wrangler's current login.
import { execFileSync } from "node:child_process";

const ACCOUNT = "98f0ecdd86a00f1677266b31bd313769";
const QUEUE = "planner-r2-events";
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/queues`;

const { token } = JSON.parse(execFileSync("wrangler", ["auth", "token", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const queues = await (await fetch(`${API}?name=${QUEUE}`, { headers })).json();
const queue = queues.result?.find((q) => q.queue_name === QUEUE);
if (!queue) throw new Error(`Queue ${QUEUE} not found: ${JSON.stringify(queues.errors)}`);

const sent = await (await fetch(`${API}/${queue.queue_id}/messages`, { method: "POST", headers, body: JSON.stringify({ body: { rebuild: "all" }, content_type: "json" }) })).json();
if (!sent.success) throw new Error(`Sending failed: ${JSON.stringify(sent.errors)}`);
console.log(`Queued a full rebuild on ${QUEUE}.`);
