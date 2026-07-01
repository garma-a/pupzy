import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'path';

import { validateEnv } from './config/env.config';
import { DatabaseModule } from './database/database.module';
import { FirebaseModule } from './auth/firebase.module';
import { FirebaseAuthGuard } from './auth/firebase.guard';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // Config: load .env and validate with Zod
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),

    // GraphQL: schema-first, reads from your SDL files
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      typePaths: ['./**/*.graphql'],       // picks up your SDL schema files
      definitions: {
        path: join(process.cwd(), 'src/graphql.ts'),   // auto-generates TS types
      },
      context: ({ req }: { req: Request }) => ({ req }),
      playground: process.env.NODE_ENV !== 'production',
    }),

    DatabaseModule,
    FirebaseModule,
    UsersModule,
  ],
  providers: [
    // Apply FirebaseAuthGuard globally — all resolvers require auth by default
    // Use @Public() decorator on specific resolvers to opt out
    {
      provide: APP_GUARD,
      useClass: FirebaseAuthGuard,
    },
  ],
})
export class AppModule { }
