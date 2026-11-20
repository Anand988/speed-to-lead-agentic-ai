// apps/api/src/modules/chat/chat-cache.service.ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'crypto';
import { Redis } from 'ioredis';

@Injectable()
export class ChatCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(ChatCacheService.name);
  private readonly client: Redis | null;

  constructor() {
    this.client = this.createRedisClient();
  }

  private createRedisClient(): Redis | null {
    try {
      const redisUrl = process.env.REDIS_URL;
      const commonOptions = {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2000,
        commandTimeout: 1000,
      };

      const client = redisUrl
        ? new Redis(redisUrl, commonOptions)
        : new Redis({
            host: process.env.REDIS_HOST || '127.0.0.1',
            port: Number(process.env.REDIS_PORT || 6379),
            password: process.env.REDIS_PASSWORD || undefined,
            db: Number(process.env.REDIS_DB || 0),
            ...commonOptions,
          });

      client.on('error', (err: Error) => {
        this.logger.warn(`Redis client error (failing open): ${err.message}`);
      });

      return client;
    } catch (error: any) {
      this.logger.warn(`Failed to initialize Redis client (failing open): ${error?.message || error}`);
      return null;
    }
  }

  hashPayload(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (error: any) {
      this.logger.debug(`Redis GET failed for key="${key}" (fail-open): ${error?.message || error}`);
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.client || ttlSeconds <= 0) return;
    try {
      const serialized = JSON.stringify(value);
      await this.client.set(key, serialized, 'EX', ttlSeconds);
    } catch (error: any) {
      this.logger.debug(`Redis SET failed for key="${key}" (fail-open): ${error?.message || error}`);
    }
  }

  async delByPrefix(prefix: string): Promise<number> {
    if (!this.client) return 0;
    let deletedCount = 0;
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.client.scan(
          cursor,
          'MATCH',
          `${prefix}*`,
          'COUNT',
          100,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          deletedCount += await this.client.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error: any) {
      this.logger.warn(`Redis prefix delete failed for prefix="${prefix}": ${error?.message || error}`);
    }
    return deletedCount;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
    }
  }
}