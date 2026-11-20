import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TenantService } from './tenant.service.js';
import { CreateTenantDto } from './dto/create-tenant.dto.js';

class ServiceItemDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  basePrice?: number;
}

class CreateBusinessDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  verticalSlug!: string;

  @IsString()
  @IsNotEmpty()
  locality!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviceAreas?: string[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceItemDto)
  services?: ServiceItemDto[];
}

class UpdateBusinessDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  verticalSlug?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  locality?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviceAreas?: string[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceItemDto)
  services?: ServiceItemDto[];
}

class ToggleBusinessStatusDto {
  @IsBoolean()
  isActive!: boolean;
}

class CreateLocalityDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  parentCity!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  postalCodes?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class BulkCreateLocalitiesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateLocalityDto)
  localities!: CreateLocalityDto[];
}

class UpdateLocalityDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  parentCity?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  postalCodes?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@Controller('api/v1/tenants')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
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

  // --- BUSINESSES ---

  @Get('businesses')
  @HttpCode(HttpStatus.OK)
  async listBusinesses(@Query('verticalSlug') verticalSlug?: string) {
    return await this.tenantService.listBusinesses(verticalSlug);
  }

  @Post('businesses')
  @HttpCode(HttpStatus.CREATED)
  async createBusiness(@Body() dto: CreateBusinessDto) {
    return await this.tenantService.createBusiness(dto);
  }

  @Patch('businesses/:id')
  @HttpCode(HttpStatus.OK)
  async updateBusiness(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBusinessDto,
  ) {
    return await this.tenantService.updateBusiness(id, dto);
  }

  @Patch('businesses/:id/status')
  @HttpCode(HttpStatus.OK)
  async toggleBusinessStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ToggleBusinessStatusDto,
  ) {
    return await this.tenantService.toggleBusinessStatus(id, dto.isActive);
  }

  // --- LOCALITIES ---

  @Get('localities')
  @HttpCode(HttpStatus.OK)
  async listLocalities(@Query('parentCity') parentCity?: string) {
    return await this.tenantService.listLocalities(parentCity);
  }

  @Post('localities')
  @HttpCode(HttpStatus.CREATED)
  async createLocality(@Body() dto: CreateLocalityDto) {
    return await this.tenantService.createLocality(dto);
  }

  @Post('localities/bulk')
  @HttpCode(HttpStatus.CREATED)
  async bulkCreateLocalities(@Body() dto: BulkCreateLocalitiesDto) {
    return await this.tenantService.bulkCreateLocalities(dto.localities);
  }

  @Patch('localities/:id')
  @HttpCode(HttpStatus.OK)
  async updateLocality(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocalityDto,
  ) {
    return await this.tenantService.updateLocality(id, dto);
  }
}