// apps/api/src/modules/feedback/feedback.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VendorFeedback } from './feedback.entity.js';

@Injectable()
export class FeedbackService {
  constructor(
    @InjectRepository(VendorFeedback)
    private readonly feedbackRepo: Repository<VendorFeedback>,
  ) {}

  async submitFeedback(vendorId: string, leadId: string, rating: number, reviewComments?: string): Promise<VendorFeedback> {
    const feedback = this.feedbackRepo.create({
      vendorId,
      leadId,
      rating,
      reviewComments,
    });
    return await this.feedbackRepo.save(feedback);
  }
}