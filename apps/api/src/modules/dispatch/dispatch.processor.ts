// apps/api/src/modules/dispatch/dispatch.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';

@Processor('lead-dispatch')
export class DispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(DispatchProcessor.name);

  async process(job: Job<{ leadId: string; vendorId: string; tenantId: string }>): Promise<any> {
    const { leadId, vendorId } = job.data;
    this.logger.log(`Dispatching lead ${leadId} to vendor ${vendorId}...`);

    // Simulate checking vendor acknowledgment within time window (e.g., 15 mins)
    const acknowledged = await this.checkVendorAcknowledgment(leadId, vendorId);

    if (!acknowledged) {
      this.logger.warn(`Vendor ${vendorId} missed lead ${leadId}. Triggering fallback re-routing...`);
      await this.triggerFallbackRouting(leadId);
      return { status: 'RE_ROUTED', leadId };
    }

    this.logger.log(`Vendor successfully acknowledged lead ${leadId}`);
    return { status: 'DISPATCHED_SUCCESS', leadId };
  }

  private async checkVendorAcknowledgment(leadId: string, vendorId: string): Promise<boolean> {
    // Database query logic to check if vendor accepted in agent portal
    return true; 
  }

  private async triggerFallbackRouting(leadId: string): Promise<void> {
    // Re-assign lead to secondary backup vendor in the same zone
  }
}