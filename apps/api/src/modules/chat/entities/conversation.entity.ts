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
import { Tenant } from '../../tenant/tenant.entity.js';
import { Message } from '../entities/message.entity.js';

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

  // 👉 Added to track which vertical/domain this session belongs to
  @Column({ name: 'vertical_slug', nullable: true })
  verticalSlug: string;

  // 👉 Added to track the current wizard step index (prevents loops)
  @Column({ name: 'step_index', default: 1 })
  stepIndex: number;

  @Column({ type: 'jsonb', nullable: true })
  extractedLeadData: {
    name?: string;
    phone?: string;
    email?: string;
    intent?: string;
    score?: number;
  };

  @OneToMany(() => Message, (message: Message) => message.conversation, { cascade: true })
  messages: Message[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}