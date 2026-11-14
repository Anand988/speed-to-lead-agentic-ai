// apps/api/src/modules/leads/leads.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead } from './lead.entity.js';
import { TenantContextService } from '../../common/context/tenant-context.service.js';

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
    private readonly tenantContextService: TenantContextService,
  ) {}

  async create(createLeadDto: Partial<Lead>): Promise<Lead> {
    const tenantId = this.tenantContextService.getTenantId();

    const lead = this.leadRepository.create({
      ...createLeadDto,
      tenantId, // Automatically bind the lead to the current request's tenant
    });

    return await this.leadRepository.save(lead);
  }

  async findAll(): Promise<Lead[]> {
    const tenantId = this.tenantContextService.getTenantId();

    // Strictly enforce tenant boundary in every query
    return await this.leadRepository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Lead> {
    const tenantId = this.tenantContextService.getTenantId();

    const lead = await this.leadRepository.findOne({
      where: { id, tenantId },
    });

    if (!lead) {
      throw new NotFoundException(`Lead with ID ${id} not found.`);
    }

    return lead;
  }
}