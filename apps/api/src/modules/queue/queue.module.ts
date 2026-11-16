// apps/api/src/modules/queue/queue.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service.js';
import { TenantModule } from '../tenant/tenant.module.js';

@Module({
  imports: [
    TenantModule,
    BullModule.registerQueue({
      name: 'lead-processing',
    }),
  ],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}