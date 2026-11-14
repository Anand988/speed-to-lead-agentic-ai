// apps/api/src/common/middleware/tenant-resolution.middleware.ts
import { Injectable, NestMiddleware, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../../modules/tenant/tenant.entity.js';
import { TenantContextService } from '../context/tenant-context.service.js';

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    private readonly tenantContextService: TenantContextService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // 1. Extract tenant identifier (supporting header, subdomain, or custom domain)
    const tenantIdentifier = req.headers['x-tenant-id'] as string;
    const host = req.headers.host || '';

    let tenant: Tenant | null = null;

    if (tenantIdentifier) {
      tenant = await this.tenantRepository.findOne({ where: { id: tenantIdentifier, isActive: true } });
    } else if (host) {
      // Example: extract subdomain or check custom domain mapping
      const subdomain = host.split('.')[0];
      tenant = await this.tenantRepository.findOne({
        where: [{ slug: subdomain, isActive: true }, { customDomain: host, isActive: true }],
      });
    }

    if (!tenant) {
      throw new NotFoundException('Active tenant not found or invalid request context.');
    }

    // 2. Wrap execution in AsyncLocalStorage so downstream services know the tenant
    this.tenantContextService.setTenant(tenant);
    next();
  }
}