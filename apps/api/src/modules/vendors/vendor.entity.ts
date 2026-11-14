// apps/api/src/modules/vendors/vendor.entity.ts
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  ManyToOne, 
  JoinColumn 
} from 'typeorm';
// 🚫 Remove import of Tenant to break circular dependency at runtime

@Entity('vendors')
export class Vendor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  // 👉 Use string 'Tenant' and 'any' for the callback parameter to completely avoid circular evaluation traps
  @ManyToOne('Tenant', (tenant: any) => tenant.vendors, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant: any; // TypeORM handles the typing dynamically via metadata

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 100 })
  serviceVertical: string;

  @Column({ type: 'simple-array' })
  serviceLocations: string[];

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  baseRate: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}