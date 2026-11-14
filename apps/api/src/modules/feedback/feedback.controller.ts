// apps/api/src/modules/feedback/feedback.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { FeedbackService } from '../feedback/feedback.service..js';

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post('submit')
  async submit(@Body() body: { vendorId: string; leadId: string; rating: number; reviewComments?: string }) {
    return await this.feedbackService.submitFeedback(body.vendorId, body.leadId, body.rating, body.reviewComments);
  }
}