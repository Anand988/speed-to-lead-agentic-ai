// apps/api/src/modules/queue/lead.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { LeadDispatchPayload } from '../queue.service.js';

@Processor('lead-dispatch')
export class LeadProcessor extends WorkerHost {
  private readonly logger = new Logger(LeadProcessor.name);

  async process(job: Job<LeadDispatchPayload>): Promise<void> {
    const { leadId, phone, intent, locality, verticalSlug, firstName } = job.data;
    
    this.logger.log(`Processing lead dispatch notification (Job ID: ${job.id}) for Lead ID: ${leadId} | Phone: ${phone} in ${locality} (${verticalSlug})`);

    try {
      // TODO: Integrate your SMS provider (e.g., Twilio, Exotel, Fast2SMS) or WhatsApp Business API here
      // Example:
      // await this.smsService.sendSMS(phone, `Hello ${firstName || 'Customer'}, your ${intent} request in ${locality} is confirmed!`);

      // Simulated network/API call delay or execution
      this.logger.log(`Successfully dispatched notification for lead ID: ${leadId} (Intent: ${intent})`);
    } catch (error) {
      this.logger.error(
        `Failed to process lead dispatch notification for Lead ID: ${leadId}`,
        error instanceof Error ? error.stack : String(error),
      );
      // Throwing error signals BullMQ to trigger retry / exponential backoff
      throw error;
    }
  }
}