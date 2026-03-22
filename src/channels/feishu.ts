/**
 * Feishu (飞书) channel implementation for NanoClaw.
 * Uses WebSocket long connection for receiving messages and REST API for sending.
 */
import * as lark from '@larksuiteoapi/node-sdk';
import type { Channel } from '../types.js';
import { registerChannel, type ChannelOpts } from './registry.js';
import { logger } from '../logger.js';

const FEISHU_JID_PREFIX = 'feishu:';

export class FeishuChannel implements Channel {
  readonly name = 'feishu';
  private opts: ChannelOpts;
  private client: lark.Client;
  private wsClient: lark.WSClient;
  private connected = false;

  constructor(opts: ChannelOpts) {
    this.opts = opts;

    const baseConfig = {
      appId: process.env.FEISHU_APP_ID!,
      appSecret: process.env.FEISHU_APP_SECRET!,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu, // Use Feishu (China) endpoints, not Lark (international)
    };

    // REST API client for sending messages
    this.client = new lark.Client(baseConfig);

    // WebSocket client for receiving messages via long connection
    this.wsClient = new lark.WSClient({
      ...baseConfig,
      loggerLevel: lark.LoggerLevel.info,
    });
  }

  async connect(): Promise<void> {
    const eventDispatcher = new lark.EventDispatcher({
      logger: console,
    }).register({
      'im.message.receive_v1': async (data) => {
        logger.info({ channel: this.name, data }, 'Feishu message received!');
        await this.handleMessage(data);
      },
    });

    // Start with timeout to detect connection issues
    const startPromise = this.wsClient.start({ eventDispatcher });
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('WS start timeout')), 10000)
    );

    try {
      await Promise.race([startPromise, timeout]);
      logger.info({ channel: this.name }, 'Feishu WebSocket connected');
    } catch (err) {
      logger.error({ channel: this.name, err }, 'Feishu WS start failed');
    }

    this.connected = true;
  }

  private async handleMessage(data: any): Promise<void> {
    try {
      const { message, sender } = data;

      // Skip messages from the bot itself
      if (sender?.sender_type === 'app') {
        logger.debug({ channel: this.name }, 'Skipping bot message');
        return;
      }

      const chatId = message.chat_id;
      const chatJid = `${FEISHU_JID_PREFIX}${chatId}`;

      // Extract text content from message
      const content = this.extractTextContent(message);

      if (!content) {
        logger.debug(
          { channel: this.name, messageType: message.message_type },
          'Skipping non-text message',
        );
        return;
      }

      // Get sender info
      const senderId = sender?.sender_id?.user_id || 'unknown';
      const senderName = sender?.sender_id?.user_id || senderId;

      // Create timestamp from message.create_time (Unix timestamp in seconds)
      const timestamp = message.create_time
        ? new Date(parseInt(message.create_time) * 1000).toISOString()
        : new Date().toISOString();

      logger.info({ channel: this.name, chatJid }, 'Calling onChatMetadata');
      this.opts.onChatMetadata(chatJid, timestamp, undefined, 'feishu', true);
      logger.info({ channel: this.name, chatJid }, 'onChatMetadata done');

      logger.info({ channel: this.name, chatJid }, 'Calling onMessage');
      this.opts.onMessage(chatJid, {
        id: message.message_id,
        chat_jid: chatJid,
        sender: senderId,
        sender_name: senderName,
        content: content,
        timestamp: timestamp,
        is_from_me: false,
        is_bot_message: false,
      });
      logger.info({ channel: this.name, chatJid }, 'onMessage done');
    } catch (err) {
      logger.error(
        { err, channel: this.name },
        'Error handling Feishu message',
      );
    }
  }

  private extractTextContent(message: any): string {
    if (message.message_type !== 'text') {
      return '';
    }

    try {
      const content = JSON.parse(message.content);
      return content.text || '';
    } catch {
      // If content is not JSON, return as-is
      return message.content || '';
    }
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.ownsJid(jid)) {
      throw new Error(`Invalid JID for Feishu channel: ${jid}`);
    }

    const chatId = jid.replace(FEISHU_JID_PREFIX, '');

    // Split long messages (Feishu has a limit)
    const chunks = this.splitMessage(text);

    for (const chunk of chunks) {
      try {
        await this.client.im.v1.message.create({
          params: {
            receive_id_type: 'chat_id',
          },
          data: {
            receive_id: chatId,
            msg_type: 'text',
            content: JSON.stringify({ text: chunk }),
          },
        });
      } catch (err) {
        logger.error(
          { err, channel: this.name, chatId },
          'Failed to send Feishu message',
        );
        throw err;
      }
    }
  }

  private splitMessage(text: string, maxLength = 4000): string[] {
    if (text.length <= maxLength) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Try to split at a newline or space
      let splitIndex = remaining.lastIndexOf('\n', maxLength);
      if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
        splitIndex = remaining.lastIndexOf(' ', maxLength);
      }
      if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
        splitIndex = maxLength;
      }

      chunks.push(remaining.slice(0, splitIndex).trim());
      remaining = remaining.slice(splitIndex).trim();
    }

    return chunks;
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(FEISHU_JID_PREFIX);
  }

  async disconnect(): Promise<void> {
    // The SDK doesn't provide a stop method, but we can mark as disconnected
    this.connected = false;
    logger.info({ channel: this.name }, 'Feishu channel disconnected');
  }
}

// Self-registration at module load
registerChannel('feishu', (opts: ChannelOpts): Channel | null => {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;

  if (!appId || !appSecret) {
    logger.debug('Feishu credentials not configured, skipping channel');
    return null;
  }

  return new FeishuChannel(opts);
});
