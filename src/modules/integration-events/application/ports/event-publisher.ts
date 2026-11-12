import type { IntegrationEvent } from '../../domain/integration-event.js';

export interface EventPublisher {
  publish(event: IntegrationEvent): Promise<void>;
}
