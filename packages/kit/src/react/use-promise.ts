// Namespace import on purpose: `use` does not exist on React 18, and a named
// import of a missing export would break this whole entry point there.
import * as React from "react";

type UseHook = <T>(promise: Promise<T> | React.Context<T>) => T;

/**
 * React 19's `use()`, with a clear error on React 18. Like `use`, it may be
 * called conditionally.
 */
export function usePromise<T>(promise: Promise<T>): T {
	const use = (React as unknown as { use?: UseHook }).use;
	if (typeof use !== "function") {
		throw new Error(
			"shopkit: resolving a product from `slug`/`id` (or a promise) needs " +
				"React 19's `use()`, which this React does not have. On React 18, " +
				"fetch the product yourself and pass the resolved object as `product`.",
		);
	}
	return use(promise);
}
