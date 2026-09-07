import 'dart:io';

import 'package:isar/isar.dart';
import '../../../../core/storage/collections/content_meta_collection.dart';
import '../../../../core/storage/collections/download_queue_collection.dart';
import '../../../../core/storage/collections/offline_text_collection.dart';
import '../../../../core/storage/isar_service.dart';
import '../../../../core/utils/arabic_text_normalizer.dart';
import '../../domain/models/content_item_model.dart';

abstract class IOfflineContentRepository {
  Future<void> saveDownloadedContent({
    required ContentItemModel item,
    required String localFilePath,
  });

  Future<List<ContentMetaCollection>> getDownloadedList({String? type});

  Future<ContentMetaCollection?> getDownloadedItem(String contentId);

  Future<OfflineTextCollection?> getOfflineText(String contentId);

  Future<bool> deleteDownloadedContent(String contentId);

  Future<List<ContentMetaCollection>> searchOffline(String query);

  Future<int> getTotalStorageBytes();
}

class OfflineContentRepository implements IOfflineContentRepository {
  final Future<Isar> Function() _getDb;

  OfflineContentRepository({Future<Isar> Function()? dbProvider})
      : _getDb = dbProvider ?? IsarService.getInstance;

  Future<Isar> get _db => _getDb();

  @override
  Future<void> saveDownloadedContent({
    required ContentItemModel item,
    required String localFilePath,
  }) async {
    final isar = await _db;

    // `slug` is the key the stream endpoint is addressed by, so it must be the
    // real slug. It used to be set to `item.id`, which made every stored row
    // claim an address that resolves to nothing.
    final slug = item.slug.isNotEmpty ? item.slug : item.id;

    final meta = ContentMetaCollection()
      ..contentId = item.id
      ..slug = slug
      ..title = item.title
      ..contentType = item.type
      ..localFilePath = localFilePath
      ..fileSizeBytes = item.fileSizeBytes
      ..authorName = item.author
      ..downloadedAt = DateTime.now();

    await isar.writeTxn(() async {
      final file = File(localFilePath);
      if (item.type == 'AUDIO' || item.type == 'PDF' || item.type == 'IMAGE') {
        if (!await file.exists()) {
          throw StateError('Downloaded file does not exist: $localFilePath');
        }
        meta.fileSizeBytes = await file.length();
      }

      await isar.contentMetaCollections.putByContentId(meta);

      if (item.textContent != null && item.textContent!.isNotEmpty) {
        final textDoc = OfflineTextCollection()
          ..contentId = item.id
          ..slug = slug
          ..title = item.title
          ..body = item.textContent!
          ..locale = 'ar'
          ..cachedAt = DateTime.now();
        await isar.offlineTextCollections.putByContentId(textDoc);
      }
    });
  }

  @override
  Future<List<ContentMetaCollection>> getDownloadedList({String? type}) async {
    final isar = await _db;
    final candidates = (type == null || type == 'ALL')
        ? await isar.contentMetaCollections.where().sortByDownloadedAtDesc().findAll()
        : await isar.contentMetaCollections
            .filter()
            .contentTypeEqualTo(type)
            .sortByDownloadedAtDesc()
            .findAll();

    // The OS may remove app-support files without touching Isar. Never expose a
    // stale row as a usable offline download. Clean only stale file-backed rows;
    // TEXT content has no local file and remains valid through OfflineTextCollection.
    final staleIds = <String>[];
    final valid = <ContentMetaCollection>[];
    for (final item in candidates) {
      if (item.contentType == 'TEXT') {
        valid.add(item);
        continue;
      }
      final path = item.localFilePath?.trim();
      if (path != null && path.isNotEmpty && await File(path).exists()) {
        valid.add(item);
      } else {
        staleIds.add(item.contentId);
      }
    }

    if (staleIds.isNotEmpty) {
      await isar.writeTxn(() async {
        for (final id in staleIds) {
          await isar.contentMetaCollections.deleteByContentId(id);
          await isar.offlineTextCollections.deleteByContentId(id);
          await isar.downloadQueueCollections.deleteByContentId(id);
        }
      });
    }

    return valid;
  }

  @override
  Future<ContentMetaCollection?> getDownloadedItem(String contentId) async {
    final isar = await _db;
    return isar.contentMetaCollections.getByContentId(contentId);
  }

  @override
  Future<OfflineTextCollection?> getOfflineText(String contentId) async {
    final isar = await _db;
    return isar.offlineTextCollections.getByContentId(contentId);
  }

  @override
  Future<bool> deleteDownloadedContent(String contentId) async {
    final isar = await _db;
    final meta = await isar.contentMetaCollections.getByContentId(contentId);
    if (meta?.localFilePath case final path?) {
      final file = File(path);
      try {
        if (await file.exists()) await file.delete();
      } catch (_) {}
      final partial = File('$path.part');
      try {
        if (await partial.exists()) await partial.delete();
      } catch (_) {}
    }
    return isar.writeTxn(() async {
      final metaDeleted = await isar.contentMetaCollections.deleteByContentId(contentId);
      await isar.offlineTextCollections.deleteByContentId(contentId);
      await isar.downloadQueueCollections.deleteByContentId(contentId);
      return metaDeleted;
    });
  }

  @override
  Future<List<ContentMetaCollection>> searchOffline(String query) async {
    if (query.trim().isEmpty) {
      return getDownloadedList();
    }

    final isar = await _db;
    final normalizedQuery = ArabicTextNormalizer.normalize(query);

    // Fast FTS search across metadata and offline texts with normalized Arabic
    final matchingMetas = await isar.contentMetaCollections
        .filter()
        .titleContains(query, caseSensitive: false)
        .or()
        .titleContains(normalizedQuery, caseSensitive: false)
        .findAll();

    final matchingTexts = await isar.offlineTextCollections
        .filter()
        .bodyContains(query, caseSensitive: false)
        .or()
        .bodyContains(normalizedQuery, caseSensitive: false)
        .or()
        .titleContains(query, caseSensitive: false)
        .findAll();

    final contentIds = <String>{
      ...matchingMetas.map((m) => m.contentId),
      ...matchingTexts.map((t) => t.contentId),
    };

    final results = <ContentMetaCollection>[];
    final staleIds = <String>[];
    for (final id in contentIds) {
      final item = await isar.contentMetaCollections.getByContentId(id);
      if (item == null) continue;

      if (item.contentType == 'TEXT') {
        results.add(item);
        continue;
      }

      final path = item.localFilePath?.trim();
      if (path != null && path.isNotEmpty && await File(path).exists()) {
        results.add(item);
      } else {
        staleIds.add(id);
      }
    }

    if (staleIds.isNotEmpty) {
      await isar.writeTxn(() async {
        for (final id in staleIds) {
          await isar.contentMetaCollections.deleteByContentId(id);
          await isar.offlineTextCollections.deleteByContentId(id);
          await isar.downloadQueueCollections.deleteByContentId(id);
        }
      });
    }

    return results;
  }

  @override
  Future<int> getTotalStorageBytes() async {
    final isar = await _db;
    final allItems = await isar.contentMetaCollections.where().findAll();
    return allItems.fold<int>(0, (sum, item) => sum + (item.fileSizeBytes ?? 0));
  }
}
