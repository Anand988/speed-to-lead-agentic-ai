// apps/api/src/modules/leads/entities/lead.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Tenant } from '../tenant/tenant.entity.js';

export enum LeadStatus {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  QUALIFIED = 'QUALIFIED',
  LOST = 'LOST',
  CONVERTED = 'CONVERTED',
}

@Entity('leads')
@Index(['tenantId', 'email']) // Index for fast multi-tenant lookups by email
@Index(['tenantId', 'status']) // Index for filtering leads by status within a tenant
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  firstName: string;

  @Column({ nullable: true })
  lastName: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  phone: string;

  @Column({
    type: 'enum',
    enum: LeadStatus,
    default: LeadStatus.NEW,
  })
  status: LeadStatus;

  @Column({ nullable: true })
  source: string; // e.g., 'Facebook Ads', 'Google Ads', 'Website Widget'

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>; // Flexible payload storage for custom webhook data

  // Public discovery marketplace fields
  @Column({ nullable: true })
  verticalSlug: string;

  @Column({ nullable: true })
  sessionId: string;

  @Column({ nullable: true })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'tenantId' })
  tenant: Tenant;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}