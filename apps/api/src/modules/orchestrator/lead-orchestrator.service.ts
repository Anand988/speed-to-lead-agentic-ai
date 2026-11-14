// apps/api/src/modules/orchestrator/lead-orchestrator.service.ts
import { Injectable } from '@nestjs/common';
import { VendorMatchingService } from '../vendors/vendor-matching.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { AppointmentService } from '../appointments/appointment.service.js';
import { TrackingService } from '../tracking/tracking.service.js';
import { PaymentService } from '../payments/payment.service.js';

@Injectable()
export class LeadOrchestratorService {
  constructor(
    private readonly vendorMatchingService: VendorMatchingService,
    private readonly pricingService: PricingService,
    private readonly appointmentService: AppointmentService,
    private readonly trackingService: TrackingService,
    private readonly paymentService: PaymentService,
  ) {}

  async processQualifiedLead(data: {
    tenantId: string;
    leadId: string;
    serviceVertical: string;
    userLocation: string;
    serviceScale?: number;
    appointmentTime: Date;
  }) {
    // Step 4: Match Local Vendor
    const vendor = await this.vendorMatchingService.findBestVendor(
      data.tenantId,
      data.serviceVertical,
      data.userLocation,
    );

    // Step 5: Calculate Pricing & Agreement Quote
    const quote = this.pricingService.calculateQuote({
      serviceVertical: data.serviceVertical,
      volumeOrScale: data.serviceScale || 1,
      vendor,
    });

    // Step 6: Book Appointment Slot
    const appointment = await this.appointmentService.bookSlot(
      data.leadId,
      vendor.id,
      data.appointmentTime,
    );

    // Step 8: Initialize Real-time Customer Tracking
    await this.trackingService.initializeTracking(
      data.leadId,
      vendor.name,
      '+91-9876543210', // Assigned agent contact mock
    );

    // Step 9: Generate Payment Escrow Checkout Order
    const paymentOrder = await this.paymentService.createEscrowOrder(
      data.leadId,
      quote.estimatedTotal,
      quote.currency,
    );

    return {
      success: true,
      matchedVendor: { id: vendor.id, name: vendor.name },
      pricingQuote: quote,
      appointmentDetails: appointment,
      paymentCheckout: paymentOrder,
    };
  }
}