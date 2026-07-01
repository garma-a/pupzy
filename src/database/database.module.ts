import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { databaseProvider, DATABASE_TOKEN } from './database.provider';

@Global()
@Module({
  providers: [
    {
      provide: 'DATABASE_URL',
      useFactory: (config: ConfigService) => config.get<string>('DATABASE_URL'),
      inject: [ConfigService],
    },
    databaseProvider,
  ],
  exports: [DATABASE_TOKEN],
})
export class DatabaseModule { }
