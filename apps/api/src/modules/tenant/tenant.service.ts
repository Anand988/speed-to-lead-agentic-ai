import { Injectable, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from './tenant.entity.js';
import { BusinessEntity } from './entities/business.entity.js';
import { ServiceEntity } from './entities/service.entity.js';
import { LocalityEntity } from './entities/locality.entity.js';
import { CreateTenantDto } from '../tenant/dto/create-tenant.dto.js';
import { ChatService } from '../chat/chat.service.js';

export interface CreateBusinessInput {
  name: string;
  verticalSlug: string;
  locality: string;
  serviceAreas?: string[];
  rating?: number;
  isActive?: boolean;
  services?: Array<{
    name: string;
    description?: string;
    basePrice?: number;
  }>;
}

export interface UpdateBusinessInput {
  name?: string;
  verticalSlug?: string;
  locality?: string;
  serviceAreas?: string[];
  rating?: number;
  isActive?: boolean;
  services?: Array<{
    name: string;
    description?: string;
    basePrice?: number;
  }>;
}

export interface CreateLocalityInput {
  name: string;
  parentCity: string;
  postalCodes?: string[];
  isActive?: boolean;
}

export interface UpdateLocalityInput {
  name?: string;
  parentCity?: string;
  postalCodes?: string[];
  isActive?: boolean;
}

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    @InjectRepository(BusinessEntity)
    private readonly businessRepository: Repository<BusinessEntity>,
    @InjectRepository(ServiceEntity)
    private readonly serviceRepository: Repository<ServiceEntity>,
    @InjectRepository(LocalityEntity)
    private readonly localityRepository: Repository<LocalityEntity>,
    private readonly chatService: ChatService,
  ) {}

  async createTenant(dto: CreateTenantDto): Promise<Tenant> {
    const existing = await this.tenantRepository.findOne({
      where: [{ slug: dto.slug }, { name: dto.name }],
    });

    if (existing) {
      throw new ConflictException(`Tenant with slug '${dto.slug}' or name '${dto.name}' already exists.`);
    }

    const tenant = this.tenantRepository.create({
      name: dto.name,
      slug: dto.slug,
      verticalSlug: dto.verticalSlug,
      isActive: dto.isActive ?? true,
    });

    const savedTenant = await this.tenantRepository.save(tenant);
    this.logger.log(`Onboarded vertical tenant: ${savedTenant.name} for vertical: ${savedTenant.verticalSlug}`);

    return savedTenant;
  }

  async findAllTenants(): Promise<Tenant[]> {
    return await this.tenantRepository.find({ order: { createdAt: 'DESC' } });
  }

  // --- BUSINESS / VENDOR MANAGEMENT ---

  async listBusinesses(verticalSlug?: string): Promise<BusinessEntity[]> {
    return await this.businessRepository.find({
      where: verticalSlug ? { verticalSlug } : {},
      relations: { services: true },
      order: { rating: 'DESC', createdAt: 'DESC' },
    });
  }

  async createBusiness(input: CreateBusinessInput): Promise<BusinessEntity> {
    const business = this.businessRepository.create({
      name: input.name.trim(),
      verticalSlug: input.verticalSlug.trim(),
      locality: input.locality.trim(),
      serviceAreas: (input.serviceAreas ?? []).map((area) => area.trim()).filter(Boolean),
      rating: input.rating ?? 4.8,
      isActive: input.isActive ?? true,
      services: input.services?.map((s) => this.serviceRepository.create(s)) ?? [],
    });

    const saved = await this.businessRepository.save(business);
    await this.chatService.invalidateVendorCache(saved.verticalSlug);
    this.logger.log(`Created business "${saved.name}" (${saved.locality}) & invalidated cache for ${saved.verticalSlug}`);
    return saved;
  }

  async updateBusiness(id: string, input: UpdateBusinessInput): Promise<BusinessEntity> {
    const existing = await this.businessRepository.findOne({
      where: { id },
      relations: { services: true },
    });

    if (!existing) {
      throw new NotFoundException(`Business with ID '${id}' not found.`);
    }

    const previousVerticalSlug = existing.verticalSlug;

    if (input.name !== undefined) existing.name = input.name.trim();
    if (input.verticalSlug !== undefined) existing.verticalSlug = input.verticalSlug.trim();
    if (input.locality !== undefined) existing.locality = input.locality.trim();
    if (input.serviceAreas !== undefined) {
      existing.serviceAreas = input.serviceAreas.map((area) => area.trim()).filter(Boolean);
    }
    if (input.rating !== undefined) existing.rating = input.rating;
    if (input.isActive !== undefined) existing.isActive = input.isActive;

    if (input.services !== undefined) {
      await this.serviceRepository.delete({ businessId: existing.id });
      existing.services = input.services.map((s) =>
        this.serviceRepository.create({ ...s, businessId: existing.id }),
      );
    }

    const saved = await this.businessRepository.save(existing);

    await this.chatService.invalidateVendorCache(saved.verticalSlug);
    if (previousVerticalSlug !== saved.verticalSlug) {
      await this.chatService.invalidateVendorCache(previousVerticalSlug);
    }

    this.logger.log(`Updated business "${saved.name}" & invalidated cache for ${saved.verticalSlug}`);
    return saved;
  }

  async toggleBusinessStatus(id: string, isActive: boolean): Promise<BusinessEntity> {
    const existing = await this.businessRepository.findOne({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Business with ID '${id}' not found.`);
    }

    existing.isActive = isActive;
    const saved = await this.businessRepository.save(existing);

    await this.chatService.invalidateVendorCache(saved.verticalSlug);
    this.logger.log(
      `Set business "${saved.name}" isActive=${saved.isActive} & invalidated cache for ${saved.verticalSlug}`,
    );
    return saved;
  }

  // --- LOCALITY / SUB-LOCALITY HIERARCHY MANAGEMENT ---

  async listLocalities(parentCity?: string): Promise<LocalityEntity[]> {
    return await this.localityRepository.find({
      where: parentCity ? { parentCity } : {},
      order: { parentCity: 'ASC', name: 'ASC' },
    });
  }

  async createLocality(input: CreateLocalityInput): Promise<LocalityEntity> {
    const entity = this.localityRepository.create({
      name: input.name.trim(),
      parentCity: input.parentCity.trim(),
      postalCodes: (input.postalCodes ?? []).map((p) => p.trim()).filter(Boolean),
      isActive: input.isActive ?? true,
    });

    const saved = await this.localityRepository.save(entity);
    await this.chatService.invalidateLocalityCache();
    this.logger.log(`Created locality "${saved.name}" -> parentCity "${saved.parentCity}" & invalidated locality cache`);
    return saved;
  }

  async bulkCreateLocalities(items: CreateLocalityInput[]): Promise<LocalityEntity[]> {
    const entities = items.map((item) =>
      this.localityRepository.create({
        name: item.name.trim(),
        parentCity: item.parentCity.trim(),
        postalCodes: (item.postalCodes ?? []).map((p) => p.trim()).filter(Boolean),
        isActive: item.isActive ?? true,
      }),
    );

    const saved = await this.localityRepository.save(entities);
    await this.chatService.invalidateLocalityCache();
    this.logger.log(`Bulk created ${saved.length} localities & invalidated locality cache`);
    return saved;
  }

  async updateLocality(id: string, input: UpdateLocalityInput): Promise<LocalityEntity> {
    const existing = await this.localityRepository.findOne({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Locality with ID '${id}' not found.`);
    }

    if (input.name !== undefined) existing.name = input.name.trim();
    if (input.parentCity !== undefined) existing.parentCity = input.parentCity.trim();
    if (input.postalCodes !== undefined) {
      existing.postalCodes = input.postalCodes.map((p) => p.trim()).filter(Boolean);
    }
    if (input.isActive !== undefined) existing.isActive = input.isActive;

    const saved = await this.localityRepository.save(existing);
    await this.chatService.invalidateLocalityCache();
    this.logger.log(`Updated locality "${saved.name}" & invalidated locality cache`);
    return saved;
  }
}