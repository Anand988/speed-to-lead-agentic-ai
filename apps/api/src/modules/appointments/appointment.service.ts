// apps/api/src/modules/appointments/appointment.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Appointment } from './appointment.entity.js';

@Injectable()
export class AppointmentService {
  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentRepo: Repository<Appointment>,
  ) {}

  async bookSlot(leadId: string, vendorId: string, startTime: Date): Promise<Appointment> {
    // Check for double booking conflicts
    const existingBooking = await this.appointmentRepo.findOne({
      where: { vendorId, startTime },
    });

    if (existingBooking) {
      throw new BadRequestException('Selected time slot is already occupied. Please choose another.');
    }

    const appointment = this.appointmentRepo.create({
      leadId,
      vendorId,
      startTime,
      status: 'CONFIRMED',
    });

    return await this.appointmentRepo.save(appointment);
  }
}