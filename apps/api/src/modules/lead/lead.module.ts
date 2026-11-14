import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from './lead.entity.js';
import { LeadsController } from './lead.controller.js';
import { LeadsService } from './lead.service.js';
import { TenantContextModule } from '../../common/context/tenant-context.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead]),
  ],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}