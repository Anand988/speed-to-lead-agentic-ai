// apps/api/src/modules/orchestrator/lead-orchestrator.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LeadOrchestratorService } from './lead-orchestrator.service.js';
import { LeadOrchestratorController } from './lead-orchestrator.controller.js';
import { VendorModule } from '../vendors/vendor.moule.js';
import { PricingModule } from '../pricing/pricing.module.js'; // If you have a separate pricing module, or include PricingService directly
import { AppointmentModule } from '../appointments/appointment.module.js';
import { TrackingModule } from '../tracking/tracking.module.js';
import { PaymentModule } from '../payments/payment.module.js';
import { PricingService } from '../pricing/pricing.service.js';

@Module({
  imports: [
    VendorModule,
    PricingModule,
    AppointmentModule,
    TrackingModule,
    PaymentModule,
    BullModule.registerQueue({
      name: 'lead-dispatch',
    }),
  ],
  controllers: [LeadOrchestratorController],
  providers: [LeadOrchestratorService, PricingService],
  exports: [LeadOrchestratorService],
})
export class LeadOrchestratorModule {}