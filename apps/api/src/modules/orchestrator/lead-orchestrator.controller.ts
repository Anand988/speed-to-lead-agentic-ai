// apps/api/src/modules/orchestrator/lead-orchestrator.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { LeadOrchestratorService } from './lead-orchestrator.service.js';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Controller('leads')
export class LeadOrchestratorController {
  constructor(
    private readonly orchestratorService: LeadOrchestratorService,
    @InjectQueue('lead-dispatch') private readonly dispatchQueue: Queue,
  ) {}

  @Post('qualify-and-book')
  async qualifyAndBook(
    @Body()
    body: {
      tenantId: string;
      leadId: string;
      serviceVertical: string;
      userLocation: string;
      serviceScale?: number;
      appointmentTime: string; // ISO string from frontend
    },
  ) {
    // Execute steps 4 through 6, 8, and 9 via Master Orchestrator
    const result = await this.orchestratorService.processQualifiedLead({
      tenantId: body.tenantId,
      leadId: body.leadId,
      serviceVertical: body.serviceVertical,
      userLocation: body.userLocation,
      serviceScale: body.serviceScale || 1,
      appointmentTime: new Date(body.appointmentTime),
    });

    // Step 7: Push dispatch task into BullMQ background queue
    await this.dispatchQueue.add('dispatch-lead', {
      leadId: body.leadId,
      vendorId: result.matchedVendor.id,
      tenantId: body.tenantId,
    }, {
      delay: 1000 * 60 * 15, // 15-minute acknowledgment window before fallback re-route check
    });

    return {
      message: 'Lead successfully qualified, vendor matched, appointment booked, and dispatch queued.',
      ...result,
    };
  }
}