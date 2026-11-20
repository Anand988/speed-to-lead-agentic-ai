// apps/api/src/modules/tenant/tenant.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './tenant.entity.js';
import { VerticalEntity } from './entities/vertical.entity.js';
import { BusinessEntity } from './entities/business.entity.js';
import { ServiceEntity } from './entities/service.entity.js';
import { TenantController } from './tenant.controller.js';
import { VerticalController } from './vertical.controller.js';
import { TenantService } from './tenant.service.js';
import { TenantContextService } from '../../common/context/tenant-context.service.js';
import { ChatModule } from '../chat/chat.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tenant, VerticalEntity, BusinessEntity, ServiceEntity]),
    ChatModule,
  ],
  controllers: [TenantController, VerticalController],
  providers: [TenantService, TenantContextService],
  exports: [
    TypeOrmModule,
    TenantService,
    TenantContextService,
  ],
})
export class TenantModule {}