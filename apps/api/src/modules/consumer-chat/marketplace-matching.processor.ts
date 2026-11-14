// apps/api/src/modules/consumer-chat/marketplace-matching.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, BadRequestException } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead, LeadStatus } from '../lead/lead.entity.js';
import { Tenant } from '../tenant/tenant.entity.js';

@Processor('lead-processing')
export class MarketplaceMatchingProcessor extends WorkerHost {
  private readonly logger = new Logger(MarketplaceMatchingProcessor.name);

  constructor(
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    if (job.name !== 'marketplace-matching') {
      return;
    }

    const { leadId, verticalSlug, sessionId } = job.data;

    // L2 Security: Payload validation
    if (!leadId || !verticalSlug || !sessionId) {
      this.logger.error(`Security alert: Malformed job payload received for marketplace-matching.`);
      throw new BadRequestException('Invalid job payload: missing mandatory parameters.');
    }

    this.logger.log(`Processing secure marketplace matching for lead: ${leadId}, vertical: ${verticalSlug}`);

    try {
      // 1. Retrieve and verify lead existence
      const lead = await this.leadRepository.findOne({ where: { id: leadId } });
      if (!lead) {
        this.logger.warn(`Security/Data warning: Lead ${leadId} not found in database.`);
        return;
      }

      // Prevent race conditions / duplicate assignment
      if (lead.tenantId) {
        this.logger.warn(`Lead ${leadId} is already assigned to tenant ${lead.tenantId}. Skipping.`);
        return;
      }

      // --- DOMAIN-BASED DATABASE GUARDRAIL ---
      // Enforce strict vertical domain matching and active status at the SQL/ORM query level.
      // This guarantees a 'home-services' lead can NEVER be routed to a 'legal' or inactive tenant.
      const matchingTenant = await this.tenantRepository.findOne({
        where: { 
          verticalSlug: verticalSlug, // Strict domain boundary enforcement
          isActive: true,             // Ensure tenant is actively operating
        }, 
        order: { createdAt: 'ASC' }, // Fair FIFO round-robin assignment within the vertical domain
      });

      if (matchingTenant) {
        // 2. Secure assignment within domain boundaries
        lead.tenantId = matchingTenant.id;
        lead.status = LeadStatus.QUALIFIED;
        
        lead.metadata = {
          ...lead.metadata,
          matchedAt: new Date().toISOString(),
          matchingMethod: 'strict-domain-database-guardrail',
        };

        await this.leadRepository.save(lead);
        this.logger.log(`Successfully assigned lead ${leadId} to tenant ${matchingTenant.id} under vertical domain: ${verticalSlug}`);
      } else {
        this.logger.warn(`Database Guardrail: No active matching tenant found for vertical domain: ${verticalSlug}. Lead retained in unassigned state.`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Critical error in marketplace matching worker for lead ${leadId}: ${errorMessage}`, errorStack);
      throw error;
    }
  }
}