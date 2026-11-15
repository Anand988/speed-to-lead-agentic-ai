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

  @Column('jsonb', { nullable: true })
  intakeSteps: {
    stepIndex: number;
    question: string;
    quickReplies: string[];
  }[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}