// apps/api/src/modules/tenant/dto/create-tenant.dto.ts
import { IsString, IsNotEmpty, IsBoolean, IsOptional, Matches, Length } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  @Length(2, 100)
  name: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must contain only lowercase alphanumeric characters and hyphens' })
  slug: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, { message: 'verticalSlug must contain only lowercase alphanumeric characters and hyphens' })
  verticalSlug: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}