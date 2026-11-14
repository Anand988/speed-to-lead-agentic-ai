// apps/api/src/modules/queue/queue.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { LeadProcessor } from './processors/lead-processor.js';
import { QueueService } from './queue.service.js';
import { QueueController } from './queue.controller.js';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST') || 'localhost',
          port: configService.get<number>('REDIS_PORT') || 6379,
        },
      }),
    }),
    BullModule.registerQueue({
      name: 'lead-processing',
    }),
  ],
  controllers: [QueueController],
  providers: [LeadProcessor, QueueService],
  exports: [BullModule, QueueService],
})
export class QueueModule {}