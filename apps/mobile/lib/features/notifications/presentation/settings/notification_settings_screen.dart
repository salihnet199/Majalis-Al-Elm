import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_colors.dart';
import '../controllers/notifications_controller.dart';

class NotificationSettingsScreen extends ConsumerWidget {
  const NotificationSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final prefsAsync = ref.watch(notificationPreferencesProvider);
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'تفضيلات الإشعارات والتنبيهات',
          style: TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.bold, fontSize: 17),
        ),
        centerTitle: true,
      ),
      body: prefsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator(color: AppColors.gold500)),
        error: (err, _) => Center(
          child: Text('تعذر تحميل التفضيلات: $err', style: const TextStyle(fontFamily: 'Cairo')),
        ),
        data: (prefs) {
          return ListView(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            children: [
              // Header description card
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: isDark ? AppColors.mocha900 : const Color(0xFFFAF7F2),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.gold500.withAlpha(76)),
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: AppColors.gold500.withAlpha(38),
                      ),
                      child: const Icon(Icons.tune_rounded, color: AppColors.gold500, size: 24),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Text(
                        'يمكنك تخصيص فئات التنبيهات التي ترغب في استقبالها على هاتفك لحظة نشرها.',
                        style: TextStyle(
                          fontFamily: 'Cairo',
                          fontSize: 13,
                          color: isDark ? AppColors.cream200 : AppColors.mocha900,
                          height: 1.5,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              // Section 1: Categories
              const Text(
                'فئات المحتوى العلمي',
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                  color: AppColors.gold500,
                ),
              ),
              const SizedBox(height: 10),

              _buildPreferenceTile(
                context: context,
                isDark: isDark,
                title: 'إشعارات الدروس والمحاضرات العلمية',
                subtitle: 'تنبيهات عند بدء البث المباشر أو نشر دروس صوتية ومرئية جديدة لفضيلة الشيخ',
                icon: Icons.menu_book_rounded,
                value: prefs.enableLessons,
                onChanged: (val) {
                  ref
                      .read(notificationPreferencesProvider.notifier)
                      .updatePreferences(prefs.copyWith(enableLessons: val));
                },
              ),
              const SizedBox(height: 10),

              _buildPreferenceTile(
                context: context,
                isDark: isDark,
                title: 'إشعارات الفتاوى والاستشارات الشرعية',
                subtitle: 'تنبيهات فور اعتماد وإجابة الفتاوى الشرعية الجديدة',
                icon: Icons.gavel_rounded,
                value: prefs.enableFatwas,
                onChanged: (val) {
                  ref
                      .read(notificationPreferencesProvider.notifier)
                      .updatePreferences(prefs.copyWith(enableFatwas: val));
                },
              ),
              const SizedBox(height: 10),

              _buildPreferenceTile(
                context: context,
                isDark: isDark,
                title: 'الإعلانات العامة وتنبيهات المنصة',
                subtitle: 'التنبيهات الإدارية، تحديثات التطبيق، ومواعيد الدورات العلمية',
                icon: Icons.campaign_rounded,
                value: prefs.enableAnnouncements,
                onChanged: (val) {
                  ref
                      .read(notificationPreferencesProvider.notifier)
                      .updatePreferences(prefs.copyWith(enableAnnouncements: val));
                },
              ),
              const SizedBox(height: 24),

              // Section 2: Channels
              const Text(
                'قنوات الاستقبال',
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                  color: AppColors.gold500,
                ),
              ),
              const SizedBox(height: 10),

              _buildPreferenceTile(
                context: context,
                isDark: isDark,
                title: 'إشعارات الهاتف الفورية (Push Notifications)',
                subtitle: 'استقبال التنبيهات على شاشة الهاتف حتى عندما يكون التطبيق مغلقاً',
                icon: Icons.notifications_active_rounded,
                value: prefs.enablePush,
                onChanged: (val) {
                  ref
                      .read(notificationPreferencesProvider.notifier)
                      .updatePreferences(prefs.copyWith(enablePush: val));
                },
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildPreferenceTile({
    required BuildContext context,
    required bool isDark,
    required String title,
    required String subtitle,
    required IconData icon,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    return Material(
      color: isDark ? AppColors.mocha900.withAlpha(153) : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: isDark ? Colors.white10 : Colors.black12,
        ),
      ),
      child: SwitchListTile.adaptive(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        secondary: Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: value ? AppColors.gold500.withAlpha(38) : (isDark ? AppColors.mocha800 : AppColors.cream100),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(
            icon,
            size: 22,
            color: value ? AppColors.gold500 : (isDark ? AppColors.cream400 : AppColors.mocha400),
          ),
        ),
        title: Text(
          title,
          style: const TextStyle(
            fontFamily: 'Cairo',
            fontSize: 14,
            fontWeight: FontWeight.bold,
          ),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            subtitle,
            style: TextStyle(
              fontFamily: 'Cairo',
              fontSize: 12,
              color: isDark ? AppColors.cream300 : AppColors.mocha400,
              height: 1.4,
            ),
          ),
        ),
        value: value,
        activeThumbColor: AppColors.gold500,
        activeTrackColor: AppColors.gold500.withAlpha(102),
        onChanged: onChanged,
      ),
    );
  }
}
