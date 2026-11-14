// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

// Entities
import { Tenant } from './modules/tenant/tenant.entity.js';
import { Vendor } from './modules/vendors/vendor.entity.js';
import { Appointment } from './modules/appointments/appointment.entity.js';
import { LeadTracking } from './modules/tracking/tracking.entity.js';
import { VendorFeedback } from './modules/feedback/feedback.entity.js';
import { Conversation } from './modules/chat/entities/conversation.entity.js';
import { Message } from './modules/chat/entities/message.entity.js';

// Feature Modules
import { VendorModule } from './modules/vendors/vendor.moule.js';
import { AppointmentModule } from './modules/appointments/appointment.module.js';
import { TrackingModule } from './modules/tracking/tracking.module.js';
import { PaymentModule } from './modules/payments/payment.module.js';
import { FeedbackModule } from './modules/feedback/feedback.module.js';
import { DispatchModule } from './modules/dispatch/dispatch.module.js';
import { LeadOrchestratorModule } from './modules/orchestrator/lead-orchstrator.module.js';
import { ChatModule } from './modules/chat/chat.module.js';
import { PricingModule } from './modules/pricing/pricing.module.js';
import { User } from './modules/user/user.entity.js';

@Module({
  imports: [
    // 👉 Point ConfigModule to load .env.dev explicitly based on NODE_ENV or filename
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'dev' ? '.env.dev' : '.env',
    }),

    // PostgreSQL TypeORM Connection
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DATABASE_HOST', 'localhost'),
        port: parseInt(configService.get<string>('DATABASE_PORT', '5432'), 10),
        username: configService.get<string>('DATABASE_USER', 'postgres'),
        password: String(configService.get<string>('DATABASE_PASSWORD', '123456')),
        database: configService.get<string>('DATABASE_NAME', 'speed_to_lead_dev'),
        entities: [Tenant, Vendor, Appointment, LeadTracking, VendorFeedback, Conversation, Message, User],
        synchronize: true, // Set to false in production
        autoLoadEntities: true,
      }),
    }),

    // Redis / BullMQ Global Connection
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: parseInt(configService.get<string>('REDIS_PORT', '6379'), 10),
        },
      }),
    }),

    // Domain Feature Modules
    VendorModule,
    PricingModule,
    AppointmentModule,
    TrackingModule,
    PaymentModule,
    FeedbackModule,
    DispatchModule,
    LeadOrchestratorModule,
    ChatModule,
  ],
})
export class AppModule {}