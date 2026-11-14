// apps/api/src/modules/appointments/appointment.entity.ts
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  ManyToOne, 
  JoinColumn 
} from 'typeorm';
import { Vendor } from '../vendors/vendor.entity.js';

@Entity('appointments')
export class Appointment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  leadId: string; // Links this appointment to the customer lead

  @Column({ type: 'uuid' })
  vendorId: string; // Links this appointment to the assigned local vendor

  @ManyToOne(() => Vendor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vendorId' })
  vendor: Vendor;

  @Column({ type: 'timestamp' })
  startTime: Date; // Scheduled date and time for the service

  @Column({ type: 'varchar', length: 50, default: 'CONFIRMED' })
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}