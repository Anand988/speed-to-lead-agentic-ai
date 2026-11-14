// apps/api/src/modules/users/users.service.ts
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity.js';
import { TenantContextService } from '../../common/context/tenant-context.service.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly tenantContextService: TenantContextService,
  ) {}

  async create(createUserDto: Partial<User>): Promise<User> {
    const tenantId = this.tenantContextService.getTenantId();

    try {
      const user = this.userRepository.create({
        ...createUserDto,
        tenantId, // Bind user strictly to current tenant context
      });
      return await this.userRepository.save(user);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new ConflictException('User with this email already exists.');
      }
      throw error;
    }
  }

  async findAll(): Promise<User[]> {
    const tenantId = this.tenantContextService.getTenantId();
    return await this.userRepository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<User> {
    const tenantId = this.tenantContextService.getTenantId();
    const user = await this.userRepository.findOne({
      where: { id, tenantId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found.`);
    }

    return user;
  }
}