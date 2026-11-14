// apps/api/src/modules/tracking/tracking.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeadTracking } from './tracking.entity.js';
import { TrackingService } from './tracking.service.js';
import { TrackingController } from './tracking.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([LeadTracking])],
  controllers: [TrackingController],
  providers: [TrackingService],
  exports: [TrackingService, TypeOrmModule],
})
export class TrackingModule {}