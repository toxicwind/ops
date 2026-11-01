#!/usr/bin/env bun
/**
 * mcp-registry-audit.ts — THRESHER-ONLY DOCTRINE enforcement.
 *
 * FAILs (exit 1) if any MCP client config contains a server entry other than
 * the thresher mesh gateway:
 *   - ~/.tau/agent/mcp.json        → exactly { "mesh-gateway": {...} }
 *   - ~/.kappa/kappa.jsonc         → mcp block = thresher only
 *
 * New MCP servers register in pens/barn/products/thresher/mcp_config.json.
 * See ~/.tau/agent/mcp.json.lock for the rationale.
 *
 * Usage: bun mcp-registry-audit.ts   (exit 0 = doctrine clean)
 */
import { existsSync, readFileSync } from "node:fs";

let fail = 0;

// tau
const tauP = "/home/toxic/.tau/agent/mcp.json";
if (existsSync(tauP)) {
	try {
		const tau = JSON.parse(readFileSync(tauP, "utf8"));
		const servers = Object.keys(tau.mcpServers ?? {});
		const bad = servers.filter((s) => s !== "gateway");
		if (bad.length > 0) {
			console.error(`FAIL tau mcp.json: non-thresher entries ${bad} (thresher-only doctrine)`);
			fail = 1;
		} else {
			console.log("OK   tau mcp.json: gateway only");
		}
	} catch (e) {
		console.error(`FAIL tau mcp.json parse: ${e.message}`);
		fail = 1;
	}
}

// kappa (jsonc — naive comment strip outside strings)
const kappaP = "/home/toxic/.kappa/kappa.jsonc";
if (existsSync(kappaP)) {
	let kc = readFileSync(kappaP, "utf8");
	let out = "";
	let inStr = false;
	let esc = false;
	for (let i = 0; i < kc.length; i++) {
		const ch = kc[i]!;
		if (inStr) {
			out += ch;
			if (esc) esc = false;
			else if (ch === "\\") esc = true;
			else if (ch === '"') inStr = false;
			continue;
		}
		if (ch === '"') {
			inStr = true;
			out += ch;
			continue;
		}
		if (ch === "/" && kc[i + 1] === "/") {
			while (i < kc.length && kc[i] !== "\n") i++;
			continue;
		}
		if (ch === "/" && kc[i + 1] === "*") {
			i += 2;
			while (i < kc.length && !(kc[i] === "*" && kc[i + 1] === "/")) i++;
			i++;
			continue;
		}
		out += ch;
	}
	out = out.replace(/,\s*([}\]])/g, "$1");
	try {
		const cfg = JSON.parse(out);
		const servers = Object.keys(cfg.mcp ?? {});
		const bad = servers.filter((s) => s !== "gateway");
		if (bad.length > 0) {
			console.error(`FAIL kappa.jsonc: non-thresher entries ${bad} (thresher-only doctrine)`);
			fail = 1;
		} else {
			console.log("OK   kappa.jsonc: gateway only");
		}
	} catch (e) {
		console.error(`FAIL kappa.jsonc parse: ${e.message}`);
		fail = 1;
	}
}

process.exit(fail);
