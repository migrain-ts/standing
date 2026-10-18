export const liveChannel = (eventId: string) => `ev:${eventId}`;
export const LIVE_CHANNEL_PATTERN = 'ev:*';

export const DOCUMENT_QUEUE = 'documents';
export const documentJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: true,
  removeOnFail: 100,
} as const;
