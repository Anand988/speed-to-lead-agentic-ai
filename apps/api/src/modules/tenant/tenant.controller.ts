// apps/api/src/modules/tenant/tenant.controller.ts
import { Controller, Post, Get, Body, HttpCode, HttpStatus, UsePipes, ValidationPipe } from '@nestjs/common';
import { TenantService } from './tenant.service.js';
import { CreateTenantDto } from './dto/create-tenant.dto.js';

@Controller('api/v1/tenants')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async registerTenant(@Body() dto: CreateTenantDto) {
    return await this.tenantService.createTenant(dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async listTenants() {
    return await this.tenantService.findAllTenants();
  }
}