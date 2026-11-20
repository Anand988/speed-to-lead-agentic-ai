import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ServiceEntity } from './service.entity.js';

@Entity('businesses')
export class BusinessEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column()
  verticalSlug!: string; // e.g., 'solar-panel-installation'

  @Column()
  locality!: string; // Primary city or locality, e.g., 'Hyderabad', 'Hanamkonda'

  @Column({ type: 'jsonb', default: () => "'[]'" })
  serviceAreas!: string[]; // Optional sub-localities served, e.g., ['Gachibowli', 'Madhapur']

  @Column({ type: 'decimal', precision: 2, scale: 1, default: 4.8 })
  rating!: number;

  @Column({ default: true })
  isActive!: boolean;

  @OneToMany(() => ServiceEntity, (service) => service.business, { cascade: true })
  services!: ServiceEntity[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedDate!: Date;
}