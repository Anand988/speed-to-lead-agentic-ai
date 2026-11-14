// apps/api/src/modules/pricing/pricing.service.ts
import { Injectable } from '@nestjs/common';
import { Vendor } from '../vendors/vendor.entity.js';

export interface PricingInput {
  serviceVertical: string;
  volumeOrScale?: number; // e.g., user count, square footage, hours
  vendor: Vendor;
}

@Injectable()
export class PricingService {
  calculateQuote(input: PricingInput): { baseRate: number; estimatedTotal: number; currency: string } {
    const { volumeOrScale = 1, vendor } = input;
    const baseRate = Number(vendor.baseRate) || 100.00;
    
    // Simple multiplier logic for scalable services
    const estimatedTotal = baseRate * (serviceScaleMultiplier(input.serviceVertical, volumeOrScale));

    return {
      baseRate,
      estimatedTotal: Number(estimatedTotal.toFixed(2)),
      currency: 'INR', // Configurable per tenant
    };
  }
}

function serviceScaleMultiplier(vertical: string, volume: number): number {
  if (vertical === 'sales-quotation') return Math.max(1, volume * 0.8);
  if (vertical === 'consulting') return Math.max(1, volume * 1.5);
  return 1;
}