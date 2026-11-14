// apps/api/src/modules/feedback/feedback.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VendorFeedback } from './feedback.entity.js';
import { FeedbackService } from './feedback.service..js';
import { FeedbackController } from './feedback.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([VendorFeedback])],
  controllers: [FeedbackController],
  providers: [FeedbackService],
  exports: [FeedbackService, TypeOrmModule],
})
export class FeedbackModule {}