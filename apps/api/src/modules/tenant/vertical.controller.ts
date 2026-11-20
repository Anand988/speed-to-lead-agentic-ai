// src/modules/tenant/vertical.controller.ts
import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VerticalEntity } from './entities/vertical.entity.js';

@Controller('api/verticals')
export class VerticalController {
  constructor(
    @InjectRepository(VerticalEntity)
    private readonly verticalRepository: Repository<VerticalEntity>,
  ) {}

  @Get()
  async findAll() {
    return await this.verticalRepository.find();
  }
}