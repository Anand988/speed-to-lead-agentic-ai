// apps/api/src/modules/vendors/vendor-matching.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Vendor } from '../vendors/vendor.entity.js';

@Injectable()
export class VendorMatchingService {
  constructor(
    @InjectRepository(Vendor)
    private readonly vendorRepository: Repository<Vendor>,
  ) {}

  async findBestVendor(tenantId: string, serviceVertical: string, userLocation: string): Promise<Vendor> {
    // Query active vendors matching the tenant and service vertical
    const vendors = await this.vendorRepository.find({
      where: { tenantId, serviceVertical, isActive: true },
    });

    if (!vendors || vendors.length === 0) {
      throw new NotFoundException(`No active service providers found for vertical: ${serviceVertical}`);
    }

    // Exact or partial location matching algorithm
    const matchedVendor = vendors.find(vendor => 
      vendor.serviceLocations.some(loc => 
        loc.toLowerCase().includes(userLocation.toLowerCase()) || 
        userLocation.toLowerCase().includes(loc.toLowerCase())
      )
    );

    // Fallback to the first available vendor if exact location match is missing
    return matchedVendor || vendors[0];
  }
}