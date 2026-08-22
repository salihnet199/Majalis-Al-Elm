import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:equatable/equatable.dart';
import '../../../core/storage/collections/content_meta_collection.dart';
import '../../content/data/repositories/offline_content_repository.dart';
import '../../content/domain/models/content_item_model.dart';

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

  DownloadsNotifier({required this.repository})
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
    state = state.copyWith(searchQuery: query, isLoading: true);
    try {
      final results = await repository.searchOffline(query);
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
  final repo = ref.watch(offlineContentRepositoryProvider);
  return DownloadsNotifier(repository: repo);
});
