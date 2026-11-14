// apps/api/src/modules/queue/queue.service.ts
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue('lead-processing') private readonly leadQueue: Queue,
  ) {}

  async getQueueMetrics() {
    const counts = await this.leadQueue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
    );
    return {
      queueName: this.leadQueue.name,
      metrics: counts,
    };
  }

  async clearFailedJobs() {
    return await this.leadQueue.clean(0, 1000, 'failed');
  }

  /**
   * Dispatches a marketplace discovery lead to the queue for tenant matching and qualification processing.
   */
  async addMarketplaceMatchingJob(data: {
    leadId: string;
    verticalSlug: string;
    sessionId: string;
    metadata: Record<string, any>;
  }) {
    return await this.leadQueue.add('marketplace-matching', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
}