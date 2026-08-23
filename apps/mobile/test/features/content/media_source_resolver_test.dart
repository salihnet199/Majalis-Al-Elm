import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/constants/app_constants.dart';
import 'package:mobile/core/network/error_handler.dart';
import 'package:mobile/core/storage/collections/content_meta_collection.dart';
import 'package:mobile/core/storage/collections/offline_text_collection.dart';
import 'package:mobile/features/content/data/repositories/content_repository.dart';
import 'package:mobile/features/content/data/repositories/offline_content_repository.dart';
import 'package:mobile/features/content/domain/models/category_model.dart';
import 'package:mobile/features/content/domain/models/content_item_model.dart';
import 'package:mobile/features/content/domain/models/media_stream_model.dart';
import 'package:mobile/features/content/domain/models/tag_model.dart';
import 'package:mobile/features/content/providers/media_source_provider.dart';
import 'package:mocktail/mocktail.dart';

class _MockContentRepository extends Mock implements IContentRepository {}

class _MockOfflineRepository extends Mock implements IOfflineContentRepository {}

/// A stand-in that fails loudly if the resolver ever reaches the network for a
/// case that must not. Used where a mock's "return null by default" would hide a
/// wrong call.
class _NeverCalledContentRepository implements IContentRepository {
  @override
  Future<MediaStreamModel> getMediaStreamUrl(String slug) {
    fail('getMediaStreamUrl must not be called (slug: "$slug")');
  }

  @override
  Future<List<CategoryModel>> getCategories({String locale = 'ar'}) => fail('unexpected');

  @override
  Future<ContentItemModel> getContentBySlug(String slug, {String locale = 'ar'}) =>
      fail('unexpected');

  @override
  Future<ContentListResult> getContentList({
    String? type,
    String? category,
    String? cursor,
    int limit = 20,
    String locale = 'ar',
  }) =>
      fail('unexpected');

  @override
  Future<List<TagModel>> getTags({String locale = 'ar'}) => fail('unexpected');
}

class _NoDownloadsRepository implements IOfflineContentRepository {
  @override
  Future<ContentMetaCollection?> getDownloadedItem(String contentId) async => null;

  @override
  Future<bool> deleteDownloadedContent(String contentId) => fail('unexpected');

  @override
  Future<List<ContentMetaCollection>> getDownloadedList({String? type}) => fail('unexpected');

  @override
  Future<OfflineTextCollection?> getOfflineText(String contentId) => fail('unexpected');

  @override
  Future<int> getTotalStorageBytes() => fail('unexpected');

  @override
  Future<void> saveDownloadedContent({
    required ContentItemModel item,
    required String localFilePath,
  }) =>
      fail('unexpected');

  @override
  Future<List<ContentMetaCollection>> searchOffline(String query) => fail('unexpected');
}

ContentMetaCollection _row({required String contentId, String? localFilePath}) {
  return ContentMetaCollection()
    ..contentId = contentId
    ..slug = contentId
    ..contentType = AppConstants.typeAudio
    ..title = 'مادة محفوظة'
    ..localFilePath = localFilePath;
}

void main() {
  const audioItem = ContentItemModel(
    id: '0198f000-0000-7000-8000-000000000001',
    slug: 'sharh-thalathat-al-usul',
    title: 'شرح ثلاثة الأصول',
    description: 'شرح صوتي',
    type: AppConstants.typeAudio,
    url: 'https://cdn.example.com/thumbnails/audio.jpg',
    author: 'فضيلة الشيخ',
  );

  final streamModel = MediaStreamModel(
    url: 'https://storage.example.com/media/audio.mp3?X-Amz-Signature=abc',
    expiresAt: DateTime.utc(2026, 8, 23, 12),
    mimeType: 'audio/mpeg',
    sizeBytes: 4096,
  );

  setUpAll(() {
    registerFallbackValue(audioItem);
  });

  group('MediaSourceResolver — local file', () {
    test('uses the downloaded file when it really exists on disk', () async {
      final offline = _MockOfflineRepository();
      when(() => offline.getDownloadedItem(audioItem.id))
          .thenAnswer((_) async => _row(contentId: audioItem.id, localFilePath: '/tmp/audio.mp3'));

      final resolver = MediaSourceResolver(
        // A network call here would mean a spent signature and a failed offline
        // playback, so reaching it is a test failure, not a fallback.
        content: _NeverCalledContentRepository(),
        offline: offline,
        fileExists: (path) async => path == '/tmp/audio.mp3',
      );

      final source = await resolver.resolve(audioItem);

      expect(source, isA<LocalFileMediaSource>());
      expect((source as LocalFileMediaSource).path, '/tmp/audio.mp3');
    });

    test('falls through to the network when the row outlived the file', () async {
      // The Isar row survives OS cache eviction, manual deletion, and restore to a
      // new device. Treating it as a playable file is the fabricated-readiness
      // failure POLICY-SEC-001 forbids, so the file itself must be checked.
      final offline = _MockOfflineRepository();
      when(() => offline.getDownloadedItem(audioItem.id)).thenAnswer(
        (_) async => _row(contentId: audioItem.id, localFilePath: '/tmp/deleted.mp3'),
      );

      final content = _MockContentRepository();
      when(() => content.getMediaStreamUrl(audioItem.slug)).thenAnswer((_) async => streamModel);

      final resolver = MediaSourceResolver(
        content: content,
        offline: offline,
        fileExists: (_) async => false,
      );

      final source = await resolver.resolve(audioItem);

      expect(source, isA<RemoteMediaSource>());
      expect((source as RemoteMediaSource).url, streamModel.url);
      verify(() => content.getMediaStreamUrl(audioItem.slug)).called(1);
    });

    test('falls through to the network when the row stores a blank path', () async {
      final offline = _MockOfflineRepository();
      when(() => offline.getDownloadedItem(audioItem.id))
          .thenAnswer((_) async => _row(contentId: audioItem.id, localFilePath: '   '));

      final content = _MockContentRepository();
      when(() => content.getMediaStreamUrl(any())).thenAnswer((_) async => streamModel);

      final resolver = MediaSourceResolver(
        content: content,
        offline: offline,
        // A blank path must be rejected before any filesystem question is asked.
        fileExists: (path) => fail('fileExists must not be asked about "$path"'),
      );

      expect(await resolver.resolve(audioItem), isA<RemoteMediaSource>());
    });
  });

  group('MediaSourceResolver — presigned stream', () {
    test('requests the stream by slug, never by id, when a slug exists', () async {
      final content = _MockContentRepository();
      when(() => content.getMediaStreamUrl(any())).thenAnswer((_) async => streamModel);

      final resolver = MediaSourceResolver(
        content: content,
        offline: _NoDownloadsRepository(),
        fileExists: (_) async => false,
      );

      await resolver.resolve(audioItem);

      // `GET /content/:slug/media/stream` is addressed by slug; sending the UUID
      // answers 404, which reads as "the file is missing".
      verify(() => content.getMediaStreamUrl('sharh-thalathat-al-usul')).called(1);
      verifyNever(() => content.getMediaStreamUrl(audioItem.id));
    });

    test('falls back to the id only when the item carries no slug', () async {
      final content = _MockContentRepository();
      when(() => content.getMediaStreamUrl(any())).thenAnswer((_) async => streamModel);

      final resolver = MediaSourceResolver(
        content: content,
        offline: _NoDownloadsRepository(),
        fileExists: (_) async => false,
      );

      const noSlug = ContentItemModel(
        id: 'legacy-id',
        slug: '',
        title: 'مادة قديمة',
        description: '',
        type: AppConstants.typePdf,
        url: '',
        author: 'مؤلف',
      );

      await resolver.resolve(noSlug);

      verify(() => content.getMediaStreamUrl('legacy-id')).called(1);
    });

    test('propagates the server failure instead of returning a placeholder', () async {
      // 409 MEDIA_NOT_AVAILABLE is the honest answer for an asset whose
      // upload_status is not COMPLETED. It must reach the UI as an error; there is
      // no empty URL and no fall back to the CDN thumbnail.
      final content = _MockContentRepository();
      when(() => content.getMediaStreamUrl(any())).thenThrow(
        const AppException(
          code: 'MEDIA_NOT_AVAILABLE',
          message: 'الملف غير متاح للتشغيل بعد',
        ),
      );

      final resolver = MediaSourceResolver(
        content: content,
        offline: _NoDownloadsRepository(),
        fileExists: (_) async => false,
      );

      await expectLater(
        resolver.resolve(audioItem),
        throwsA(isA<AppException>().having((e) => e.code, 'code', 'MEDIA_NOT_AVAILABLE')),
      );
    });
  });

  group('MediaSourceResolver — unsupported types', () {
    test('rejects TEXT without asking any repository', () async {
      const textItem = ContentItemModel(
        id: 'text-1',
        slug: 'fatwa-1',
        title: 'فتوى',
        description: '',
        type: AppConstants.typeText,
        url: '',
        author: 'مفتي',
      );

      final resolver = MediaSourceResolver(
        content: _NeverCalledContentRepository(),
        offline: _NoDownloadsRepository(),
        fileExists: (_) async => false,
      );

      await expectLater(
        resolver.resolve(textItem),
        throwsA(isA<AppException>().having((e) => e.code, 'code', 'MEDIA_TYPE_UNSUPPORTED')),
      );
    });
  });

  group('MediaStreamModel', () {
    test('rejects a response with no url rather than yielding a blank one', () {
      expect(MediaStreamModel.tryParse(<String, dynamic>{'mimeType': 'audio/mpeg'}), isNull);
      expect(MediaStreamModel.tryParse(<String, dynamic>{'url': ''}), isNull);
      expect(MediaStreamModel.tryParse(null), isNull);
      expect(MediaStreamModel.tryParse('not a map'), isNull);
    });

    test('parses a full payload', () {
      final parsed = MediaStreamModel.tryParse(<String, dynamic>{
        'url': 'https://storage.example.com/x?sig=1',
        'expiresAt': '2026-08-23T12:00:00.000Z',
        'expiresInSeconds': 3600,
        'mimeType': 'audio/mpeg',
        'sizeBytes': 4096,
      });

      expect(parsed, isNotNull);
      expect(parsed!.url, 'https://storage.example.com/x?sig=1');
      expect(parsed.expiresAt, DateTime.utc(2026, 8, 23, 12));
      expect(parsed.mimeType, 'audio/mpeg');
      expect(parsed.sizeBytes, 4096);
    });

    test('treats an elapsed expiry as expired, with a safety margin', () {
      final stream = MediaStreamModel(url: 'https://x', expiresAt: DateTime.utc(2026, 8, 23, 12));

      expect(stream.isExpired(now: DateTime.utc(2026, 8, 23, 11, 30)), isFalse);
      expect(stream.isExpired(now: DateTime.utc(2026, 8, 23, 12, 0, 1)), isTrue);
      // Within the margin: a URL about to expire must not be handed to a player.
      expect(stream.isExpired(now: DateTime.utc(2026, 8, 23, 11, 59, 50)), isTrue);
    });

    test('an unknown expiry is not reported as expired', () {
      const stream = MediaStreamModel(url: 'https://x');
      expect(stream.isExpired(now: DateTime.utc(2030)), isFalse);
    });
  });
}
