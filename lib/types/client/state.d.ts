/**
 * One shared read of the host state, for everything that draws from it.
 *
 * Two surfaces need this state and they are mounted independently: the panel,
 * which is only present while its own main column is selected, and the receive
 * notification, which has to fire wherever the user happens to be. Giving each
 * its own polling loop would mean two requests per tick to read one document,
 * and two answers that could momentarily disagree about whether an offer is
 * still waiting.
 *
 * So there is one loop, and it runs only while something is watching. That is
 * what {@link TransferStore.retain} is for: the notification retains for as long
 * as it is mounted, the panel retains while it is open, and a deployment where
 * neither exists reads nothing at all.
 *
 * The cadence follows the answer, not a fixed period. A device with no peers and
 * no transfers is a still picture and is re-read on a slow tick; a transfer in
 * flight is re-read fast enough that its progress bar moves smoothly; and a
 * hidden tab is re-read slowly enough to be impolite to nobody.
 *
 * @module dsh-local-send/client/state
 */
import type { LocalSendState } from '../types.ts';
/** What a reader sees: the last good state, or why there is none. */
export type ClientState = {
    readonly status: 'loading';
} | {
    readonly status: 'ready';
    readonly state: LocalSendState;
} | {
    readonly status: 'error';
    readonly message: string;
};
/** The store both surfaces read through. */
export interface TransferStore {
    /** Subscribe to changes, for `useSyncExternalStore`. */
    subscribe(listener: () => void): () => void;
    /** Read the current snapshot; the object identity is stable between changes. */
    getSnapshot(): ClientState;
    /**
     * Keep the loop running until the returned function is called.
     *
     * Reference-counted: the loop starts when the first holder arrives and stops
     * when the last one leaves, so an unloaded plugin and a closed panel both cost
     * nothing. The first holder also triggers an immediate read, so a surface that
     * mounts does not wait a full interval for its first paint.
     *
     * @returns the release function.
     */
    retain(): () => void;
    /** Read once, now. Used after an action so its effect is on screen at once. */
    refresh(): Promise<void>;
}
/**
 * Build the store over one reader.
 *
 * @param read - performs the actual host request.
 * @returns the store.
 */
export declare function createTransferStore(read: () => Promise<LocalSendState>): TransferStore;
/**
 * Read the store as React state.
 * @param store - the shared store.
 * @returns the current snapshot, re-rendering on every change.
 */
export declare function useTransferState(store: TransferStore): ClientState;
