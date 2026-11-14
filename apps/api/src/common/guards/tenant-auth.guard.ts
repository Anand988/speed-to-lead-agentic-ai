// apps/api/src/common/guards/tenant-auth.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { TenantContextService } from '../context/tenant-context.service.js';
import { User } from '../../modules/user/user.entity.js';

@Injectable()
export class TenantAuthGuard implements CanActivate {
  constructor(private readonly tenantContextService: TenantContextService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as User;

    if (!user) {
      throw new ForbiddenException('Authentication required.');
    }

    const resolvedTenantId = this.tenantContextService.getTenantId();

    // Ensure the logged-in user's tenant matches the resolved request tenant (subdomain/header)
    if (user.tenantId !== resolvedTenantId) {
      throw new ForbiddenException('Access denied: Tenant mismatch detected.');
    }
    return true;
  }
}