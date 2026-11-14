// apps/api/src/common/context/tenant-context.service.ts
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { Tenant } from '../../modules/tenant/tenant.entity.js';

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<Tenant>();

  setTenant(tenant: Tenant): void {
    this.storage.enterWith(tenant);
  }

  getTenant(): Tenant | undefined {
    return this.storage.getStore();
  }

  getTenantId(): string {
    const tenant = this.getTenant();
    if (!tenant) {
      throw new Error('Tenant context is not established for this request.');
    }
    return tenant.id;
  }
}