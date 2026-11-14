// apps/api/src/modules/dispatch/dispatch.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DispatchProcessor } from './dispatch.processor.js';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'lead-dispatch',
    }),
  ],
  providers: [DispatchProcessor],
  exports: [BullModule],
})
export class DispatchModule {}