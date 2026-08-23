import 'package:isar/isar.dart';
import '../../../../core/storage/collections/content_meta_collection.dart';
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
    if (type == null || type == 'ALL') {
      return isar.contentMetaCollections.where().sortByDownloadedAtDesc().findAll();
    }
    return isar.contentMetaCollections
        .filter()
        .contentTypeEqualTo(type)
        .sortByDownloadedAtDesc()
        .findAll();
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
    return isar.writeTxn(() async {
      final metaDeleted = await isar.contentMetaCollections.deleteByContentId(contentId);
      await isar.offlineTextCollections.deleteByContentId(contentId);
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
    for (final id in contentIds) {
      final item = await isar.contentMetaCollections.getByContentId(id);
      if (item != null) {
        results.add(item);
      }
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
