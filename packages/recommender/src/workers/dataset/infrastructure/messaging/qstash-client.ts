import type { QstashConfiguration } from '../config/qstash-configuration.service.js';

export interface QstashPublisher {
  publishJson(destination: string, payload: unknown): Promise<void>;
}

export function createQstashPublisher(
  configuration: Pick<QstashConfiguration, 'token' | 'url'>,
  fetchImpl: typeof fetch = fetch,
): QstashPublisher {
  return {
    async publishJson(destination, payload) {
      const response = await fetchImpl(`${configuration.url}/v2/publish/${destination}`, {
        body: JSON.stringify(payload),
        headers: {
          Authorization: `Bearer ${configuration.token}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`QStash recusou a publicação com status ${response.status}.`);
      }
    },
  };
}
