// apps/api/src/modules/vendors/vendor.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vendor } from './vendor.entity.js';
import { VendorMatchingService } from './vendor-matching.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Vendor])],
  providers: [VendorMatchingService],
  exports: [VendorMatchingService, TypeOrmModule],
})
export class VendorModule {}