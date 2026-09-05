import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../content/domain/models/content_item_model.dart';
import '../../content/providers/content_provider.dart';
import '../../downloads/providers/downloads_notifier.dart';

class AudioCatalogScreen extends ConsumerStatefulWidget {
  const AudioCatalogScreen({super.key});

  @override
  ConsumerState<AudioCatalogScreen> createState() => _AudioCatalogScreenState();
}

class _AudioCatalogScreenState extends ConsumerState<AudioCatalogScreen> {
  final _searchController = TextEditingController();
  String _selectedCategory = 'ALL';

  List<ContentItemModel> _audioItems = const [];
  bool _isLoading = true;
  String? _errorMessage;

  List<String> get _categories {
    final values = _audioItems.map((e) => e.category).whereType<String>().where((e) => e.isNotEmpty).toSet().toList()..sort();
    return ['ALL', ...values];
  }


  @override
  void initState() {
    super.initState();
    _loadContent();
  }

  Future<void> _loadContent() async {
    try {
      final result = await ref.read(contentRepositoryProvider).getContentList(
        type: AppConstants.typeAudio,
        limit: 100,
        locale: 'ar',
      );
      if (!mounted) return;
      setState(() {
        _audioItems = result.items;
        _isLoading = false;
        _errorMessage = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _errorMessage = 'تعذر تحميل الصوتيات من الخادم';
      });
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  String _formatDuration(int? seconds) {
    if (seconds == null || seconds <= 0) return '00:00';
    final mins = seconds ~/ 60;
    final hrs = mins ~/ 60;
    final remainingMins = mins % 60;
    if (hrs > 0) {
      return '$hrs ساعة و $remainingMins دقيقة';
    }
    return '$mins دقيقة';
  }

  List<ContentItemModel> get _filteredItems {
    return _audioItems.where((item) {
      final matchesCategory = _selectedCategory == 'ALL' || item.category == _selectedCategory;
      final query = _searchController.text.trim().toLowerCase();
      final matchesSearch = query.isEmpty ||
          item.title.toLowerCase().contains(query) ||
          item.description.toLowerCase().contains(query);
      return matchesCategory && matchesSearch;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filteredItems;

    return Scaffold(
      appBar: AppBar(
        title: const Text('الصوتيات والدروس'),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _errorMessage != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.error_outline_rounded, size: 48),
                      const SizedBox(height: 12),
                      Text(_errorMessage!),
                      const SizedBox(height: 12),
                      ElevatedButton(onPressed: _loadContent, child: const Text('إعادة المحاولة')),
                    ],
                  ),
                )
              : Column(
        children: [
          // Search Field
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'البحث في الصوتيات والدروس...',
                prefixIcon: const Icon(Icons.search_rounded, color: AppColors.primary),
                suffixIcon: _searchController.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear_rounded),
                        onPressed: () {
                          setState(() {
                            _searchController.clear();
                          });
                        },
                      )
                    : null,
              ),
              onChanged: (_) => setState(() {}),
            ),
          ),

          // Category Filter Chips (Strictly ct_categories)
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            child: Row(
              children: _categories.map((cat) {
                final isSelected = _selectedCategory == cat;
                final label = cat == 'ALL' ? 'جميع التصنيفات' : cat;
                return Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: ChoiceChip(
                    label: Text(label),
                    selected: isSelected,
                    selectedColor: AppColors.primary,
                    backgroundColor: Colors.transparent,
                    labelStyle: AppTypography.bodySmall.copyWith(
                      color: isSelected ? Colors.white : Theme.of(context).colorScheme.onSurface,
                      fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                    ),
                    onSelected: (selected) {
                      if (selected) {
                        setState(() {
                          _selectedCategory = cat;
                        });
                      }
                    },
                  ),
                );
              }).toList(),
            ),
          ),
          const SizedBox(height: 8),

          // Count & Category Indicator
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'المواد الصوتية المتاحة (${filtered.length})',
                  style: AppTypography.titleSmall.copyWith(fontWeight: FontWeight.bold),
                ),
                if (_selectedCategory != 'ALL')
                  Chip(
                    label: Text(_selectedCategory),
                    deleteIcon: const Icon(Icons.close, size: 16),
                    onDeleted: () {
                      setState(() {
                        _selectedCategory = 'ALL';
                      });
                    },
                  ),
              ],
            ),
          ),

          // Audio List
          Expanded(
            child: filtered.isEmpty
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.headphones_rounded,
                          size: 64,
                          color: AppColors.textSecondaryLight.withAlpha(80),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          'لا توجد مواد صوتية مطابقة',
                          style: AppTypography.titleSmall.copyWith(
                            color: AppColors.textSecondaryLight,
                          ),
                        ),
                      ],
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    itemCount: filtered.length,
                    itemBuilder: (ctx, idx) {
                      final item = filtered[idx];
                      return Card(
                        margin: const EdgeInsets.only(bottom: 12),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(16),
                          onTap: () {
                            context.push('/viewer/audio', extra: item);
                          },
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Row(
                              children: [
                                // Audio Play Button / Icon Capsule
                                Container(
                                  width: 48,
                                  height: 48,
                                  decoration: BoxDecoration(
                                    color: AppColors.primary.withAlpha(25),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: const Icon(
                                    Icons.play_arrow_rounded,
                                    color: AppColors.primary,
                                    size: 28,
                                  ),
                                ),
                                const SizedBox(width: 14),

                                // Title, Author, Category & Duration
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        item.title,
                                        style: AppTypography.titleSmall.copyWith(
                                          fontWeight: FontWeight.bold,
                                        ),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        '${item.author} · ${item.category ?? 'عام'}',
                                        style: AppTypography.bodySmall.copyWith(
                                          color: AppColors.textSecondaryLight,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Row(
                                        children: [
                                          const Icon(
                                            Icons.access_time_rounded,
                                            size: 14,
                                            color: AppColors.secondary,
                                          ),
                                          const SizedBox(width: 4),
                                          Text(
                                            _formatDuration(item.durationSeconds),
                                            style: AppTypography.bodySmall.copyWith(
                                              color: AppColors.secondary,
                                              fontSize: 11,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  ),
                                ),

                                // Download Action
                                IconButton(
                                  icon: const Icon(
                                    Icons.download_for_offline_outlined,
                                    color: AppColors.primary,
                                  ),
                                  tooltip: 'التنزيل للاستماع بدون إنترنت',
                                  onPressed: item.slug.isEmpty ? null : () async {
                                    final messenger = ScaffoldMessenger.of(context);
                                    messenger.showSnackBar(const SnackBar(content: Text('جاري تنزيل المادة…')));
                                    try {
                                      await ref.read(downloadsNotifierProvider.notifier).downloadContent(item);
                                      if (!context.mounted) return;
                                      messenger.showSnackBar(const SnackBar(content: Text('تم حفظ المادة بنجاح للاستخدام بدون إنترنت')));
                                    } catch (error) {
                                      if (!context.mounted) return;
                                      messenger.showSnackBar(SnackBar(content: Text('فشل التنزيل: $error')));
                                    }
                                  },
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
