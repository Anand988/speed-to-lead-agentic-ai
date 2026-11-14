// apps/api/src/common/context/tenant-context.module.ts
import { Global, Module } from '@nestjs/common';
import { TenantContextService } from '../context/tenant-context.service.js';

@Global() // Makes TenantContextService available globally across all modules without re-importing
@Module({
  providers: [TenantContextService],
  exports: [TenantContextService],
})
export class TenantContextModule {}