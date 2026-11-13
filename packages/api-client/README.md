# Shared API client and synchronization coordinator

`index.js` provides an authenticated request client. `sync.js` provides a single-flight synchronization coordinator built on the pure queue state machine in `src/sync-queue.js`.

## Contract

The coordinator requires:
- `repository.read()`: returns all queue events.
- `repository.write(queue)`: durably replaces the queue; **must be transactional** in production.
- `api.submitScan(event)`: returns `{status:'accepted'}` or `{status:'already_accepted'}` only after server acknowledgement.
- Optional `clock()` and `onState(change)` callbacks.

It preserves client-generated event IDs, retries transient errors with backoff, isolates validation conflicts, pauses on authentication failure, and rejects overlapping sync calls in a single coordinator instance.

## Important limitations

The coordinator is **not currently wired into any UI**. No SQLite repository, secure token storage, real user authentication, or cross-process locking exists. Single-flight protection is only per coordinator instance. For mobile and Windows, implement a transactional local database and device-level lock before claiming reliable offline delivery.

The existing Worker uses a shared development token and must not be exposed to distributed clients. Never store that token in browser JavaScript or a native binary.
