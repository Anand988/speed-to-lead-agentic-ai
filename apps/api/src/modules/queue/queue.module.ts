// apps/api/src/modules/queue/queue.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service.js';
import { QueueController } from './queue.controller.js';
import { TenantModule } from '../tenant/tenant.module.js'; // <-- TenantContextService lives here

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'lead-dispatch',
    }),
    forwardRef(() => TenantModule), // <-- Breaks ESM circular initialization with TenantModule -> ChatModule -> QueueModule
  ],
  controllers: [QueueController],
  providers: [QueueService],
  exports: [QueueService, BullModule],
})
export class QueueModule {}