// apps/api/src/modules/tenant/entities/tenant.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, Index } from 'typeorm';
import { Vendor } from '../vendors/vendor.entity.js';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ unique: true })
  slug: string;

  @Column({ nullable: true, unique: true })
  customDomain: string;

  @Index()
  @Column({ nullable: true })
  verticalSlug: string; // Added to enforce domain-based multi-tenant isolation

  @Column({ default: true })
  isActive: boolean;

  // Use string 'User' to prevent circular runtime import
  @OneToMany('User', (user: any) => user.tenant, { cascade: true })
  users: any[];

  @OneToMany(() => Vendor, (vendor: Vendor) => vendor.tenant)
  vendors: Vendor[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}