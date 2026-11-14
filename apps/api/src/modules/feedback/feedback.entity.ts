// apps/api/src/modules/feedback/feedback.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('vendor_feedbacks')
export class VendorFeedback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  vendorId: string;

  @Column({ type: 'uuid' })
  leadId: string;

  @Column({ type: 'int' })
  rating: number; // 1 to 5 stars

  @Column({ type: 'text', nullable: true })
  reviewComments: string;

  @CreateDateColumn()
  createdAt: Date;
}