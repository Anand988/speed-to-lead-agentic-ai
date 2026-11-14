// apps/api/src/modules/chat/dtos/send-message.dto.ts
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  message: string;

  @IsString()
  @IsNotEmpty()
  visitorSessionToken: string;

  @IsString()
  @IsOptional()
  tenantId?: string; // Optional if resolved via TenantGuard/headers
}