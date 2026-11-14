// apps/api/src/modules/leads/leads.controller.ts
import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { LeadsService } from './lead.service.js';
import { Lead } from './lead.entity.js';
import { AuthGuard } from '@nestjs/passport';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard.js';

@Controller('api/v1/leads')
@UseGuards(AuthGuard('jwt'), TenantAuthGuard) // Enforces both valid user token and tenant match
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  async create(@Body() createLeadDto: Partial<Lead>): Promise<Lead> {
    return await this.leadsService.create(createLeadDto);
  }

  @Get()
  async findAll(): Promise<Lead[]> {
    return await this.leadsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Lead> {
    return await this.leadsService.findOne(id);
  }
}