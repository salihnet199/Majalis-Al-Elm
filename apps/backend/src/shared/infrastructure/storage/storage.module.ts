import { Global, Inject, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IStorageService,
  STORAGE_SERVICE,
} from '../../../modules/content/domain/ports/storage.service';
import {
  S3StorageAdapter,
  S3StorageConfig,
  S3_STORAGE_CONFIG,
} from './s3-storage.adapter';

/**
 * StorageModule — one central place where the object-storage vendor is chosen.
 *
 * ADR-013 §1 and the sponsor's Stage A decision: switching MinIO → Cloudflare R2
 * must be an environment change only. That is why the S3Client is constructed
 * from `S3_*` variables in a single factory here, and why every consumer injects
 * the `STORAGE_SERVICE` port instead of the adapter class. Nothing outside this
 * module names a vendor.
 *
 * @Global because storage is infrastructure used across bounded contexts (media
 * today; exports and backups later) and re-importing it in each module would
 * risk a second S3Client with a divergent configuration.
 */
@Global()
@Module({
  providers: [
    {
      provide: S3_STORAGE_CONFIG,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): S3StorageConfig => {
        const nodeEnv = configService.get<string>('NODE_ENV') ?? 'development';

        // Outside `test`, these are guaranteed present by two layers that ran
        // before this factory: the Joi rule in app.config.ts and
        // assertStorageIntegrity() in main.ts. The `?? ''` is not a fallback —
        // it only satisfies the type checker on a branch that cannot be reached
        // with empty values outside tests.
        const endpoint = configService.get<string>('S3_ENDPOINT') ?? '';
        const accessKeyId = configService.get<string>('S3_ACCESS_KEY') ?? '';
        const secretAccessKey = configService.get<string>('S3_SECRET_KEY') ?? '';
        const bucket = configService.get<string>('S3_BUCKET_NAME') ?? '';
        const region = configService.get<string>('S3_REGION') ?? 'us-east-1';

        // Optional, and only needed when the address the SERVER uses differs
        // from the address the BROWSER uses — which is exactly the local Docker
        // case: the backend reaches MinIO at http://minio:9000 while the editor's
        // browser only resolves http://localhost:9000. SigV4 signs the Host
        // header, so a presigned URL cannot be rewritten after signing; it has to
        // be signed against the host the client will actually call. When unset
        // (R2, AWS) the two are identical and this changes nothing.
        const publicEndpoint =
          configService.get<string>('S3_PUBLIC_BASE_URL') || endpoint;

        if (nodeEnv === 'test') {
          // Test-only placeholder so the DI container can build. It performs no
          // network call (the boot probe is skipped under `test`), and any real
          // use in a test fails loudly with a connection error — it never
          // pretends an upload succeeded. Tests that exercise storage either
          // inject their own double or set the real S3_* vars against MinIO.
          const testEndpoint = endpoint || 'http://127.0.0.1:9000';
          return {
            endpoint: testEndpoint,
            publicEndpoint: publicEndpoint || testEndpoint,
            region: region || 'us-east-1',
            accessKeyId: accessKeyId || 'test-placeholder-access-key',
            secretAccessKey: secretAccessKey || 'test-placeholder-secret-key',
            bucket: bucket || 'test-placeholder-bucket',
            forcePathStyle: true,
          };
        }

        return {
          endpoint,
          publicEndpoint,
          region,
          accessKeyId,
          secretAccessKey,
          bucket,
          // MinIO and R2 both require path-style addressing; AWS accepts it.
          forcePathStyle: true,
        };
      },
    },
    {
      provide: STORAGE_SERVICE,
      useClass: S3StorageAdapter,
    },
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule implements OnModuleInit {
  constructor(
    private readonly configService: ConfigService,
    // Injected by token, so even this module never names the vendor.
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {}

  /**
   * Layer 3 of the storage guard — the live one.
   *
   * Layers 1 (Joi) and 2 (assertStorageIntegrity) prove the configuration is
   * present and safe. Neither can prove the bucket exists or that the
   * credentials work; only a real request can. Throwing here rejects
   * `app.listen()` and the process exits 1.
   *
   * This is the sponsor's explicit Stage A requirement: "الخادم لا يُقلع محلياً
   * بدون MinIO يعمل فعلياً — لا تراجع صامت لحالة بلا رفع ملفات". A running
   * server that cannot store media would accept editor uploads and lose them,
   * which is exactly the class of silent failure POLICY-SEC-001 forbids.
   */
  async onModuleInit(): Promise<void> {
    if ((this.configService.get<string>('NODE_ENV') ?? 'development') === 'test') {
      return;
    }

    await this.storage.assertReachable();
  }
}
