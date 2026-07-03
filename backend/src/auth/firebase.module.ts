import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';

export const FIREBASE_ADMIN_TOKEN = 'FIREBASE_ADMIN';

@Global()
@Module({
  providers: [
    {
      provide: FIREBASE_ADMIN_TOKEN,
      useFactory: (config: ConfigService) => {
        if (getApps().length === 0) {
          initializeApp({
            credential: cert({
              projectId: config.get<string>('FIREBASE_PROJECT_ID'),
              clientEmail: config.get<string>('FIREBASE_CLIENT_EMAIL'),
              // The \n characters come escaped from .env — unescape them
              privateKey: config
                .get<string>('FIREBASE_PRIVATE_KEY')!
                .replace(/\\n/g, '\n'),
            }),
          });
        }
        return getApp();
      },
      inject: [ConfigService],
    },
  ],
  exports: [FIREBASE_ADMIN_TOKEN],
})
export class FirebaseModule { }
