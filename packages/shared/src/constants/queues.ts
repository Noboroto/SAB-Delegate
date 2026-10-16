/** Job queue names; the only place a queue name is spelled. */
export const QUEUES = {
  birthdayDaily: 'birthday-daily',
  scheduledMessageSend: 'scheduled-message-send',
  chatbotHistoryRetention: 'chatbot-history-retention',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
