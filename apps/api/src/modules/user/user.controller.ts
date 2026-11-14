// apps/api/src/modules/users/users.controller.ts
import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { UsersService } from './user.service.js';
import { User } from './user.entity.js';
import { AuthGuard } from '@nestjs/passport';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard.js';

@Controller('api/v1/users')
@UseGuards(AuthGuard('jwt'), TenantAuthGuard) // Protects routes with JWT and tenant validation
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  async create(@Body() createUserDto: Partial<User>): Promise<User> {
    return await this.usersService.create(createUserDto);
  }

  @Get()
  async findAll(): Promise<User[]> {
    return await this.usersService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<User> {
    return await this.usersService.findOne(id);
  }
}