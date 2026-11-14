// apps/api/src/modules/queue/processors/lead-processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';

@Processor('lead-processing')
export class LeadProcessor extends WorkerHost {
  private readonly logger = new Logger(LeadProcessor.name);

  async process(job: Job<any, any, string>): Promise<any> {
    const { leadId, tenantId, payload } = job.data;
    
    this.logger.log(`Processing lead ${leadId} for tenant ${tenantId} from Redis queue...`);

    // Here is where you can later trigger DeepSeek LLM scoring or webhooks
    
    this.logger.log(`Lead ${leadId} processing complete.`);
  }
}