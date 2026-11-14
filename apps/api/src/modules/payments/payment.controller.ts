// apps/api/src/modules/payments/payment.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { PaymentService } from './payment.service.js';

@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('create-order')
  async createOrder(@Body() body: { leadId: string; amount: number; currency?: string }) {
    return await this.paymentService.createEscrowOrder(body.leadId, body.amount, body.currency);
  }
}