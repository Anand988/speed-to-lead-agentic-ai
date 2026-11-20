import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('localities')
export class LocalityEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column()
  name!: string; // e.g., 'Gachibowli', 'Madhapur', 'Hyderabad'

  @Index()
  @Column()
  parentCity!: string; // e.g., 'Hyderabad' (for top-level cities, set parentCity = 'Hyderabad')

  @Column({ type: 'jsonb', default: () => "'[]'" })
  postalCodes!: string[]; // e.g., ['500032']

  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}