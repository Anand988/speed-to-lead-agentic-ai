// apps/api/src/modules/tracking/tracking.controller.ts
import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { TrackingService } from './tracking.service.js';

@Controller('tracking')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Get(':leadId')
  async getTracking(@Param('leadId') leadId: string) {
    return await this.trackingService.getTrackingByLead(leadId);
  }

  @Post(':leadId/status')
  async updateStatus(
    @Param('leadId') leadId: string,
    @Body('status') status: 'ASSIGNED' | 'EN_ROUTE' | 'ARRIVED' | 'COMPLETED',
  ) {
    return await this.trackingService.updateStatus(leadId, status);
  }
}