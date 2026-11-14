// apps/api/src/modules/tracking/tracking.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('lead_trackings')
export class LeadTracking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  leadId: string;

  @Column({ type: 'varchar', default: 'ASSIGNED' })
  status: 'ASSIGNED' | 'EN_ROUTE' | 'ARRIVED' | 'COMPLETED';

  @Column({ type: 'varchar', nullable: true })
  assignedAgentName: string;

  @Column({ type: 'varchar', nullable: true })
  agentPhone: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}