import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

export const FIREBASE_ADMIN_TOKEN = 'FIREBASE_ADMIN';

@Global()
@Module({
  providers: [
    {
      provide: FIREBASE_ADMIN_TOKEN,
      useFactory: (config: ConfigService) => {
        if (admin.apps.length === 0) {
          admin.initializeApp({
            credential: admin.credential.cert({
              projectId: config.get<string>('FIREBASE_PROJECT_ID'),
              clientEmail: config.get<string>('FIREBASE_CLIENT_EMAIL'),
              // The \n characters come escaped from .env — unescape them
              privateKey: config.get<string>('FIREBASE_PRIVATE_KEY')!
                .replace(/\\n/g, '\n'),
            }),
          });
        }
        return admin.app();
      },
      inject: [ConfigService],
    },
  ],
  exports: [FIREBASE_ADMIN_TOKEN],
})
export class FirebaseModule { }
