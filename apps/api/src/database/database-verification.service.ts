// apps/api/src/database/database-verification.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseVerificationService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseVerificationService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    try {
      if (this.dataSource.isInitialized) {
        // Execute a quick lightweight query to verify connectivity
        await this.dataSource.query('SELECT 1');
        this.logger.log('Database connection successfully verified via TypeORM DataSource.');
      } else {
        this.logger.error('TypeORM DataSource is not initialized.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Database connection verification failed: ${message}`, stack);
      // Depending on your deployment strategy, you may want to throw error to halt startup on failure
      throw error;
    }
  }
}