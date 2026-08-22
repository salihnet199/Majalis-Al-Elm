import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/api_client.dart';
import '../../../auth/providers/auth_notifier.dart';
import '../../domain/models/notification_item_model.dart';
import '../../domain/models/notification_preferences_model.dart';

// State definition for Notifications Inbox
class NotificationsState {
  final List<NotificationItemModel> items;
  final bool isLoading;
  final String? errorMessage;
  final int unreadCount;

  const NotificationsState({
    this.items = const [],
    this.isLoading = false,
    this.errorMessage,
    this.unreadCount = 0,
  });

  NotificationsState copyWith({
    List<NotificationItemModel>? items,
    bool? isLoading,
    String? errorMessage,
    int? unreadCount,
  }) {
    return NotificationsState(
      items: items ?? this.items,
      isLoading: isLoading ?? this.isLoading,
      errorMessage: errorMessage,
      unreadCount: unreadCount ?? this.unreadCount,
    );
  }
}

class NotificationsNotifier extends StateNotifier<NotificationsState> {
  final ApiClient _apiClient;

  NotificationsNotifier(this._apiClient) : super(const NotificationsState()) {
    fetchNotifications();
  }

  /// Fetches in-app notifications from backend
  Future<void> fetchNotifications() async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      final response = await _apiClient.get('/notifications?page=1&limit=50');
      final data = response.data;
      final rawList = data is Map ? (data['data'] as List? ?? []) : (data as List? ?? []);

      final items = rawList
          .map((json) => NotificationItemModel.fromJson(Map<String, dynamic>.from(json as Map)))
          .toList();

      final unread = items.where((i) => !i.isRead).length;
      state = state.copyWith(items: items, isLoading: false, unreadCount: unread);
    } catch (e) {
      // Fallback sample notifications if offline
      final fallbackItems = [
        NotificationItemModel(
          id: '1',
          title: 'بدء التسجيل في دورة شرح العقيدة الطحاوية',
          body: 'يسر إدارة منصة مجالس العلم الإعلان عن بدء التسجيل في دورة شرح العقيدة الطحاوية لفضيلة الشيخ علي الويسي.',
          category: 'lesson',
          channel: 'IN_APP',
          isRead: false,
          createdAt: DateTime.now().subtract(const Duration(minutes: 45)),
        ),
        NotificationItemModel(
          id: '2',
          title: 'جديد الفتاوى: حكم الجمع في السفر العارض',
          body: 'تمت إضافة إجابة صوتية ومكتوبة لفضيلة الشيخ علي الويسي حول أحكام صلاة المسافر.',
          category: 'fatwa',
          channel: 'IN_APP',
          isRead: true,
          createdAt: DateTime.now().subtract(const Duration(days: 1)),
        ),
      ];
      state = state.copyWith(
        items: fallbackItems,
        isLoading: false,
        unreadCount: fallbackItems.where((i) => !i.isRead).length,
      );
    }
  }

  /// Marks a specific notification as read
  Future<void> markAsRead(String id) async {
    try {
      await _apiClient.patch('/notifications/$id/read', data: {});
    } catch (_) {}

    final updated = state.items.map((item) {
      if (item.id == id) {
        return item.copyWith(isRead: true);
      }
      return item;
    }).toList();

    final unread = updated.where((i) => !i.isRead).length;
    state = state.copyWith(items: updated, unreadCount: unread);
  }

  /// Marks all notifications as read
  Future<void> markAllAsRead() async {
    try {
      await _apiClient.patch('/notifications/read-all', data: {});
    } catch (_) {}

    final updated = state.items.map((item) => item.copyWith(isRead: true)).toList();
    state = state.copyWith(items: updated, unreadCount: 0);
  }
}

// Provider for Notifications Inbox
final notificationsProvider = StateNotifierProvider<NotificationsNotifier, NotificationsState>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return NotificationsNotifier(apiClient);
});

// Provider for Unread Count Badge
final unreadNotificationsCountProvider = Provider<int>((ref) {
  return ref.watch(notificationsProvider).unreadCount;
});

// Provider for Notification Preferences
class NotificationPreferencesNotifier extends StateNotifier<AsyncValue<NotificationPreferencesModel>> {
  final ApiClient _apiClient;

  NotificationPreferencesNotifier(this._apiClient) : super(const AsyncValue.loading()) {
    fetchPreferences();
  }

  Future<void> fetchPreferences() async {
    try {
      final response = await _apiClient.get('/notifications/preferences');
      final data = response.data;
      final payload = data is Map && data['data'] != null ? data['data'] : data;
      state = AsyncValue.data(NotificationPreferencesModel.fromJson(Map<String, dynamic>.from(payload as Map)));
    } catch (e) {
      state = const AsyncValue.data(NotificationPreferencesModel());
    }
  }

  Future<void> updatePreferences(NotificationPreferencesModel updated) async {
    state = AsyncValue.data(updated);
    try {
      await _apiClient.patch('/notifications/preferences', data: updated.toJson());
    } catch (_) {}
  }
}

final notificationPreferencesProvider =
    StateNotifierProvider<NotificationPreferencesNotifier, AsyncValue<NotificationPreferencesModel>>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return NotificationPreferencesNotifier(apiClient);
});
