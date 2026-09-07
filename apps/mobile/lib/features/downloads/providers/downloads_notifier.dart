import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:equatable/equatable.dart';
import '../../../core/storage/collections/content_meta_collection.dart';
import '../../../core/network/media_file_fetcher.dart';
import '../../content/data/repositories/content_repository.dart';
import '../../content/data/repositories/offline_content_repository.dart';
import '../../content/domain/models/content_item_model.dart';
import '../../content/providers/content_provider.dart';

class DownloadsState extends Equatable {
  final List<ContentMetaCollection> items;
  final bool isLoading;
  final String selectedType;
  final String searchQuery;
  final int totalStorageBytes;
  final String? message;

  const DownloadsState({
    this.items = const [],
    this.isLoading = false,
    this.selectedType = 'ALL',
    this.searchQuery = '',
    this.totalStorageBytes = 0,
    this.message,
  });

  DownloadsState copyWith({
    List<ContentMetaCollection>? items,
    bool? isLoading,
    String? selectedType,
    String? searchQuery,
    int? totalStorageBytes,
    String? message,
  }) {
    return DownloadsState(
      items: items ?? this.items,
      isLoading: isLoading ?? this.isLoading,
      selectedType: selectedType ?? this.selectedType,
      searchQuery: searchQuery ?? this.searchQuery,
      totalStorageBytes: totalStorageBytes ?? this.totalStorageBytes,
      message: message,
    );
  }

  @override
  List<Object?> get props => [
        items,
        isLoading,
        selectedType,
        searchQuery,
        totalStorageBytes,
        message,
      ];
}

class DownloadsNotifier extends StateNotifier<DownloadsState> {
  final IOfflineContentRepository repository;
  final IContentRepository contentRepository;
  final MediaFileFetcher fileFetcher;

  DownloadsNotifier({
    required this.repository,
    required this.contentRepository,
    required this.fileFetcher,
  })
      : super(const DownloadsState()) {
    loadDownloads();
  }

  Future<void> loadDownloads() async {
    state = state.copyWith(isLoading: true);
    try {
      final items = await repository.getDownloadedList(type: state.selectedType);
      final totalBytes = await repository.getTotalStorageBytes();
      state = state.copyWith(
        items: items,
        totalStorageBytes: totalBytes,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        message: 'تعذر تحميل قائمة المحفوظات: ${e.toString()}',
      );
    }
  }

  void setFilterType(String type) {
    state = state.copyWith(selectedType: type);
    if (state.searchQuery.isNotEmpty) {
      search(state.searchQuery);
    } else {
      loadDownloads();
    }
  }

  Future<void> search(String query) async {
    final normalizedQuery = query.trim();
    if (normalizedQuery.isEmpty) {
      state = state.copyWith(searchQuery: '', isLoading: true);
      await loadDownloads();
      return;
    }

    state = state.copyWith(searchQuery: normalizedQuery, isLoading: true);
    try {
      final results = await repository.searchOffline(normalizedQuery);
      final filtered = state.selectedType == 'ALL'
          ? results
          : results.where((item) => item.contentType == state.selectedType).toList();

      state = state.copyWith(
        items: filtered,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        message: 'حدث خطأ أثناء البحث: ${e.toString()}',
      );
    }
  }

  Future<void> saveDownloadedContent({
    required ContentItemModel item,
    required String localFilePath,
  }) async {
    await repository.saveDownloadedContent(
      item: item,
      localFilePath: localFilePath,
    );
    await loadDownloads();
  }


  Future<void> downloadContent(
    ContentItemModel item, {
    void Function(int received, int total)? onProgress,
  }) async {
    if (item.id.trim().isEmpty) {
      throw StateError('Cannot download an item without an id');
    }

    final dir = await getApplicationSupportDirectory();
    final downloadsDir = Directory('${dir.path}/downloads');
    await downloadsDir.create(recursive: true);

    final ext = switch (item.type) {
      'AUDIO' => '.mp3',
      'PDF' => '.pdf',
      'IMAGE' => '.img',
      _ => '.bin',
    };
    final safeId = item.id.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    final targetPath = '${downloadsDir.path}/$safeId$ext';

    if (item.type == 'TEXT') {
      if ((item.textContent ?? '').trim().isEmpty) {
        throw StateError('Text content is unavailable for offline storage');
      }
      await repository.saveDownloadedContent(item: item, localFilePath: '');
      return;
    }

    final stream = item.type == 'AUDIO' || item.type == 'PDF'
        ? await contentRepository.getMediaStreamUrl(item.slug.isNotEmpty ? item.slug : item.id)
        : null;
    final url = stream?.url ?? item.url;
    if (url.trim().isEmpty) {
      throw StateError('No downloadable URL was provided by the server');
    }

    await fileFetcher.downloadToFile(
      url,
      targetPath: targetPath,
      expectedSize: stream?.sizeBytes ?? (item.fileSizeBytes > 0 ? item.fileSizeBytes : null),
      onProgress: onProgress,
    );

    await repository.saveDownloadedContent(item: item, localFilePath: targetPath);
  }

  Future<void> deleteItem(String contentId) async {
    await repository.deleteDownloadedContent(contentId);
    await loadDownloads();
  }
}

final offlineContentRepositoryProvider = Provider<IOfflineContentRepository>((ref) {
  return OfflineContentRepository();
});

final downloadsNotifierProvider =
    StateNotifierProvider<DownloadsNotifier, DownloadsState>((ref) {
  return DownloadsNotifier(
    repository: ref.watch(offlineContentRepositoryProvider),
    contentRepository: ref.watch(contentRepositoryProvider),
    fileFetcher: ref.watch(mediaFileFetcherProvider),
  );
});
