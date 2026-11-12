import { Injectable, type BeforeApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, type Producer } from 'kafkajs';
import type { EventPublisher } from '../application/ports/event-publisher.js';
import type { IntegrationEvent } from '../domain/integration-event.js';
import { kafkaClientConfig } from './kafka-client-config.js';

@Injectable()
export class KafkaEventPublisher
  implements EventPublisher, BeforeApplicationShutdown
{
  private readonly producer: Producer;
  private readonly topic: string;
  private connecting?: Promise<void>;
  private connected = false;

  constructor(config: ConfigService) {
    const kafka = new Kafka(kafkaClientConfig(config));
    this.producer = kafka.producer();
    this.topic =
      config.get<string>('KAFKA_EVENTS_TOPIC') ?? 'linji.integration-events';
  }

  async publish(event: IntegrationEvent): Promise<void> {
    await this.ensureConnected();
    await this.producer.send({
      topic: this.topic,
      messages: [
        {
          key: event.aggregateId,
          value: JSON.stringify({
            eventId: event.eventId,
            eventType: event.eventType,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            occurredAt: event.occurredAt.toISOString(),
            payload: event.payload,
          }),
          headers: {
            eventId: event.eventId,
            eventType: event.eventType,
          },
        },
      ],
    });
  }

  // All onModuleDestroy workers must finish before their shared producer closes.
  async beforeApplicationShutdown(): Promise<void> {
    if (!this.connected) return;
    await this.producer.disconnect();
    this.connected = false;
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    this.connecting ??= this.producer.connect();
    try {
      await this.connecting;
      this.connected = true;
    } catch (error) {
      this.connecting = undefined;
      throw error;
    }
  }
}
