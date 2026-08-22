import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart' as intl;
import '../../../../core/theme/app_colors.dart';
import '../../domain/models/notification_item_model.dart';
import '../controllers/notifications_controller.dart';
import '../settings/notification_settings_screen.dart';

class NotificationInboxScreen extends ConsumerWidget {
  const NotificationInboxScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(notificationsProvider);
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'مركز الإشعارات والتنبيهات',
          style: TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.bold, fontSize: 18),
        ),
        centerTitle: true,
        actions: [
          if (state.unreadCount > 0)
            IconButton(
              icon: const Icon(Icons.done_all_rounded, color: AppColors.gold500),
              tooltip: 'تحديد الكل كمقروء',
              onPressed: () async {
                final messenger = ScaffoldMessenger.of(context);
                final succeeded = await ref.read(notificationsProvider.notifier).markAllAsRead();
                if (!context.mounted) return;
                // Report the real outcome — never a success message on failure.
                messenger.showSnackBar(
                  SnackBar(
                    content: Text(
                      succeeded
                          ? 'تم تحديد كافة الإشعارات كمقروءة'
                          : ref.read(notificationsProvider).errorMessage ??
                              'تعذر تحديد الإشعارات كمقروءة، يرجى المحاولة مرة أخرى',
                      style: const TextStyle(fontFamily: 'Cairo'),
                    ),
                    backgroundColor: succeeded ? null : Colors.red.shade800,
                    duration: const Duration(seconds: 3),
                  ),
                );
              },
            ),
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            tooltip: 'تفضيلات الإشعارات',
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const NotificationSettingsScreen()),
              );
            },
          ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.gold500,
        onRefresh: () => ref.read(notificationsProvider.notifier).fetchNotifications(),
        child: state.isLoading && state.items.isEmpty
            ? const Center(child: CircularProgressIndicator(color: AppColors.gold500))
            : state.items.isEmpty
                ? (state.errorMessage != null
                    ? _buildErrorState(context, ref, isDark, state.errorMessage!)
                    : _buildEmptyState(context, isDark))
                : ListView.separated(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    itemCount: state.items.length + (state.errorMessage != null ? 1 : 0),
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (context, index) {
                      // A failure while items are already on screen shows an inline
                      // banner: the list is stale, and the user must know that.
                      if (state.errorMessage != null && index == 0) {
                        return _buildErrorBanner(state.errorMessage!);
                      }
                      final item = state.items[state.errorMessage != null ? index - 1 : index];
                      return _buildNotificationCard(context, ref, item, isDark);
                    },
                  ),
      ),
    );
  }

  /// Full-screen failure state — replaces the deleted sample-notifications fallback.
  Widget _buildErrorState(BuildContext context, WidgetRef ref, bool isDark, String errorMessage) {
    return ListView(
      padding: const EdgeInsets.all(32),
      children: [
        const SizedBox(height: 40),
        Container(
          width: 80,
          height: 80,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: isDark ? AppColors.mocha800 : AppColors.cream100,
            border: Border.all(color: Colors.red.shade400.withAlpha(120)),
          ),
          child: Icon(Icons.cloud_off_rounded, size: 40, color: Colors.red.shade400),
        ),
        const SizedBox(height: 16),
        const Text(
          'تعذر تحميل الإشعارات',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontFamily: 'Aref Ruqaa',
            fontSize: 20,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          errorMessage,
          textAlign: TextAlign.center,
          style: TextStyle(
            fontFamily: 'Cairo',
            fontSize: 13,
            height: 1.6,
            color: isDark ? AppColors.cream300 : AppColors.mocha400,
          ),
        ),
        const SizedBox(height: 20),
        Center(
          child: OutlinedButton.icon(
            onPressed: () => ref.read(notificationsProvider.notifier).fetchNotifications(),
            icon: const Icon(Icons.refresh_rounded, size: 18),
            label: const Text('إعادة المحاولة', style: TextStyle(fontFamily: 'Cairo')),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.gold500,
              side: BorderSide(color: AppColors.gold500.withAlpha(120)),
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildErrorBanner(String errorMessage) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.red.shade900.withAlpha(40),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.red.shade400.withAlpha(120)),
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline_rounded, size: 20, color: Colors.red.shade400),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              errorMessage,
              style: const TextStyle(fontFamily: 'Cairo', fontSize: 12, height: 1.5),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState(BuildContext context, bool isDark) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: isDark ? AppColors.mocha800 : AppColors.cream100,
                border: Border.all(color: AppColors.gold500.withAlpha(76)),
              ),
              child: const Icon(Icons.notifications_off_outlined, size: 40, color: AppColors.gold400),
            ),
            const SizedBox(height: 16),
            const Text(
              'لا توجد إشعارات حالياً',
              style: TextStyle(
                fontFamily: 'Aref Ruqaa',
                fontSize: 20,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'ستصلك هنا إشعارات بالدروس الجديدة، الفتاوى، وبث الإعلانات العامة فور نشرها.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontFamily: 'Cairo',
                fontSize: 13,
                color: isDark ? AppColors.cream300 : AppColors.mocha400,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildNotificationCard(
    BuildContext context,
    WidgetRef ref,
    NotificationItemModel item,
    bool isDark,
  ) {
    final categoryConfig = _getCategoryConfig(item.category);

    return InkWell(
      onTap: () async {
        if (item.isRead) return;
        final messenger = ScaffoldMessenger.of(context);
        final succeeded = await ref.read(notificationsProvider.notifier).markAsRead(item.id);
        if (succeeded || !context.mounted) return;
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              ref.read(notificationsProvider).errorMessage ??
                  'تعذر تحديد الإشعار كمقروء، يرجى المحاولة مرة أخرى',
              style: const TextStyle(fontFamily: 'Cairo'),
            ),
            backgroundColor: Colors.red.shade800,
            duration: const Duration(seconds: 3),
          ),
        );
      },
      borderRadius: BorderRadius.circular(16),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: item.isRead
              ? (isDark ? AppColors.mocha900.withAlpha(128) : Colors.white)
              : (isDark ? AppColors.mocha850 : const Color(0xFFFBF8F2)),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: item.isRead
                ? (isDark ? Colors.white10 : Colors.black12)
                : AppColors.gold500.withAlpha(153),
            width: item.isRead ? 1 : 1.5,
          ),
          boxShadow: [
            if (!item.isRead)
              BoxShadow(
                color: AppColors.gold500.withAlpha(20),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Top Row: Category Tag + Unread Dot + Date
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: categoryConfig.color.withAlpha(38),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(categoryConfig.icon, size: 12, color: categoryConfig.color),
                      const SizedBox(width: 4),
                      Text(
                        categoryConfig.label,
                        style: TextStyle(
                          fontFamily: 'Cairo',
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          color: categoryConfig.color,
                        ),
                      ),
                    ],
                  ),
                ),
                const Spacer(),
                if (!item.isRead) ...[
                  Container(
                    width: 8,
                    height: 8,
                    decoration: const BoxDecoration(
                      shape: BoxShape.circle,
                      color: AppColors.gold500,
                    ),
                  ),
                  const SizedBox(width: 6),
                ],
                Text(
                  intl.DateFormat('yyyy/MM/dd – hh:mm a', 'ar').format(item.createdAt),
                  style: TextStyle(
                    fontFamily: 'Cairo',
                    fontSize: 11,
                    color: isDark ? AppColors.cream400 : AppColors.mocha400,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),

            // Title
            Text(
              item.title,
              style: TextStyle(
                fontFamily: 'Cairo',
                fontSize: 15,
                fontWeight: item.isRead ? FontWeight.w600 : FontWeight.bold,
                color: item.isRead
                    ? (isDark ? AppColors.cream200 : AppColors.mocha900)
                    : (isDark ? AppColors.cream50 : Colors.black),
              ),
            ),
            const SizedBox(height: 6),

            // Body
            Text(
              item.body,
              style: TextStyle(
                fontFamily: 'Amiri',
                fontSize: 14,
                height: 1.6,
                color: isDark ? AppColors.cream300 : const Color(0xFF4A342A),
              ),
            ),
          ],
        ),
      ),
    );
  }

  _CategoryConfig _getCategoryConfig(String category) {
    switch (category.toLowerCase()) {
      case 'lesson':
        return _CategoryConfig('درس علمي', Icons.menu_book_rounded, AppColors.gold500);
      case 'fatwa':
        return _CategoryConfig('فتوى شرعية', Icons.gavel_rounded, const Color(0xFF06B6D4));
      case 'announcement':
      default:
        return _CategoryConfig('إعلان عام', Icons.campaign_rounded, const Color(0xFFA855F7));
    }
  }
}

class _CategoryConfig {
  final String label;
  final IconData icon;
  final Color color;

  _CategoryConfig(this.label, this.icon, this.color);
}
