import { describe, expect, it } from "vitest";
import { escapeHtml, renderPage, slugTitle } from "../src/html";

describe("html", () => {
	it("escapes markup", () => {
		expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&#60;a href=&#34;x&#34;&#62;&#39;&#38;&#39;&#60;/a&#62;");
		const html = renderPage("<t>", [{ label: "<c>", href: "/\"x" }], [{ label: "<i>", href: "/<i>" }], "");
		expect(html).not.toMatch(/<(t|c|i)>/);
	});

	it("titles slugs", () => {
		expect(slugTitle("weekly-review")).toBe("Weekly Review");
		expect(slugTitle("2026-goals")).toBe("2026 Goals");
	});
});
