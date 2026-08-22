import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:mobile/core/storage/collections/content_meta_collection.dart';
import 'package:mobile/features/content/data/repositories/offline_content_repository.dart';
import 'package:mobile/features/downloads/providers/downloads_notifier.dart';

class MockOfflineContentRepository extends Mock implements IOfflineContentRepository {}

void main() {
  late MockOfflineContentRepository mockRepo;

  final sampleItem = ContentMetaCollection()
    ..contentId = 'audio-1'
    ..slug = 'audio-1'
    ..title = 'شرح ثلاثة الأصول'
    ..contentType = 'AUDIO'
    ..localFilePath = '/data/audio-1.mp3'
    ..fileSizeBytes = 10485760 // 10 MB
    ..downloadedAt = DateTime.now();

  setUp(() {
    mockRepo = MockOfflineContentRepository();
  });

  group('DownloadsNotifier Unit Tests', () {
    test('initial state loads downloaded items from repository', () async {
      when(() => mockRepo.getDownloadedList(type: 'ALL')).thenAnswer((_) async => [sampleItem]);
      when(() => mockRepo.getTotalStorageBytes()).thenAnswer((_) async => 10485760);

      final notifier = DownloadsNotifier(repository: mockRepo);
      await notifier.loadDownloads();

      expect(notifier.state.items.length, 1);
      expect(notifier.state.items.first.title, 'شرح ثلاثة الأصول');
      expect(notifier.state.totalStorageBytes, 10485760);
      expect(notifier.state.isLoading, false);
    });

    test('setFilterType updates selectedType and reloads items', () async {
      when(() => mockRepo.getDownloadedList(type: 'AUDIO')).thenAnswer((_) async => [sampleItem]);
      when(() => mockRepo.getTotalStorageBytes()).thenAnswer((_) async => 10485760);

      final notifier = DownloadsNotifier(repository: mockRepo);
      notifier.setFilterType('AUDIO');

      expect(notifier.state.selectedType, 'AUDIO');
    });

    test('search filters offline items with search query', () async {
      when(() => mockRepo.getDownloadedList(type: 'ALL')).thenAnswer((_) async => [sampleItem]);
      when(() => mockRepo.getTotalStorageBytes()).thenAnswer((_) async => 10485760);
      when(() => mockRepo.searchOffline('الأصول')).thenAnswer((_) async => [sampleItem]);

      final notifier = DownloadsNotifier(repository: mockRepo);
      await notifier.search('الأصول');

      expect(notifier.state.searchQuery, 'الأصول');
      expect(notifier.state.items.length, 1);
    });

    test('deleteItem calls repository delete and reloads state', () async {
      when(() => mockRepo.deleteDownloadedContent('audio-1')).thenAnswer((_) async => true);
      when(() => mockRepo.getDownloadedList(type: 'ALL')).thenAnswer((_) async => []);
      when(() => mockRepo.getTotalStorageBytes()).thenAnswer((_) async => 0);

      final notifier = DownloadsNotifier(repository: mockRepo);
      await notifier.deleteItem('audio-1');

      verify(() => mockRepo.deleteDownloadedContent('audio-1')).called(1);
      expect(notifier.state.items.isEmpty, isTrue);
      expect(notifier.state.totalStorageBytes, 0);
    });
  });
}
