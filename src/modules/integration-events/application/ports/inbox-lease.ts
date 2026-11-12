export const INBOX_LEASE = Symbol('INBOX_LEASE');

export interface ConsumedEventIdentity {
  consumerKey: string;
  eventId: string;
  eventType: string;
}

export interface InboxClaim {
  readonly lockToken: string;
}

export interface InboxLease {
  isProcessed(identity: ConsumedEventIdentity): Promise<boolean>;
  claim(
    identity: ConsumedEventIdentity,
    leaseMilliseconds?: number,
  ): Promise<InboxClaim | null>;
  complete(
    identity: ConsumedEventIdentity,
    claim: InboxClaim,
  ): Promise<boolean>;
  release(identity: ConsumedEventIdentity, claim: InboxClaim): Promise<boolean>;
}
