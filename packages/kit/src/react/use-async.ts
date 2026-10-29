"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
	data: T | null;
	loading: boolean;
	error: Error | null;
	/** Re-run the fetch. Stable identity, safe as an effect dependency. */
	refetch: () => void;
}

/**
 * Minimal fetch-on-mount hook. Not a cache: with TanStack Query or SWR, call
 * the client directly instead.
 *
 * The fetch is aborted on unmount and on every re-run, and a result from a
 * superseded run is discarded, so a fast-changing dependency (a search box)
 * cannot land an out-of-order result.
 */
export function useAsync<T>(
	operation: (signal: AbortSignal) => Promise<T>,
	deps: readonly unknown[],
	options: { enabled?: boolean; initialData?: T | null } = {},
): AsyncState<T> {
	const enabled = options.enabled ?? true;
	const [data, setData] = useState<T | null>(options.initialData ?? null);
	const [loading, setLoading] = useState(
		enabled && options.initialData == null,
	);
	const [error, setError] = useState<Error | null>(null);
	const [nonce, setNonce] = useState(0);

	// Latest-ref so an inline arrow does not re-trigger the effect every render.
	const operationRef = useRef(operation);
	operationRef.current = operation;

	// biome-ignore lint/correctness/useExhaustiveDependencies: `deps` is the caller's declared dependency list — spreading it is the contract, and `nonce` is the refetch trigger.
	useEffect(() => {
		if (!enabled) {
			setLoading(false);
			return;
		}
		const controller = new AbortController();
		let active = true;
		setLoading(true);
		setError(null);

		operationRef
			.current(controller.signal)
			.then((result) => {
				if (!active) return;
				setData(result);
				setLoading(false);
			})
			.catch((cause: unknown) => {
				if (!active || controller.signal.aborted) return;
				setError(cause instanceof Error ? cause : new Error(String(cause)));
				setLoading(false);
			});

		return () => {
			active = false;
			controller.abort();
		};
	}, [enabled, nonce, ...deps]);

	const refetch = useCallback(() => {
		setNonce((n) => n + 1);
	}, []);

	return { data, loading, error, refetch };
}
