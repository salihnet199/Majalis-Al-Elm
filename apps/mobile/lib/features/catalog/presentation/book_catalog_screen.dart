import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../content/domain/models/content_item_model.dart';
import '../../content/providers/content_provider.dart';
import '../../downloads/providers/downloads_notifier.dart';

class BookCatalogScreen extends ConsumerStatefulWidget {
  const BookCatalogScreen({super.key});

  @override
  ConsumerState<BookCatalogScreen> createState() => _BookCatalogScreenState();
}

class _BookCatalogScreenState extends ConsumerState<BookCatalogScreen> {
  final _searchController = TextEditingController();
  String _selectedCategory = 'ALL';
  String _selectedAuthor = 'ALL';

  List<ContentItemModel> _bookItems = const [];
  bool _isLoading = true;
  String? _errorMessage;

  List<String> get _categories {
    final values = _bookItems.map((e) => e.category).whereType<String>().where((e) => e.isNotEmpty).toSet().toList()..sort();
    return ['ALL', ...values];
  }

  List<String> get _authors {
    final values = _bookItems.map((e) => e.author).where((e) => e.isNotEmpty).toSet().toList()..sort();
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
        type: AppConstants.typePdf,
        limit: 100,
        locale: 'ar',
      );
      if (!mounted) return;
      setState(() {
        _bookItems = result.items;
        _isLoading = false;
        _errorMessage = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _errorMessage = 'تعذر تحميل الكتب من الخادم';
      });
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  String _formatBytes(int? bytes) {
    if (bytes == null || bytes <= 0) return '';
    final mb = bytes / (1024 * 1024);
    return '${mb.toStringAsFixed(1)} ميجابايت';
  }

  List<ContentItemModel> get _filteredItems {
    return _bookItems.where((item) {
      final matchesCategory = _selectedCategory == 'ALL' || item.category == _selectedCategory;
      final matchesAuthor = _selectedAuthor == 'ALL' || item.author == _selectedAuthor;
      final query = _searchController.text.trim().toLowerCase();
      final matchesSearch = query.isEmpty ||
          item.title.toLowerCase().contains(query) ||
          item.description.toLowerCase().contains(query) ||
          item.author.toLowerCase().contains(query);
      return matchesCategory && matchesAuthor && matchesSearch;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filteredItems;

    return Scaffold(
      appBar: AppBar(
        title: const Text('مكتبة الكتب و PDF'),
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
                hintText: 'البحث في عناوين الكتب والمؤلفين...',
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

          // Category Filters (ct_categories)
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
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

          // Author Dropdown Filter (ct_authors)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              decoration: BoxDecoration(
                border: Border.all(color: Theme.of(context).dividerColor),
                borderRadius: BorderRadius.circular(12),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  isExpanded: true,
                  value: _selectedAuthor,
                  icon: const Icon(Icons.person_search_rounded, color: AppColors.primary),
                  items: _authors.map((author) {
                    return DropdownMenuItem<String>(
                      value: author,
                      child: Text(
                        author == 'ALL' ? 'تصفية حسب المؤلف (الكل)' : author,
                        style: AppTypography.bodySmall,
                        overflow: TextOverflow.ellipsis,
                      ),
                    );
                  }).toList(),
                  onChanged: (val) {
                    if (val != null) {
                      setState(() {
                        _selectedAuthor = val;
                      });
                    }
                  },
                ),
              ),
            ),
          ),
          const SizedBox(height: 6),

          // Header count
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'الكتب المنشورة (${filtered.length})',
                  style: AppTypography.titleSmall.copyWith(fontWeight: FontWeight.bold),
                ),
              ],
            ),
          ),

          // Books List
          Expanded(
            child: filtered.isEmpty
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.menu_book_rounded,
                          size: 64,
                          color: AppColors.textSecondaryLight.withAlpha(80),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          'لا توجد كتب مطابقة لخيارات البحث',
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
                            context.push('/viewer/pdf', extra: item);
                          },
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                // Book Icon Capsule
                                Container(
                                  width: 48,
                                  height: 60,
                                  decoration: BoxDecoration(
                                    color: AppColors.primary.withAlpha(20),
                                    borderRadius: BorderRadius.circular(10),
                                    border: Border.all(color: AppColors.primary.withAlpha(50)),
                                  ),
                                  child: const Icon(
                                    Icons.picture_as_pdf_rounded,
                                    color: AppColors.primary,
                                    size: 30,
                                  ),
                                ),
                                const SizedBox(width: 14),

                                // Title, Author, Pages & Size
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
                                        item.author,
                                        style: AppTypography.bodySmall.copyWith(
                                          color: AppColors.textSecondaryLight,
                                        ),
                                      ),
                                      const SizedBox(height: 6),
                                      Row(
                                        children: [
                                          Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                            decoration: BoxDecoration(
                                              color: AppColors.secondary.withAlpha(25),
                                              borderRadius: BorderRadius.circular(6),
                                            ),
                                            child: Text(
                                              '${item.pageCount ?? 0} صفحة',
                                              style: AppTypography.bodySmall.copyWith(
                                                color: AppColors.secondary,
                                                fontSize: 11,
                                                fontWeight: FontWeight.bold,
                                              ),
                                            ),
                                          ),
                                          const SizedBox(width: 8),
                                          Text(
                                            _formatBytes(item.fileSizeBytes),
                                            style: AppTypography.bodySmall.copyWith(
                                              color: AppColors.textSecondaryLight,
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
                                  tooltip: 'التنزيل للقراءة بدون إنترنت',
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
