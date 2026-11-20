// apps/api/src/modules/queue/queue.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface LeadDispatchPayload {
  leadId: string;
  phone: string;
  intent: string;
  locality: string;
  verticalSlug: string;
  firstName?: string;
}

export interface MarketplaceMatchingPayload {
  leadId: string;
  verticalSlug: string;
  sessionId: string;
  metadata: Record<string, any>;
}

const BULLMQ_OP_TIMEOUT_MS = 1500;

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(@InjectQueue('lead-dispatch') private readonly leadQueue: Queue<any>) {}

  private async withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`BullMQ ${label} timed out after ${BULLMQ_OP_TIMEOUT_MS}ms`)),
            BULLMQ_OP_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async dispatchQualifiedLead(leadId: string, leadData: LeadDispatchPayload): Promise<void> {
    try {
      await this.withTimeout(
        this.leadQueue.add('send-lead-alert', leadData, {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        }),
        'dispatchQualifiedLead',
      );
      this.logger.log(`Dispatched lead qualification job to BullMQ for Lead ID: ${leadId}`);
    } catch (error) {
      // Lead is already persisted in PostgreSQL — fail open so user confirmation never hangs
      this.logger.warn(
        `BullMQ unavailable for send-lead-alert (Lead ID: ${leadId}, saved in DB, failing open): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async addMarketplaceMatchingJob(jobData: MarketplaceMatchingPayload): Promise<void> {
    try {
      await this.withTimeout(
        this.leadQueue.add('marketplace-matching', jobData, {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        }),
        'addMarketplaceMatchingJob',
      );
      this.logger.log(`Marketplace matching job added to BullMQ for Lead ID: ${jobData.leadId}`);
    } catch (error) {
      // Lead is already persisted in PostgreSQL — fail open so user confirmation never hangs
      this.logger.warn(
        `BullMQ unavailable for marketplace-matching (Lead ID: ${jobData.leadId}, saved in DB, failing open): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // --- NEW METRICS & MANAGEMENT METHODS ---

  async getQueueMetrics() {
    if (!this.leadQueue) {
      throw new Error('Lead queue is not initialized');
    }

    try {
      const [waiting, active, completed, failed, delayed] = await this.withTimeout(
        Promise.all([
          this.leadQueue.getWaitingCount(),
          this.leadQueue.getActiveCount(),
          this.leadQueue.getCompletedCount(),
          this.leadQueue.getFailedCount(),
          this.leadQueue.getDelayedCount(),
        ]),
        'getQueueMetrics',
      );

      return {
        redisAvailable: true,
        waiting,
        active,
        completed,
        failed,
        delayed,
      };
    } catch (error) {
      this.logger.warn(
        `BullMQ unavailable while fetching queue metrics: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        redisAvailable: false,
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      };
    }
  }

  async clearFailedJobs(): Promise<number> {
    if (!this.leadQueue) {
      throw new Error('Lead queue is not initialized');
    }

    const failedJobs = await this.withTimeout(
      this.leadQueue.getFailed(),
      'clearFailedJobs',
    );
    let clearedCount = 0;

    for (const job of failedJobs) {
      await job.remove();
      clearedCount++;
    }

    this.logger.log(`Cleared ${clearedCount} failed jobs from lead queue.`);
    return clearedCount;
  }
}