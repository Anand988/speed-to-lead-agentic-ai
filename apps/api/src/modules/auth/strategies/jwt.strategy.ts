// apps/api/src/modules/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../user/user.entity.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'super-secret-fallback-key',
    });
  }

  async validate(payload: { sub: string; email: string; tenantId: string; role: string }) {
    // Fetch user and ensure they are active and belong to a valid tenant
    const user = await this.userRepository.findOne({
      where: { id: payload.sub, isActive: true },
      relations: { tenant: true },
    });

    if (!user || !user.tenant || !user.tenant.isActive) {
      throw new UnauthorizedException('User is inactive or associated tenant is disabled.');
    }

    return user; // This gets attached to req.user
  }
}