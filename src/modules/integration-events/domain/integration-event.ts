export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface IntegrationEvent {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: Date;
  payload: { [key: string]: JsonValue };
}

export interface ClaimedOutboxEvent extends IntegrationEvent {
  attempts: number;
  maxAttempts: number;
  lockToken: string;
}
