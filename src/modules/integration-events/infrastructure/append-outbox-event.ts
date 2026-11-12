import { Prisma } from '@prisma/client';

export async function appendOutboxEvent(
  transaction: Prisma.TransactionClient,
  input: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: Prisma.InputJsonObject;
  },
): Promise<void> {
  await transaction.outboxEvent.create({
    data: {
      EventType: input.eventType,
      AggregateType: input.aggregateType,
      AggregateId: input.aggregateId,
      Payload: input.payload,
    },
  });
}
