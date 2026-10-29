export type AsyncStatus = "idle" | "loading" | "ready" | "error";

export interface AsyncSnapshot<T> {
	data: T | null;
	status: AsyncStatus;
	/** True while a request is in flight, including a refetch over stale data. */
	loading: boolean;
	error: Error | null;
}

/**
 * One in-flight fetch and its result, observable, with no framework attached.
 * Not a cache. A superseded run is aborted and its late response discarded,
 * so the latest `run()` always wins.
 */
export class AsyncResource<T> {
	private listeners = new Set<() => void>();
	private snapshot: AsyncSnapshot<T>;
	private controller: AbortController | null = null;
	/** The current run; a fetch that already resolved cannot be aborted. */
	private token = 0;

	constructor(initialData: T | null = null) {
		this.snapshot = {
			data: initialData,
			status: initialData === null ? "idle" : "ready",
			loading: false,
			error: null,
		};
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	getSnapshot = (): AsyncSnapshot<T> => this.snapshot;

	/**
	 * Start (or restart) the operation, cancelling whatever was in flight.
	 * Resolves to the result, or null when the run failed or was superseded;
	 * errors go on the snapshot rather than being thrown.
	 */
	async run(operation: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
		this.abort();
		const controller = new AbortController();
		this.controller = controller;
		const token = ++this.token;

		this.patch({ status: "loading", loading: true, error: null });

		try {
			const data = await operation(controller.signal);
			if (token !== this.token) return null;
			this.patch({ data, status: "ready", loading: false, error: null });
			return data;
		} catch (cause) {
			if (token !== this.token || controller.signal.aborted) return null;
			this.patch({
				status: "error",
				loading: false,
				error: cause instanceof Error ? cause : new Error(String(cause)),
			});
			return null;
		} finally {
			if (this.controller === controller) this.controller = null;
		}
	}

	/** Cancel the in-flight run, if any, without changing the last result. */
	abort(): void {
		this.controller?.abort();
		this.controller = null;
		// Invalidate the run so a response already on its way is ignored too.
		this.token += 1;
		if (this.snapshot.loading) this.patch({ loading: false });
	}

	/** Adopt a result fetched elsewhere — a server render passing its data in. */
	hydrate(data: T | null): void {
		this.abort();
		this.patch({
			data,
			status: data === null ? "idle" : "ready",
			loading: false,
			error: null,
		});
	}

	private patch(partial: Partial<AsyncSnapshot<T>>): void {
		this.snapshot = { ...this.snapshot, ...partial };
		for (const listener of this.listeners) listener();
	}
}
