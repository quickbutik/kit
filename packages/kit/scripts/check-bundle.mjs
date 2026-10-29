/**
 * Post-build guard: the published package must be self-contained — no import
 * of anything but `react`, an optional peer dependency, at runtime or in its
 * types, and no runtime dependencies. A storefront installs `@quickbutik/kit`
 * and nothing else, so a stray import would fail to resolve for every user;
 * a new dependency or a public type leaking one in is caught here, on every
 * build.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const DIST = "dist";

/**
 * What the script-tag build may weigh, gzipped — the number a shopper's browser
 * actually downloads before anything on the page can render.
 *
 * Only this artefact is budgeted. It is the one a merchant drops onto a page as
 * a single `<script src>`, with no bundler, no tree shaking and no code
 * splitting to save them: everything in `src/global.ts`'s import graph ships,
 * whether the page uses it or not. The npm entries are budgeted by the
 * consumer's own bundler.
 *
 * The ceiling is the real measurement plus about 10 % headroom, so an ordinary
 * change passes and a surprise does not. Raise it deliberately, in the same
 * commit as the growth that needs it, and say in the changelog what was added.
 */
const SIZE_BUDGETS = [
	{ file: "dist/quickbutik-kit.global.js", maxGzipBytes: 57_000 },
];
const ALLOWED_EXTERNALS = new Set(["react", "react/jsx-runtime", "react-dom"]);

/**
 * Strip comments before scanning.
 *
 * Not cosmetic: rollup-plugin-dts keeps JSDoc in the emitted types, and this
 * package's docs contain `import { cookies } from "next/headers"` in an
 * `@example` fence. A guard that flags documentation is a guard people learn to
 * ignore, so comments are removed with a small state machine rather than a
 * regex — strings and template literals have to be respected or a `//` inside a
 * URL would swallow the rest of a line.
 */
function stripComments(source) {
	let out = "";
	let i = 0;
	const n = source.length;
	while (i < n) {
		const ch = source[i];
		const next = source[i + 1];
		if (ch === "/" && next === "/") {
			while (i < n && source[i] !== "\n") i++;
			continue;
		}
		if (ch === "/" && next === "*") {
			i += 2;
			while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
			i += 2;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			const quote = ch;
			out += ch;
			i++;
			while (i < n) {
				if (source[i] === "\\") {
					out += source[i] + (source[i + 1] ?? "");
					i += 2;
					continue;
				}
				out += source[i];
				if (source[i] === quote) {
					i++;
					break;
				}
				i++;
			}
			continue;
		}
		out += ch;
		i++;
	}
	return out;
}

/** `from "x"`, `require("x")`, `import("x")` — the ways a spec can appear. */
const SPECIFIER_PATTERNS = [
	/\bfrom\s*["']([^"']+)["']/g,
	/\brequire\(\s*["']([^"']+)["']\s*\)/g,
	/\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

function walk(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else out.push(full);
	}
	return out;
}

let files;
try {
	files = walk(DIST).filter((f) => /\.(js|cjs|mjs|d\.ts|d\.cts)$/.test(f));
} catch {
	console.error(`check-bundle: no ${DIST}/ directory — run the build first.`);
	process.exit(1);
}

if (files.length === 0) {
	console.error(`check-bundle: ${DIST}/ contains no build output.`);
	process.exit(1);
}

const problems = [];

for (const file of files) {
	const source = stripComments(readFileSync(file, "utf8"));
	for (const pattern of SPECIFIER_PATTERNS) {
		for (const [, specifier] of source.matchAll(pattern)) {
			// Relative imports stay inside the bundle.
			if (specifier.startsWith(".") || specifier.startsWith("/")) continue;
			if (ALLOWED_EXTERNALS.has(specifier)) continue;
			if (specifier.startsWith("node:")) continue;
			problems.push(`${file}: imports "${specifier}"`);
		}
	}
}

// Belt and braces: the package must declare no runtime dependencies at all, so
// nothing can be resolved from the registry even in principle.
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
for (const name of Object.keys(pkg.dependencies ?? {})) {
	problems.push(`package.json: declares runtime dependency "${name}"`);
}

for (const { file, maxGzipBytes } of SIZE_BUDGETS) {
	let raw;
	try {
		raw = readFileSync(file);
	} catch {
		problems.push(`${file}: missing — the build did not produce it`);
		continue;
	}
	const gzipped = gzipSync(raw).length;
	const percent = Math.round((gzipped / maxGzipBytes) * 100);
	if (gzipped > maxGzipBytes) {
		problems.push(
			`${file}: ${kb(gzipped)} gzipped, over the ${kb(maxGzipBytes)} budget`,
		);
	} else {
		console.log(
			`check-bundle: ${file} is ${kb(gzipped)} gzipped ` +
				`(${kb(raw.length)} raw), ${percent}% of its ${kb(maxGzipBytes)} budget.`,
		);
	}
}

function kb(bytes) {
	return `${(bytes / 1024).toFixed(1)} KB`;
}

if (problems.length > 0) {
	console.error("check-bundle: the published package is not self-contained.\n");
	for (const problem of new Set(problems)) console.error(`  ✗ ${problem}`);
	console.error(
		"\nThe kit must not import anything but its optional `react` peer, and " +
			"the script-tag build must stay inside its size budget; both are " +
			"explained at the top of this file.",
	);
	process.exit(1);
}

console.log(
	`check-bundle: ${files.length} built files are self-contained ` +
		"(no external imports, no runtime dependencies).",
);
