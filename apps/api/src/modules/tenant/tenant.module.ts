// apps/api/src/modules/tenant/tenant.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './tenant.entity.js';
import { VerticalEntity } from '../tenant/entities/domain.entity.js';
import { TenantController } from './tenant.controller.js';
import { VerticalController } from './domain.controller.js';
import { TenantService } from './tenant.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tenant, VerticalEntity]),
  ],
  controllers: [TenantController, VerticalController],
  providers: [TenantService],
  exports: [
    TypeOrmModule,
    TenantService, // Export service so other modules can query or validate tenants if needed
  ],
})
export class TenantModule {}

