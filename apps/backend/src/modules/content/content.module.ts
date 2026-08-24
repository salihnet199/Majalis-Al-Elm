import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ContentItemOrmEntity } from './infrastructure/persistence/entities/content-item.orm-entity';
import { CategoryOrmEntity } from './infrastructure/persistence/entities/category.orm-entity';
import { AuthorOrmEntity } from './infrastructure/persistence/entities/author.orm-entity';
import { TagOrmEntity } from './infrastructure/persistence/entities/tag.orm-entity';
import { MediaAssetOrmEntity } from './infrastructure/persistence/entities/media-asset.orm-entity';
import { TranslationOrmEntity } from './infrastructure/persistence/entities/translation.orm-entity';
import { CONTENT_ITEM_REPOSITORY } from './domain/ports/content-item.repository';
import { CATEGORY_REPOSITORY } from './domain/ports/category.repository';
import { AUTHOR_REPOSITORY } from './domain/ports/author.repository';
import { TAG_REPOSITORY } from './domain/ports/tag.repository';
import { MEDIA_ASSET_REPOSITORY } from './domain/ports/media-asset.repository';
import { TypeOrmContentItemRepository } from './infrastructure/persistence/typeorm-content-item.repository';
import { TypeOrmCategoryRepository } from './infrastructure/persistence/typeorm-category.repository';
import { TypeOrmAuthorRepository } from './infrastructure/persistence/typeorm-author.repository';
import { TypeOrmTagRepository } from './infrastructure/persistence/typeorm-tag.repository';
import { TypeOrmMediaAssetRepository } from './infrastructure/persistence/typeorm-media-asset.repository';
import { ContentController } from './presentation/content.controller';
import { AdminContentController } from './presentation/admin-content.controller';
import { AdminTaxonomyController } from './presentation/admin-taxonomy.controller';
import { AdminMediaController } from './presentation/admin-media.controller';
import { MediaUploadService } from './application/services/media-upload.service';
import { MediaTranscodeService } from './application/services/media-transcode.service';
import { TranscodeProcessor } from './application/jobs/transcode.processor';
import { QueueModule } from '../../shared/infrastructure/queue/queue.module';
import { MEDIA_TRANSCODE_QUEUE } from '../../shared/infrastructure/queue/media-transcode.queue';
import { RolesGuard } from './presentation/guards/roles.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ContentItemOrmEntity,
      CategoryOrmEntity,
      AuthorOrmEntity,
      TagOrmEntity,
      MediaAssetOrmEntity,
      TranslationOrmEntity,
    ]),
    // ADR-013 Stage B: embedded BullMQ worker
    QueueModule,
    BullModule.registerQueue({ name: MEDIA_TRANSCODE_QUEUE }),
  ],
  controllers: [
    ContentController,
    AdminContentController,
    AdminTaxonomyController,
    AdminMediaController,
  ],
  providers: [
    RolesGuard,
    // Injected by AdminMediaController (initiate/complete) and by
    // ContentController (the presigned stream endpoint). It depends on
    // STORAGE_SERVICE, which StorageModule exports globally.
    MediaUploadService,
    // ADR-013 Stage B: enqueue jobs + process them (embedded worker)
    MediaTranscodeService,
    TranscodeProcessor,
    {
      provide: CONTENT_ITEM_REPOSITORY,
      useClass: TypeOrmContentItemRepository,
    },
    {
      provide: CATEGORY_REPOSITORY,
      useClass: TypeOrmCategoryRepository,
    },
    {
      provide: AUTHOR_REPOSITORY,
      useClass: TypeOrmAuthorRepository,
    },
    {
      provide: TAG_REPOSITORY,
      useClass: TypeOrmTagRepository,
    },
    {
      provide: MEDIA_ASSET_REPOSITORY,
      useClass: TypeOrmMediaAssetRepository,
    },
  ],
  exports: [
    CONTENT_ITEM_REPOSITORY,
    CATEGORY_REPOSITORY,
    AUTHOR_REPOSITORY,
    TAG_REPOSITORY,
    MEDIA_ASSET_REPOSITORY,
  ],
})
export class ContentModule {}
