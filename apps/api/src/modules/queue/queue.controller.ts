// apps/api/src/modules/queue/queue.controller.ts
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { QueueService } from '../queue/queue.service.js';
import { AuthGuard } from '@nestjs/passport';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard.js';

@Controller('api/v1/queues')
@UseGuards(AuthGuard('jwt'), TenantAuthGuard)
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Get('metrics')
  async getMetrics() {
    return await this.queueService.getQueueMetrics();
  }

  @Post('clear-failed')
  async clearFailed() {
    await this.queueService.clearFailedJobs();
    return { success: true, message: 'Failed queue jobs cleared.' };
  }
}