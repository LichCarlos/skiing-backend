import { RagDependencyEventHandler } from './rag-dependency-event-handler.js';
import { Optional } from '@nestjs/common';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, type Consumer } from 'kafkajs';
import type {
  IntegrationEvent,
  JsonValue,
} from '../domain/integration-event.js';
import { ResortRagEventHandler } from '../../ai-assistant/application/resort-rag-event-handler.js';
import { ArticleRagEventHandler } from '../../ai-assistant/application/article-rag-event-handler.js';
import { ProjectKnowledgeRagEventHandler } from '../../ai-assistant/application/project-knowledge-rag-event-handler.js';
import { DynamicRagEventHandler } from '../../ai-assistant/application/dynamic-rag-event-handler.js';
import { DictionaryRagEventHandler } from '../../ai-assistant/application/dictionary-rag-event-handler.js';
import { RevenueImportEventHandler } from '../../resort-management/application/revenue-import-event-handler.js';
import { RagSourceReindexEventHandler } from '../../ai-assistant/application/rag-source-reindex-event-handler.js';
import { kafkaClientConfig } from './kafka-client-config.js';

@Injectable()
export class KafkaEventConsumer
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(KafkaEventConsumer.name);
  private readonly consumer: Consumer;
  private readonly topic: string;
  private connecting?: Promise<void>;
  private stopping = false;
  private finishCycle?: () => void;
  private finishRetry?: () => void;

  constructor(
    private readonly config: ConfigService,
    private readonly resorts: ResortRagEventHandler,
    private readonly articles: ArticleRagEventHandler,
    private readonly projectKnowledge: ProjectKnowledgeRagEventHandler,
    private readonly dynamics: DynamicRagEventHandler,
    private readonly dictionaries: DictionaryRagEventHandler,
    private readonly revenueImports: RevenueImportEventHandler,
    private readonly ragReindex: RagSourceReindexEventHandler,
    @Optional() private readonly dependencies?: RagDependencyEventHandler,
  ) {
    const kafka = new Kafka(kafkaClientConfig(config));
    this.consumer = kafka.consumer({
      // The outer lifecycle owns reconnect/backoff; do not also restart inside KafkaJS.
      retry: { restartOnFailure: async () => false },
      groupId:
        config.get<string>('KAFKA_CONSUMER_GROUP') ?? 'linji-rag-indexer',
    });
    this.topic =
      config.get<string>('KAFKA_EVENTS_TOPIC') ?? 'linji.integration-events';
  }

  onApplicationBootstrap(): void {
    if (
      this.config.get<string>('KAFKA_CONSUMER_ENABLED') !== 'true' ||
      process.env.NODE_ENV === 'test' ||
      process.env.OPENAPI_EXPORT === 'true'
    ) {
      return;
    }
    this.connecting = this.consume();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.finishCycle?.();
    this.finishRetry?.();
    await this.consumer.stop().catch(() => undefined);
    await this.consumer.disconnect().catch(() => undefined);
    await this.connecting?.catch(() => undefined);
  }

  private async consume(): Promise<void> {
    let retryDelayMs = 1_000;
    while (!this.stopping) {
      let removeCrashListener: (() => void) | undefined;
      try {
        await this.consumer.connect();
        if (this.stopping) break;
        await this.consumer.subscribe({
          topic: this.topic,
          // A new group must catch events published before its first startup.
          // Existing groups still resume their committed offsets; Inbox handles replay.
          fromBeginning: true,
        });
        if (this.stopping) break;
        const cycleEnded = new Promise<Error | null>((resolve) => {
          this.finishCycle = () => resolve(null);
          removeCrashListener = this.consumer.on(
            this.consumer.events.CRASH,
            ({ payload }) => resolve(payload.error),
          );
        });
        await this.consumer.run({
          autoCommit: false,
          eachMessage: async (delivery) => {
            const { topic, partition, message } = delivery;
            if (!message.value)
              throw new Error('Kafka event message has no value');
            const event = parseEvent(message.value.toString('utf8'));
            await this.handleWithHeartbeats(event, () => delivery.heartbeat());
            await this.consumer.commitOffsets([
              {
                topic,
                partition,
                offset: (BigInt(message.offset) + 1n).toString(),
              },
            ]);
          },
        });
        retryDelayMs = 1_000;
        // run() resolves after startup, not when the consumer stops. Stay alive
        // until a crash or shutdown instead of immediately disconnecting.
        const crash = await cycleEnded;
        if (crash) throw crash;
      } catch (error) {
        this.logger.error(
          'Kafka consumer cycle failed; uncommitted events will be retried',
          error instanceof Error ? error.stack : String(error),
        );
      } finally {
        removeCrashListener?.();
        this.finishCycle = undefined;
        await this.consumer.disconnect().catch(() => undefined);
      }
      if (!this.stopping) {
        await this.waitBeforeRetry(retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
      }
    }
  }

  private async handleWithHeartbeats(
    event: IntegrationEvent,
    heartbeat: () => Promise<void>,
  ): Promise<void> {
    // Drain every started handler before KafkaJS retries/rejoins or shuts down.
    // Wrapping each call also isolates synchronous handler exceptions.
    const work = Promise.allSettled(
      [
        this.resorts,
        this.articles,
        this.projectKnowledge,
        this.dynamics,
        this.dictionaries,
        this.revenueImports,
        this.ragReindex,
        ...(this.dependencies ? [this.dependencies] : []),
      ].map(async (handler) => handler.handle(event)),
    );
    let finished = false;
    void work.then(() => {
      finished = true;
    });
    let heartbeatFailed = false;
    let heartbeatError: unknown;
    while (!finished) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          work,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 1_000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (!finished) {
        try {
          // KafkaJS applies its configured heartbeatInterval; never overlap calls.
          await heartbeat();
        } catch (error) {
          heartbeatFailed = true;
          heartbeatError = error;
          break;
        }
      }
    }
    const results = await work;
    if (heartbeatFailed) throw heartbeatError;
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected) throw rejected.reason;
    // Verify membership again before explicitly acknowledging completed work.
    await heartbeat();
  }

  private waitBeforeRetry(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.finishRetry = undefined;
        resolve();
      }, milliseconds);
      this.finishRetry = () => {
        clearTimeout(timer);
        this.finishRetry = undefined;
        resolve();
      };
    });
  }
}

function parseEvent(value: string): IntegrationEvent {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || !isRecord(parsed.payload)) {
    throw new TypeError('Kafka event envelope is invalid');
  }
  if (
    typeof parsed.eventId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      parsed.eventId,
    ) ||
    typeof parsed.eventType !== 'string' ||
    typeof parsed.aggregateType !== 'string' ||
    typeof parsed.aggregateId !== 'string' ||
    typeof parsed.occurredAt !== 'string' ||
    Number.isNaN(Date.parse(parsed.occurredAt))
  ) {
    throw new TypeError('Kafka event envelope is invalid');
  }
  return {
    eventId: parsed.eventId,
    eventType: parsed.eventType,
    aggregateType: parsed.aggregateType,
    aggregateId: parsed.aggregateId,
    occurredAt: new Date(parsed.occurredAt),
    payload: parsed.payload as { [key: string]: JsonValue },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
