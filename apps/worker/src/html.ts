const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const monthName = (mm: string) => MONTHS[Number(mm) - 1] ?? mm;

export function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function slugTitle(slug: string): string {
	return slug
		.split("-")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}

export interface Crumb {
	label: string;
	href: string;
}

export interface Item {
	label: string;
	href: string;
	/** Unix seconds, rendered as a time in the viewer's time zone. */
	time?: number;
}

const STYLE = `
:root{color-scheme:light dark;--fg:#1d1d1f;--muted:#6e6e73;--line:#d2d2d7;--link:#0066cc}
@media (prefers-color-scheme:dark){:root{--fg:#f5f5f7;--muted:#a1a1a6;--line:#38383d;--link:#4da3ff}}
body{font:16px/1.5 system-ui,-apple-system,sans-serif;color:var(--fg);max-width:44rem;margin:3rem auto;padding:0 1.25rem}
nav{color:var(--muted);margin-bottom:1.5rem}nav a{color:inherit}
h1{font-size:1.6rem;margin:0 0 1rem}
ul{list-style:none;padding:0;margin:0}li{display:flex;gap:1rem;align-items:baseline;padding:.6rem 0;border-bottom:1px solid var(--line)}
li a{color:var(--link);text-decoration:none;flex:1}li a:hover{text-decoration:underline}
time{color:var(--muted);font-variant-numeric:tabular-nums}
.empty{color:var(--muted)}`;

// Times are rendered in UTC by the server and rewritten to the viewer's local time in the browser.
const LOCAL_TIME = `<script>for(const t of document.querySelectorAll("time[datetime]"))t.textContent=new Date(t.dateTime).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})</script>`;

function utcTime(ts: number): { iso: string; text: string } {
	const iso = new Date(ts * 1000).toISOString();
	return { iso, text: `${iso.slice(11, 16)} UTC` };
}

export function renderPage(title: string, crumbs: Crumb[], items: Item[], empty: string): string {
	const nav = crumbs.map((c) => `<a href="${escapeHtml(c.href)}">${escapeHtml(c.label)}</a>`).join(" › ");
	const list = items.length
		? `<ul>${items
				.map((i) => {
					const time = i.time === undefined ? "" : (({ iso, text }) => `<time datetime="${iso}">${text}</time>`)(utcTime(i.time));
					return `<li><a href="${escapeHtml(i.href)}">${escapeHtml(i.label)}</a>${time}</li>`;
				})
				.join("")}</ul>`
		: `<p class="empty">${escapeHtml(empty)}</p>`;
	const hasTimes = items.some((i) => i.time !== undefined);
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>${nav ? `<nav>${nav}</nav>` : ""}<h1>${escapeHtml(title)}</h1>${list}${hasTimes ? LOCAL_TIME : ""}</body></html>`;
}
