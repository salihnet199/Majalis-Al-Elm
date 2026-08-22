import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/localization/app_localizations.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../auth/providers/auth_notifier.dart';
import '../../auth/providers/auth_state.dart';
import '../../content/domain/models/content_item_model.dart';
import '../../notifications/presentation/controllers/notifications_controller.dart';
import '../../notifications/presentation/inbox/notification_inbox_screen.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  String _selectedType = 'ALL';
  final _searchController = TextEditingController();

  final List<ContentItemModel> _sampleItems = const [
    ContentItemModel(
      id: 'audio-001',
      title: 'شرح ثلاثة الأصول وأدلتها',
      description: 'درس صوتي يشرح أصول العقيدة الإسلامية الثلاثة مع الأدلة من الكتاب والسنة',
      type: AppConstants.typeAudio,
      url: 'https://example.com/audio/usul.mp3',
      author: AppConstants.sheikhName,
      category: 'العقيدة',
      durationSeconds: 2700,
    ),
    ContentItemModel(
      id: 'pdf-001',
      title: 'كتاب التوحيد الذي هو حق الله على العبيد',
      description: 'نسخة رقمية محققة من متن كتاب التوحيد مع الفهارس',
      type: AppConstants.typePdf,
      url: 'assets/sample.pdf',
      author: AppConstants.sheikhName,
      category: 'العقيدة',
      pageCount: 120,
    ),
    ContentItemModel(
      id: 'text-001',
      title: 'منزلة الصلاة في الإسلام وأحكام تاركها',
      description: 'بحث شرعي تأصيلي حول عظم شأن الصلاة وفضل المحافظة عليها في جماعة',
      type: AppConstants.typeText,
      url: '',
      author: AppConstants.sheikhName,
      category: 'الفقه',
      textContent: 'بسم الله الرحمن الرحيم، الحمد لله رب العالمين والصلاة والسلام على نبينا محمد وعلى آله وصحبه أجمعين.\n\nإن الصلاة هي الركن الثاني من أركان الإسلام بعد الشهادتين، وهي عمود الدين الذي لا يقوم إلا به. وقد فرضها الله تعالى على نبيه في ليلة الإسراء والمعراج في السماء السابعة مباشرة بلا واسطة، دلالة على عظيم شأنها ومنزلتها الرفيعة.\n\nقال تعالى: {وَأَقِيمُوا الصَّلَاةَ وَآتُوا الزَّكَاةَ وَارْكَعُوا مَعَ الرَّاكِعِينَ}، وقال رسول الله صلى الله عليه وسلم: (بين الرجل وبين الشرك والكفر ترك الصلاة).\n\nوقد أجمع علماء المسلمين على وجوب المحافظة على الصلوات الخمس في أوقاتها مع جماعة المسلمين.',
    ),
    ContentItemModel(
      id: 'image-001',
      title: 'إنفوجرافيك: شروط وأركان وواجبات الصلاة',
      description: 'رسم بياني تعليمي تفصيلي يوضح الفرق بين شروط الصلاة وأركانها وواجباتها وسننها',
      type: AppConstants.typeImage,
      url: 'https://example.com/images/salah_infographic.png',
      author: AppConstants.sheikhName,
      category: 'الفقه',
    ),
  ];

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _openContent(ContentItemModel item) {
    switch (item.type) {
      case AppConstants.typeAudio:
        context.push('/viewer/audio', extra: item);
        break;
      case AppConstants.typePdf:
        context.push('/viewer/pdf', extra: item);
        break;
      case AppConstants.typeText:
        context.push('/viewer/article', extra: item);
        break;
      case AppConstants.typeImage:
        context.push('/viewer/image', extra: item);
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final authState = ref.watch(authNotifierProvider);
    final userName = authState is Authenticated ? authState.user.fullName : 'زائر كريم';

    final filteredItems = _sampleItems.where((item) {
      final matchesType = _selectedType == 'ALL' || item.type == _selectedType;
      final query = _searchController.text.trim().toLowerCase();
      final matchesQuery = query.isEmpty ||
          item.title.toLowerCase().contains(query) ||
          item.description.toLowerCase().contains(query);
      return matchesType && matchesQuery;
    }).toList();

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.menu_book_rounded, color: AppColors.primary, size: 22),
                const SizedBox(width: 8),
                Text(
                  AppConstants.appName,
                  style: AppTypography.brandTitle.copyWith(
                    color: Theme.of(context).colorScheme.onSurface,
                    fontSize: 20,
                  ),
                ),
              ],
            ),
            Text(
              'دروس ومؤلفات ${AppConstants.sheikhName}',
              style: AppTypography.sheikhName.copyWith(
                color: AppColors.primary,
                fontSize: 12,
              ),
            ),
          ],
        ),
        actions: [
          Consumer(
            builder: (context, ref, _) {
              final unreadCount = ref.watch(unreadNotificationsCountProvider);
              return Stack(
                alignment: Alignment.center,
                children: [
                  IconButton(
                    icon: const Icon(Icons.notifications_outlined),
                    tooltip: 'مركز الإشعارات',
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const NotificationInboxScreen()),
                      );
                    },
                  ),
                  if (unreadCount > 0)
                    Positioned(
                      top: 8,
                      right: 8,
                      child: Container(
                        padding: const EdgeInsets.all(4),
                        decoration: const BoxDecoration(
                          color: AppColors.gold500,
                          shape: BoxShape.circle,
                        ),
                        constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
                        child: Text(
                          '$unreadCount',
                          style: const TextStyle(
                            color: AppColors.mocha950,
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                            fontFamily: 'Cairo',
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ),
                ],
              );
            },
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        children: [
          // Greeting Banner (Clean - "مرحباً بك في مجالس العلم")
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [AppColors.primary, AppColors.primaryLight],
                begin: Alignment.topRight,
                end: Alignment.bottomLeft,
              ),
              borderRadius: BorderRadius.circular(18),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primary.withAlpha(50),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'مرحباً بك في مجالس العلم',
                  style: AppTypography.heroHeader.copyWith(
                    color: Colors.white,
                    fontSize: 20,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'أهلاً بك، $userName · تصفح المواد والدروس المتاحة بدون إنترنت',
                  style: AppTypography.bodySmall.copyWith(
                    color: Colors.white.withAlpha(220),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // Search Field
          TextField(
            controller: _searchController,
            decoration: InputDecoration(
              hintText: l10n.searchPlaceholder,
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
          const SizedBox(height: 18),

          // Content Type Filter Chips (4 Types only per Project Charter)
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _buildFilterChip('الكل', 'ALL'),
                const SizedBox(width: 8),
                _buildFilterChip('صوتيات', AppConstants.typeAudio, icon: Icons.headphones_rounded),
                const SizedBox(width: 8),
                _buildFilterChip('كتب و PDF', AppConstants.typePdf, icon: Icons.picture_as_pdf_rounded),
                const SizedBox(width: 8),
                _buildFilterChip('مقالات ونصوص', AppConstants.typeText, icon: Icons.article_rounded),
                const SizedBox(width: 8),
                _buildFilterChip('صور ورسوم', AppConstants.typeImage, icon: Icons.image_rounded),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // Section Header: Latest Content
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'أحدث المواد المنشورة (${filteredItems.length})',
                style: AppTypography.titleMedium.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              Text(
                'عرض الكل',
                style: AppTypography.bodySmall.copyWith(
                  color: AppColors.primary,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),

          // Content Cards List
          if (filteredItems.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 32),
              child: Center(
                child: Column(
                  children: [
                    const Icon(Icons.search_off_rounded, size: 48, color: AppColors.textSecondaryLight),
                    const SizedBox(height: 12),
                    Text(
                      'لا توجد مواد مطابقة للبحث أو التصنيف المحدد',
                      style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondaryLight),
                    ),
                  ],
                ),
              ),
            )
          else
            ...filteredItems.map((item) {
              final icon = _getIconForType(item.type);
              final badge = _getBadgeForType(item);
              return _buildSampleContentCard(
                title: item.title,
                author: item.author,
                type: item.type,
                icon: icon,
                badge: badge,
                onTap: () => _openContent(item),
              );
            }),
        ],
      ),
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
        return Icons.book_rounded;
    }
  }

  String _getBadgeForType(ContentItemModel item) {
    switch (item.type) {
      case AppConstants.typeAudio:
        return 'صوتية · 45 د';
      case AppConstants.typePdf:
        return 'كتاب PDF · ${item.pageCount ?? 1} ص';
      case AppConstants.typeText:
        return 'مقال مقروء';
      case AppConstants.typeImage:
        return 'صورة توضيحية';
      default:
        return 'مادة علمية';
    }
  }

  Widget _buildFilterChip(String label, String type, {IconData? icon}) {
    final isSelected = _selectedType == type;
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
          setState(() {
            _selectedType = type;
          });
        }
      },
    );
  }

  Widget _buildSampleContentCard({
    required String title,
    required String author,
    required String type,
    required IconData icon,
    required String badge,
    required VoidCallback onTap,
  }) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(
            color: AppColors.primary.withAlpha(20),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(icon, color: AppColors.primary, size: 24),
        ),
        title: Text(
          title,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: AppTypography.titleSmall,
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Row(
            children: [
              Text(
                author,
                style: AppTypography.sheikhName.copyWith(
                  fontSize: 13,
                  color: AppColors.primary,
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.primary.withAlpha(15),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  badge,
                  style: AppTypography.bodySmall.copyWith(
                    fontSize: 10,
                    color: AppColors.primary,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
        ),
        trailing: const Icon(Icons.arrow_forward_ios_rounded, size: 16, color: AppColors.textSecondaryLight),
        onTap: onTap,
      ),
    );
  }
}
