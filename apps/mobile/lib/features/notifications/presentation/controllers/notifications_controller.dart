import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/error_handler.dart';
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

  /// Fetches in-app notifications from backend.
  ///
  /// SECURITY / TRUTHFULNESS: no sample-data fallback. A failed request sets
  /// [NotificationsState.errorMessage] so the inbox renders a clear Arabic error
  /// instead of fabricated announcements that look like real platform content.
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
    } on DioException catch (e) {
      final failure = AppException.fromDioException(
        e,
        fallbackMessage: 'تعذر تحميل الإشعارات من الخادم، يرجى المحاولة مرة أخرى',
      );
      state = state.copyWith(isLoading: false, errorMessage: failure.message);
    } catch (_) {
      state = state.copyWith(
        isLoading: false,
        errorMessage: 'تعذر قراءة بيانات الإشعارات القادمة من الخادم',
      );
    }
  }

  /// Marks a specific notification as read.
  ///
  /// Returns `true` only when the backend confirmed the change. The local read
  /// flag is never flipped on a failed request — that would show the user a
  /// read state the server does not have.
  Future<bool> markAsRead(String id) async {
    try {
      await _apiClient.patch('/notifications/$id/read', data: {});
    } on DioException catch (e) {
      final failure = AppException.fromDioException(
        e,
        fallbackMessage: 'تعذر تحديد الإشعار كمقروء، يرجى المحاولة مرة أخرى',
      );
      state = state.copyWith(errorMessage: failure.message);
      return false;
    }

    final updated = state.items.map((item) {
      if (item.id == id) {
        return item.copyWith(isRead: true);
      }
      return item;
    }).toList();

    final unread = updated.where((i) => !i.isRead).length;
    state = state.copyWith(items: updated, unreadCount: unread);
    return true;
  }

  /// Marks all notifications as read. Returns `true` only on backend confirmation.
  Future<bool> markAllAsRead() async {
    try {
      await _apiClient.patch('/notifications/read-all', data: {});
    } on DioException catch (e) {
      final failure = AppException.fromDioException(
        e,
        fallbackMessage: 'تعذر تحديد الإشعارات كمقروءة، يرجى المحاولة مرة أخرى',
      );
      state = state.copyWith(errorMessage: failure.message);
      return false;
    }

    final updated = state.items.map((item) => item.copyWith(isRead: true)).toList();
    state = state.copyWith(items: updated, unreadCount: 0);
    return true;
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

  /// Loads the user's notification preferences.
  ///
  /// SECURITY / TRUTHFULNESS: a failed request becomes [AsyncValue.error] so the
  /// settings screen shows an Arabic error. Returning default preferences here
  /// made the user believe they were seeing (and editing) their saved settings.
  Future<void> fetchPreferences() async {
    state = const AsyncValue.loading();
    try {
      final response = await _apiClient.get('/notifications/preferences');
      final data = response.data;
      final payload = data is Map && data['data'] != null ? data['data'] : data;
      state = AsyncValue.data(NotificationPreferencesModel.fromJson(Map<String, dynamic>.from(payload as Map)));
    } on DioException catch (e, stackTrace) {
      state = AsyncValue.error(
        AppException.fromDioException(
          e,
          fallbackMessage: 'تعذر تحميل تفضيلات الإشعارات من الخادم',
        ),
        stackTrace,
      );
    } catch (_, stackTrace) {
      state = AsyncValue.error(
        const AppException(
          code: 'PARSE_ERROR',
          message: 'تعذر قراءة تفضيلات الإشعارات القادمة من الخادم',
        ),
        stackTrace,
      );
    }
  }

  /// Applies a preference change optimistically, then reverts it if the backend
  /// rejected or never received the update. Returns `true` only on confirmation.
  Future<bool> updatePreferences(NotificationPreferencesModel updated) async {
    final previous = state.valueOrNull;
    state = AsyncValue.data(updated);
    try {
      await _apiClient.patch('/notifications/preferences', data: updated.toJson());
      return true;
    } on DioException catch (_) {
      if (previous != null) {
        state = AsyncValue.data(previous);
      }
      return false;
    }
  }
}

final notificationPreferencesProvider =
    StateNotifierProvider<NotificationPreferencesNotifier, AsyncValue<NotificationPreferencesModel>>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return NotificationPreferencesNotifier(apiClient);
});
