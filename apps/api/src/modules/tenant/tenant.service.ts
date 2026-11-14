// apps/api/src/modules/tenant/tenant.service.ts
import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from './tenant.entity.js';
import { CreateTenantDto } from '../tenant/dto/create-tenant.dto.js';

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
  ) {}

  async createTenant(dto: CreateTenantDto): Promise<Tenant> {
    const existing = await this.tenantRepository.findOne({
      where: [{ slug: dto.slug }, { name: dto.name }],
    });

    if (existing) {
      throw new ConflictException(`Tenant with slug '${dto.slug}' or name '${dto.name}' already exists.`);
    }

    const tenant = this.tenantRepository.create({
      name: dto.name,
      slug: dto.slug,
      verticalSlug: dto.verticalSlug,
      isActive: dto.isActive ?? true,
    });

    const savedTenant = await this.tenantRepository.save(tenant);
    this.logger.log(`Onboarded vertical tenant: ${savedTenant.name} for vertical: ${savedTenant.verticalSlug}`);
    
    return savedTenant;
  }

  async findAllTenants(): Promise<Tenant[]> {
    return await this.tenantRepository.find({ order: { createdAt: 'DESC' } });
  }
}