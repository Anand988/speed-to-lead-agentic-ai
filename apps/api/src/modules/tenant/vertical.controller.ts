import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VerticalEntity } from './entities/vertical.entity.js';
import type { VerticalMetadataConfig } from './entities/vertical.entity.js';
import { ChatService } from '../chat/chat.service.js';

@Controller('api/verticals')
export class VerticalController {
  constructor(
    @InjectRepository(VerticalEntity)
    private readonly verticalRepository: Repository<VerticalEntity>,
    private readonly chatService: ChatService,
  ) {}

  @Get()
  async findAll() {
    return await this.verticalRepository.find({ order: { name: 'ASC' } });
  }

  @Get(':slug')
  async findOneBySlug(@Param('slug') slug: string) {
    const normalizedSlug = slug.toLowerCase().trim();
    const vertical = await this.verticalRepository.findOne({ where: { slug: normalizedSlug } });
    if (!vertical) {
      throw new NotFoundException(`Vertical '${normalizedSlug}' not found.`);
    }
    return vertical;
  }

  @Patch(':slug/metadata')
  @HttpCode(HttpStatus.OK)
  async updateMetadata(
    @Param('slug') slug: string,
    @Body() metadataPatch: Record<string, any>,
  ) {
    const normalizedSlug = slug.toLowerCase().trim();
    const vertical = await this.verticalRepository.findOne({ where: { slug: normalizedSlug } });
    if (!vertical) {
      throw new NotFoundException(`Vertical '${normalizedSlug}' not found.`);
    }

    vertical.metadata = {
      ...(vertical.metadata ?? {}),
      ...(metadataPatch as VerticalMetadataConfig),
    };

    const saved = await this.verticalRepository.save(vertical);
    await this.chatService.invalidateVerticalCache(normalizedSlug);
    return saved;
  }
}