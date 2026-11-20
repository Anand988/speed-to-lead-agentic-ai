// apps/api/src/modules/tenant/vertical.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('verticals')
export class VerticalEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  slug: string; // e.g., 'home-cleaning', 'solar-installation', 'pest-control'

  @Column()
  name: string; // e.g., 'Home Cleaning & Makeover'

  /// Stores the in-depth, naive-user-friendly steps as JSON
  @Column({ type: 'jsonb', nullable: true })
  intakeSteps: Array<{
    stepIndex: number;
    question: string;
    quickReplies: string[];
  }>;

  /// Stores vertical-specific UI and AI configuration (placeholders, quick replies, prompts)
  @Column({ type: 'jsonb', nullable: true, default: () => "'{}'" })
  metadata: {
    requirementPlaceholder?: string;
    quickReplies?: string[];
    systemPrompt?: string;
  } | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}