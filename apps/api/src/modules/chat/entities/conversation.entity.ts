// apps/api/src/modules/chat/entities/conversation.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenant/tenant.entity.js'; // Adjust path per your structure
import { Message } from '../entities/message.entity.js'; // Adjust path per your structure

@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'visitor_session_token', unique: true })
  visitorSessionToken: string;

  @Column({ default: 'active' })
  status: string; // 'active', 'qualified', 'closed'

  @Column({ type: 'jsonb', nullable: true })
  extractedLeadData: {
    name?: string;
    phone?: string;
    email?: string;
    intent?: string;
    score?: number;
  };

  // apps/api/src/modules/chat/entities/conversation.entity.ts
@OneToMany('Message', (message: any) => message.conversation, { cascade: true })
messages: any[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}