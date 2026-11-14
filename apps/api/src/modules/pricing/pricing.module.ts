// apps/api/src/modules/pricing/pricing.module.ts
import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service.js';

@Module({
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}