// apps/api/src/modules/consumer-chat/consumer-chat.controller.ts
import { Controller, Post, Body, HttpCode, HttpStatus, UsePipes, ValidationPipe } from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional, Length, Matches } from 'class-validator';
import { ConsumerChatService } from './consumer-chat.service.js';

class StartConsumerChatDto {
  @IsString()
  @IsNotEmpty()
  @Length(2, 50)
  @Matches(/^[a-z0-9-]+$/, { message: 'verticalSlug must contain only lowercase alphanumeric characters and hyphens' })
  verticalSlug: string;

  @IsString()
  @IsOptional()
  initialMessage?: string;
}

class SendConsumerMessageDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^visitor_\d+_[a-z0-9]+$/, { message: 'Invalid session ID format' })
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 1000)
  message: string;

  @IsString()
  @IsNotEmpty()
  verticalSlug: string;
}

@Controller('api/v1/consumer/chat')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class ConsumerChatController {
  constructor(private readonly consumerChatService: ConsumerChatService) {}

  @Post('start')
  @HttpCode(HttpStatus.OK)
  async startChat(@Body() dto: StartConsumerChatDto) {
    return await this.consumerChatService.startSession(dto.verticalSlug, dto.initialMessage);
  }

  @Post('message')
  @HttpCode(HttpStatus.OK)
  async sendMessage(@Body() dto: SendConsumerMessageDto) {
    return await this.consumerChatService.processMessage(
      dto.sessionId,
      dto.verticalSlug,
      dto.message,
    );
  }
}