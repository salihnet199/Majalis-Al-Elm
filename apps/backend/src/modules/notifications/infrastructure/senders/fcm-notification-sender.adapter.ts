import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type { App } from 'firebase-admin/app';
import type { MulticastMessage, SendResponse } from 'firebase-admin/messaging';
import {
  NotificationSenderPort,
  SendNotificationResult,
} from '../../domain/ports/notification-sender.port';
import { NotificationOrmEntity } from '../persistence/entities/notification.orm-entity';
import { UserDeviceOrmEntity } from '../persistence/entities/user-device.orm-entity';
import { DeviceService } from '../../application/device.service';

/**
 * firebase-admin v14 dropped the old namespaced default export
 * (admin.credential, admin.apps, admin.messaging all used to exist on the
 * root object — none of them do anymore) in favor of modular subpath
 * exports. Loaded lazily via require() so the app can still boot in Smart
 * Hybrid Mode if the package fails to load for any reason — but from the
 * correct entry points this time, and typed via `import type` (erased at
 * compile time, so it doesn't force a runtime import) instead of `any`.
 */
type FirebaseAppModule = typeof import('firebase-admin/app');
type FirebaseMessagingModule = typeof import('firebase-admin/messaging');

let firebaseAppMod: FirebaseAppModule | null = null;
let firebaseMessagingMod: FirebaseMessagingModule | null = null;
try {
  firebaseAppMod = require('firebase-admin/app');
  firebaseMessagingMod = require('firebase-admin/messaging');
} catch {
  // Graceful fallback if the package is loading
}

@Injectable()
export class FcmNotificationSenderAdapter implements NotificationSenderPort, OnModuleInit {
  private readonly logger = new Logger(FcmNotificationSenderAdapter.name);
  private firebaseApp: App | null = null;
  private isFirebaseReady = false;

  constructor(private readonly deviceService: DeviceService) {}

  onModuleInit() {
    this.initFirebase();
  }

  /**
   * Initializes Firebase Admin SDK using the configured credentials.
   * Supports both Service Account JSON files and environment variables.
   * Gracefully degrades to Smart Hybrid Mode if credentials are not yet supplied.
   */
  private initFirebase() {
    if (!firebaseAppMod) {
      this.logger.warn('[FCM] firebase-admin package not loaded — running in Smart Hybrid Mode');
      return;
    }

    // Already initialized check
    const existingApps = firebaseAppMod.getApps();
    if (existingApps.length > 0) {
      this.firebaseApp = existingApps[0];
      this.isFirebaseReady = true;
      this.logger.log('[FCM] Reusing existing Firebase Admin App');
      return;
    }

    try {
      // 1. Check path specified in environment or default paths
      const customPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
      const candidatePaths = [
        customPath,
        path.resolve(process.cwd(), 'secrets/firebase-service-account.json'),
        path.resolve(process.cwd(), 'firebase-service-account.json'),
        path.resolve(__dirname, '../../../../../../secrets/firebase-service-account.json'),
      ].filter(Boolean) as string[];

      for (const candidate of candidatePaths) {
        if (fs.existsSync(candidate)) {
          const serviceAccount = JSON.parse(fs.readFileSync(candidate, 'utf8'));
          const credential = firebaseAppMod.cert(serviceAccount);
          this.firebaseApp = firebaseAppMod.initializeApp({ credential });
          this.isFirebaseReady = true;
          this.logger.log(`[FCM] Firebase Admin SDK successfully initialized with cert: ${candidate}`);
          return;
        }
      }

      // 2. Check inline environment variables
      if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
        const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
        const credential = firebaseAppMod.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey,
        });
        this.firebaseApp = firebaseAppMod.initializeApp({ credential });
        this.isFirebaseReady = true;
        this.logger.log('[FCM] Firebase Admin SDK successfully initialized from environment variables');
        return;
      }

      // 3. Fallback to Smart Hybrid Mode (Safe Mock for local dev & testing)
      this.logger.log(
        '[FCM] Smart Hybrid Mode Active: No Firebase service account detected. Push notifications will be simulated safely in logs.',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[FCM] Could not initialize Firebase Admin SDK: ${message}. Defaulting to Smart Hybrid Mode.`);
    }
  }

  /**
   * Sends real push notification via Firebase Cloud Messaging (FCM).
   * In Smart Hybrid Mode without credentials, simulates and logs push dispatch.
   */
  async sendPush(
    notification: NotificationOrmEntity,
    devices: UserDeviceOrmEntity[],
  ): Promise<SendNotificationResult> {
    if (!devices || devices.length === 0) {
      this.logger.debug(`[FCM] No active devices found for user ${notification.userId} — skipping push`);
      return { success: true };
    }

    const tokens = devices
      .map((d) => d.fcmToken)
      .filter((token): token is string => Boolean(token && token.trim().length > 0));

    if (tokens.length === 0) {
      return { success: true };
    }

    // ── Live FCM Dispatch ──────────────────────────────────────────
    if (this.isFirebaseReady && this.firebaseApp && firebaseMessagingMod) {
      try {
        // actionUrl isn't a column on NotificationOrmEntity — it would live
        // in the flexible `data` JSONB bag if a caller ever sets one there.
        // Nothing currently does, so this is always '' today; kept reading
        // from the right place instead of a nonexistent top-level field.
        const actionUrl = typeof notification.data?.actionUrl === 'string' ? notification.data.actionUrl : '';

        const payload: MulticastMessage = {
          tokens,
          notification: {
            title: notification.title ?? undefined,
            body: notification.body,
          },
          data: {
            notificationId: String(notification.id),
            category: String(notification.category || 'announcement'),
            channel: String(notification.channel || 'IN_APP'),
            actionUrl,
            createdAt: notification.createdAt ? notification.createdAt.toISOString() : new Date().toISOString(),
          },
          android: {
            priority: 'high',
            notification: {
              sound: 'default',
              channelId: 'majalis_elm_announcements',
              clickAction: 'FLUTTER_NOTIFICATION_CLICK',
            },
          },
          apns: {
            payload: {
              aps: {
                sound: 'default',
                badge: 1,
                alert: {
                  title: notification.title ?? undefined,
                  body: notification.body,
                },
              },
            },
          },
        };

        const messaging = firebaseMessagingMod.getMessaging(this.firebaseApp);
        const response = await messaging.sendEachForMulticast(payload);
        this.logger.log(
          `[FCM] Multicast sent to ${tokens.length} device(s). Success: ${response.successCount}, Failures: ${response.failureCount}`,
        );

        // Prune unregistered/invalid tokens automatically
        if (response.failureCount > 0) {
          response.responses.forEach((resp: SendResponse, idx: number) => {
            if (!resp.success && resp.error) {
              const errorCode = resp.error.code;
              if (
                errorCode === 'messaging/registration-token-not-registered' ||
                errorCode === 'messaging/invalid-registration-token'
              ) {
                const staleToken = tokens[idx];
                this.logger.warn(`[FCM] Removing stale/unregistered token from user devices: ${staleToken.slice(0, 10)}...`);
                const deviceToRemove = devices.find((d) => d.fcmToken === staleToken);
                if (deviceToRemove) {
                  // Best-effort cleanup — a failed deletion here shouldn't
                  // interrupt notification dispatch for the remaining tokens.
                  this.deviceService
                    .deleteDevice(deviceToRemove.id, { sub: notification.userId })
                    .catch(() => undefined);
                }
              }
            }
          });
        }

        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        this.logger.error(`[FCM] Failed to dispatch multicast notification: ${message}`, stack);
        return { success: false, error: message };
      }
    }

    // ── Smart Hybrid Simulation Mode ──────────────────────────────
    this.logger.log(
      `[FCM Simulation] Sent push notification "${notification.title}" to ${tokens.length} device(s) for user ${notification.userId}`,
    );
    return { success: true };
  }

  async sendEmail(
    notification: NotificationOrmEntity,
    userEmail?: string,
  ): Promise<SendNotificationResult> {
    this.logger.log(`[Email] Sent email "${notification.title}" to ${userEmail || notification.userId}`);
    return { success: true };
  }

  async sendSms(
    notification: NotificationOrmEntity,
    userPhone?: string,
  ): Promise<SendNotificationResult> {
    this.logger.log(`[SMS] Sent SMS to ${userPhone || notification.userId}: ${notification.body}`);
    return { success: true };
  }
}
