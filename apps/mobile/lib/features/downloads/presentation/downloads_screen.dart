import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/localization/app_localizations.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../content/domain/models/content_item_model.dart';
import '../providers/downloads_notifier.dart';

class DownloadsScreen extends ConsumerStatefulWidget {
  const DownloadsScreen({super.key});

  @override
  ConsumerState<DownloadsScreen> createState() => _DownloadsScreenState();
}

class _DownloadsScreenState extends ConsumerState<DownloadsScreen> {
  final _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  String _formatBytes(int bytes) {
    if (bytes <= 0) return '0 كيلوبايت';
    final kb = bytes / 1024;
    if (kb < 1024) return '${kb.toStringAsFixed(1)} كيلوبايت';
    final mb = kb / 1024;
    return '${mb.toStringAsFixed(1)} ميجابايت';
  }

  void _openDownloadedItem(BuildContext context, dynamic item) {
    final contentModel = ContentItemModel(
      id: item.contentId,
      title: item.title,
      description: 'مادة محفوظة محلياً للقراءة والاستماع بدون إنترنت',
      type: item.contentType,
      url: item.localFilePath,
      author: AppConstants.sheikhName,
      fileSizeBytes: item.fileSizeBytes,
      isDownloaded: true,
    );

    switch (item.contentType) {
      case AppConstants.typeAudio:
        context.push('/viewer/audio', extra: contentModel);
        break;
      case AppConstants.typePdf:
        context.push('/viewer/pdf', extra: contentModel);
        break;
      case AppConstants.typeText:
        context.push('/viewer/article', extra: contentModel);
        break;
      case AppConstants.typeImage:
        context.push('/viewer/image', extra: contentModel);
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final downloadsState = ref.watch(downloadsNotifierProvider);
    final notifier = ref.read(downloadsNotifierProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.navDownloads),
      ),
      body: Column(
        children: [
          // Storage Summary Banner
          Container(
            margin: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              color: AppColors.primary.withAlpha(18),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.primary.withAlpha(40)),
            ),
            child: Row(
              children: [
                const Icon(Icons.sd_storage_rounded, color: AppColors.primary, size: 26),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'المساحة المستخدمة بدون إنترنت',
                        style: AppTypography.bodySmall.copyWith(
                          color: AppColors.textSecondaryLight,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _formatBytes(downloadsState.totalStorageBytes),
                        style: AppTypography.titleSmall.copyWith(
                          fontWeight: FontWeight.bold,
                          color: AppColors.primary,
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.primary,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    '${downloadsState.items.length} مواد',
                    style: AppTypography.bodySmall.copyWith(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
          ),

          // Offline Search Field
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'البحث في المواد المحفوظة بدون إنترنت...',
                prefixIcon: const Icon(Icons.search_rounded, color: AppColors.primary),
                suffixIcon: _searchController.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear_rounded),
                        onPressed: () {
                          _searchController.clear();
                          notifier.search('');
                        },
                      )
                    : null,
              ),
              onChanged: (val) => notifier.search(val),
            ),
          ),

          // Filter Chips
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            child: Row(
              children: [
                _buildFilterChip('الكل', 'ALL', downloadsState.selectedType, notifier),
                const SizedBox(width: 8),
                _buildFilterChip('صوتيات', AppConstants.typeAudio, downloadsState.selectedType, notifier, icon: Icons.headphones_rounded),
                const SizedBox(width: 8),
                _buildFilterChip('كتب و PDF', AppConstants.typePdf, downloadsState.selectedType, notifier, icon: Icons.picture_as_pdf_rounded),
                const SizedBox(width: 8),
                _buildFilterChip('مقالات', AppConstants.typeText, downloadsState.selectedType, notifier, icon: Icons.article_rounded),
                const SizedBox(width: 8),
                _buildFilterChip('صور', AppConstants.typeImage, downloadsState.selectedType, notifier, icon: Icons.image_rounded),
              ],
            ),
          ),
          const SizedBox(height: 8),

          // Content List / Empty State
          Expanded(
            child: downloadsState.isLoading
                ? const Center(child: CircularProgressIndicator())
                : downloadsState.items.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.download_done_rounded,
                              size: 64,
                              color: AppColors.textSecondaryLight.withAlpha(80),
                            ),
                            const SizedBox(height: 16),
                            Text(
                              'لا توجد مواد محفوظة في هذا القسم',
                              style: AppTypography.titleSmall.copyWith(
                                color: AppColors.textSecondaryLight,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              'يمكنك تنزيل المواد من الشاشة الرئيسية لتصفحها بدون إنترنت',
                              style: AppTypography.bodySmall.copyWith(
                                color: AppColors.textSecondaryLight,
                              ),
                            ),
                          ],
                        ),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        itemCount: downloadsState.items.length,
                        itemBuilder: (ctx, idx) {
                          final item = downloadsState.items[idx];
                          final icon = _getIconForType(item.contentType);
                          return Card(
                            margin: const EdgeInsets.only(bottom: 10),
                            child: ListTile(
                              leading: Container(
                                width: 44,
                                height: 44,
                                decoration: BoxDecoration(
                                  color: AppColors.primary.withAlpha(20),
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Icon(icon, color: AppColors.primary, size: 22),
                              ),
                              title: Text(
                                item.title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: AppTypography.titleSmall,
                              ),
                              subtitle: Text(
                                '${_formatBytes(item.fileSizeBytes ?? 0)} · متاح بدون إنترنت',
                                style: AppTypography.bodySmall.copyWith(color: AppColors.textSecondaryLight),
                              ),
                              trailing: IconButton(
                                icon: const Icon(Icons.delete_outline_rounded, color: AppColors.error),
                                tooltip: l10n.delete,
                                onPressed: () => _confirmDelete(context, notifier, item.contentId, item.title),
                              ),
                              onTap: () => _openDownloadedItem(context, item),
                            ),
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }

  void _confirmDelete(BuildContext context, DownloadsNotifier notifier, String contentId, String title) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('حذف من المحفوظات'),
        content: Text('هل أنت متأكد من رغبتك في حذف "$title" من التنزيلات المحلية؟'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('إلغاء'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.error,
              foregroundColor: Colors.white,
            ),
            onPressed: () {
              Navigator.of(ctx).pop();
              notifier.deleteItem(contentId);
            },
            child: const Text('حذف'),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String label, String type, String selectedType, DownloadsNotifier notifier, {IconData? icon}) {
    final isSelected = selectedType == type;
    return ChoiceChip(
      avatar: icon != null
          ? Icon(
              icon,
              size: 16,
              color: isSelected ? Colors.white : AppColors.primary,
            )
          : null,
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
          notifier.setFilterType(type);
        }
      },
    );
  }

  IconData _getIconForType(String type) {
    switch (type) {
      case AppConstants.typeAudio:
        return Icons.headphones_rounded;
      case AppConstants.typePdf:
        return Icons.picture_as_pdf_rounded;
      case AppConstants.typeText:
        return Icons.article_rounded;
      case AppConstants.typeImage:
        return Icons.image_rounded;
      default:
        return Icons.insert_drive_file_rounded;
    }
  }
}
