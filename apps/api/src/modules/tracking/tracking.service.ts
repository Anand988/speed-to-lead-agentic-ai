// apps/api/src/modules/tracking/tracking.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LeadTracking } from './tracking.entity.js';

@Injectable()
export class TrackingService {
  constructor(
    @InjectRepository(LeadTracking)
    private readonly trackingRepo: Repository<LeadTracking>,
  ) {}

  async initializeTracking(leadId: string, assignedAgentName: string, agentPhone: string): Promise<LeadTracking> {
    const tracking = this.trackingRepo.create({
      leadId,
      status: 'ASSIGNED',
      assignedAgentName,
      agentPhone,
    });
    return await this.trackingRepo.save(tracking);
  }

  async updateStatus(leadId: string, status: 'ASSIGNED' | 'EN_ROUTE' | 'ARRIVED' | 'COMPLETED'): Promise<LeadTracking> {
    const tracking = await this.trackingRepo.findOne({ where: { leadId } });
    if (!tracking) throw new NotFoundException(`Tracking record not found for lead: ${leadId}`);

    tracking.status = status;
    return await this.trackingRepo.save(tracking);
  }

  async getTrackingByLead(leadId: string): Promise<LeadTracking> {
    const tracking = await this.trackingRepo.findOne({ where: { leadId } });
    if (!tracking) throw new NotFoundException(`Tracking record not found for lead: ${leadId}`);
    return tracking;
  }
}