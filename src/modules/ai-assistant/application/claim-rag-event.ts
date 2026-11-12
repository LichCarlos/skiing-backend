import type {
  ConsumedEventIdentity,
  InboxLease,
} from '../../integration-events/application/ports/inbox-lease.js';

export class RagInboxBusyError extends Error {
  constructor() {
    super('RAG inbox event is still processing; delivery must be retried');
    this.name = 'RagInboxBusyError';
  }
}

export async function claimRagEvent(
  inbox: InboxLease,
  identity: ConsumedEventIdentity,
) {
  const claim = await inbox.claim(identity);
  if (claim) return claim;
  if (await inbox.isProcessed(identity)) return null;
  // A live lease is not evidence of a completed effect. Acknowledge only after
  // the owner succeeds, or retry so an abandoned lease can be reclaimed.
  throw new RagInboxBusyError();
}
