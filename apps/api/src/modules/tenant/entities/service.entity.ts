import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import type { BusinessEntity } from './business.entity.js';

@Entity('services')
export class ServiceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  businessId!: string;

  @Column()
  name!: string; // e.g., "5kW On-Grid Package + Subsidy Filing"

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  basePrice?: number;

  @ManyToOne('BusinessEntity', (business: BusinessEntity) => business.services, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'businessId' })
  business!: BusinessEntity;
}