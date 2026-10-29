/**
 * Post-build guard: the package's entries must share ONE copy of the SDK.
 *
 * `@quickbutik/kit`, `/sdk`, `/react` and `/elements` are four entry points
 * over the same classes. If the build emits a separate copy per entry (as it
 * does when each entry has its own tsup config), two things break for a
 * consumer and neither shows up in this repo's own tests, which run the source:
 *
 * 1. Types. Classes with private members are nominal, so a `ShopkitClient`
 *    declared in `dist/react/index.d.ts` is a different type from the one in
 *    the root `.d.ts` — and a client from `createShopkitClient()` is not
 *    assignable to `<ShopkitProvider client>` without a cast.
 * 2. Runtime. A client the provider creates throws the React bundle's
 *    `ShopkitApiError`; `instanceof ShopkitApiError` from the root entry is
 *    false, and so `storefrontRefusal()` returns null for it.
 *
 * So this script checks both, as a consumer would see them: it type-checks a
 * small file that imports every entry through `package.json#exports` and
 * assigns across them, and it imports the built ESM entries and compares the
 * classes by identity. It also pins where the `"use client"` directive is:
 * first line of the React ESM entry, and nowhere else.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const KIT = resolve(".");
const problems = [];

// 1. One nominal type per class, across entries

/**
 * Every assignment here must compile. Each line is one direction of one pair,
 * so a failure names exactly which entries disagree.
 */
const CONSUMER = `
import { createShopkitClient, ShopkitApiError, ConsentStore, Analytics, type ShopkitClient } from "@quickbutik/kit";
import { ShopkitClient as SdkClient, ShopkitApiError as SdkApiError } from "@quickbutik/kit/sdk";
import { ShopkitProvider, CartStore as ReactCartStore, useShopkit, useConsent, useAnalytics } from "@quickbutik/kit/react";
import { configure, requireAmbientConsent, type ShopContextValue } from "@quickbutik/kit/elements";
import type { ComponentProps } from "react";

const client = createShopkitClient({ publishableKey: "qb_pk_shop123_abcdef0123456789abcdef0123456789" });

// root <-> react
type ProviderClient = NonNullable<ComponentProps<typeof ShopkitProvider>["client"]>;
const rootToReact: ProviderClient = client;
const reactToRoot: ShopkitClient = null as unknown as ReturnType<typeof useShopkit>;
// /react's CartStore must take a root client (it is typed against the shared ShopkitClient).
const cartStoreOverRootClient = new ReactCartStore(client);

// root <-> sdk
const rootToSdk: SdkClient = client;
const sdkToRoot: ShopkitClient = new SdkClient({ publishableKey: "qb_pk_shop123_abcdef0123456789abcdef0123456789" });
const apiErrorRootToSdk: SdkApiError = new ShopkitApiError("x", 409);
const apiErrorSdkToRoot: ShopkitApiError = new SdkApiError("x", 409);

// root <-> elements
const rootToElements: ShopContextValue["client"] = client;
const elementsToRoot: ShopkitClient = configure({ publishableKey: "qb_pk_shop123_abcdef0123456789abcdef0123456789" }).client;

// consent + analytics: the root classes are what /react and /elements hand out
const consentReactToRoot: ConsentStore = null as unknown as ReturnType<typeof useConsent>["store"];
const analyticsReactToRoot: Analytics = null as unknown as ReturnType<typeof useAnalytics>;
const consentElementsToRoot: ConsentStore = requireAmbientConsent();
const analyticsElementsToRoot: Analytics | null | undefined = configure({ publishableKey: "qb_pk_shop123_abcdef0123456789abcdef0123456789", analytics: true }).analytics;

void rootToReact; void reactToRoot; void cartStoreOverRootClient;
void rootToSdk; void sdkToRoot; void apiErrorRootToSdk; void apiErrorSdkToRoot;
void rootToElements; void elementsToRoot;
void consentReactToRoot; void analyticsReactToRoot; void consentElementsToRoot; void analyticsElementsToRoot;
`;

function checkTypes() {
	const dir = mkdtempSync(join(tmpdir(), "kit-check-entries-"));
	try {
		const file = join(dir, "consumer.tsx");
		writeFileSync(file, CONSUMER);
		const options = {
			strict: true,
			noEmit: true,
			skipLibCheck: true,
			jsx: ts.JsxEmit.ReactJSX,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			target: ts.ScriptTarget.ES2022,
			// Resolve the package the way a consumer's bundler would — through
			// the built `dist/`, never the source — and React from this repo's
			// devDependencies.
			baseUrl: KIT,
			typeRoots: [join(KIT, "node_modules/@types")],
			paths: {
				"@quickbutik/kit": ["dist/index.d.ts"],
				"@quickbutik/kit/sdk": ["dist/sdk/index.d.ts"],
				"@quickbutik/kit/react": ["dist/react/index.d.ts"],
				"@quickbutik/kit/elements": ["dist/elements/index.d.ts"],
				react: ["node_modules/@types/react/index.d.ts"],
				"react/jsx-runtime": ["node_modules/@types/react/jsx-runtime.d.ts"],
			},
		};
		const program = ts.createProgram([file], options);
		const diagnostics = ts.getPreEmitDiagnostics(program);
		for (const diagnostic of diagnostics) {
			const message = ts.flattenDiagnosticMessageText(
				diagnostic.messageText,
				"\n",
			);
			const where = diagnostic.file
				? `${diagnostic.file.fileName.replace(dir, "consumer")}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1}`
				: "consumer";
			problems.push(`types: ${where}: ${message.split("\n")[0]}`);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// 2. One runtime copy per class, across entries

async function checkRuntimeIdentity() {
	// `dist/elements/index.js` declares `class QbElement extends HTMLElement`
	// at module top level, so it cannot be imported where there is no DOM.
	// This check only compares class identities and never defines an element,
	// so a bare stand-in for the base class is all the DOM it needs.
	if (typeof globalThis.HTMLElement === "undefined") {
		globalThis.HTMLElement = class HTMLElement {};
	}
	const load = (path) => import(pathToFileURL(join(KIT, path)).href);
	const [root, sdk, react, elements] = await Promise.all([
		load("dist/index.js"),
		load("dist/sdk/index.js"),
		load("dist/react/index.js"),
		load("dist/elements/index.js"),
	]);
	const same = (name, a, b, entries) => {
		if (a !== b) problems.push(`runtime: ${name} differs between ${entries}`);
	};
	// Only classes an entry actually re-exports can be compared by identity.
	same("ShopkitClient", root.ShopkitClient, sdk.ShopkitClient, "root and /sdk");
	same(
		"ShopkitApiError",
		root.ShopkitApiError,
		sdk.ShopkitApiError,
		"root and /sdk",
	);
	same(
		"storefrontRefusal",
		root.storefrontRefusal,
		sdk.storefrontRefusal,
		"root and /sdk",
	);
	// /react and /elements do not re-export the SDK classes; what matters there
	// is that the clients THEY create are the root's class, so a root
	// `instanceof` (and `storefrontRefusal`) recognises what those clients throw.
	const viaElements = elements.configure({
		publishableKey: "qb_pk_shop123_abcdef0123456789abcdef0123456789",
		// Analytics is on by default and would read the shop's tracking ids
		// from the real commerce API; a build check makes no requests.
		analytics: false,
	}).client;
	if (!(viaElements instanceof root.ShopkitClient)) {
		problems.push(
			"runtime: a client created via /elements is not an instance of the root ShopkitClient",
		);
	}
	const viaReactStore = new react.CartStore(viaElements);
	if (!(viaReactStore.client instanceof root.ShopkitClient)) {
		problems.push(
			"runtime: /react's CartStore does not hold the root ShopkitClient",
		);
	}
	// The consent store the elements create must be the root's class, so a
	// page can hand it to `new Analytics({ consent })` from the root entry.
	if (!(elements.requireAmbientConsent() instanceof root.ConsentStore)) {
		problems.push(
			"runtime: the ambient ConsentStore from /elements is not an instance of the root ConsentStore",
		);
	}
	same(
		"ConsentStore",
		root.ConsentStore,
		react.ConsentStore,
		"root and /react",
	);
	same("Analytics", root.Analytics, react.Analytics, "root and /react");
}

// 3. "use client" exactly where it belongs

function checkDirective() {
	const reactEsm = readFileSync(join(KIT, "dist/react/index.js"), "utf8");
	if (!reactEsm.startsWith('"use client";')) {
		problems.push(
			'directive: dist/react/index.js does not open with "use client"',
		);
	}
	if ((reactEsm.match(/"use client";/g) ?? []).length !== 1) {
		problems.push(
			'directive: dist/react/index.js carries "use client" more than once',
		);
	}
	for (const path of [
		"dist/index.js",
		"dist/sdk/index.js",
		"dist/elements/index.js",
	]) {
		if (readFileSync(join(KIT, path), "utf8").includes('"use client"')) {
			problems.push(
				`directive: ${path} must not carry "use client" (it runs on the server)`,
			);
		}
	}
}

checkTypes();
checkDirective();
await checkRuntimeIdentity();

if (problems.length > 0) {
	console.error("check-entries: the package's entries do not share one SDK.\n");
	for (const problem of problems) console.error(`  ✗ ${problem}`);
	console.error(
		"\nEvery module entry must be built in the single `modules` tsup config — see tsup.config.ts.",
	);
	process.exit(1);
}

console.log(
	"check-entries: one nominal type and one runtime copy of the SDK across " +
		'root, /sdk, /react and /elements; "use client" only on the React entry.',
);
