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
import type {
  ChatState,
  CollectedData,
  LastPromptMeta,
} from '../chat-guard.types.js';

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

  @Column({ name: 'vertical_slug', nullable: true })
  verticalSlug: string;

  @Column({ name: 'step_index', default: 1 })
  stepIndex: number;

  // 👉 Topic 1: Deterministic funnel state machine
  @Column({ type: 'varchar', length: 64, default: 'GREETING' })
  state: ChatState;

  // 👉 Topic 1: Structured verified data across turns
  @Column({ name: 'collected_data', type: 'jsonb', default: () => "'{}'" })
  collectedData: CollectedData;

  // 👉 Topic 1: Per-step invalid attempt counter (3-strike recovery ladder)
  @Column({ name: 'invalid_attempts', type: 'int', default: 0 })
  invalidAttempts: number;

  // 👉 Topic 1: Active step expected input, quick replies & candidate IDs
  @Column({ name: 'last_prompt_meta', type: 'jsonb', nullable: true })
  lastPromptMeta: LastPromptMeta | null;

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