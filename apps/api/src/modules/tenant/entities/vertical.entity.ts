import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export interface VerticalMetadataConfig {
  requirementPlaceholder?: string;
  quickReplies?: string[];
  systemPrompt?: string;
  canonicalIntents?: string[];
  intentAliases?: Record<string, string>;
  clarificationActionTemplates?: string[];
  clarificationSubjects?: string[];
  propertySizeConfig?: {
    enabled: boolean;
    maxUnits: number;
    options: string[];
  };
  serviceFilterKeywords?: Record<string, string[]>;
  expansionReplyTemplate?: string;
}

@Entity('verticals')
export class VerticalEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  slug!: string; // e.g., 'home-cleaning-maintenance', 'solar-panel-installation'

  @Column()
  name!: string; // e.g., 'Home Cleaning & Maintenance'

  /// Stores the in-depth, naive-user-friendly steps as JSON
  @Column({ type: 'jsonb', nullable: true })
  intakeSteps!: Array<{
    stepIndex: number;
    question: string;
    quickReplies: string[];
  }> | null;

  /// Stores vertical-specific UI, intent, and AI rules in PostgreSQL (cached in Redis)
  @Column({ type: 'jsonb', nullable: true, default: () => "'{}'" })
  metadata!: VerticalMetadataConfig | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}