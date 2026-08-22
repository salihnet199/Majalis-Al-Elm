import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/register_screen.dart';
import '../../features/auth/providers/auth_notifier.dart';
import '../../features/auth/providers/auth_state.dart';
import '../../features/content/domain/models/content_item_model.dart';
import '../../features/content/presentation/audio/audio_player_screen.dart';
import '../../features/content/presentation/image/image_viewer_screen.dart';
import '../../features/content/presentation/pdf/pdf_viewer_screen.dart';
import '../../features/content/presentation/text/article_reader_screen.dart';
import '../../features/home/presentation/main_shell.dart';
import '../../features/notifications/presentation/inbox/notification_inbox_screen.dart';
import '../../features/notifications/presentation/settings/notification_settings_screen.dart';

final appRouterProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authNotifierProvider);

  return GoRouter(
    initialLocation: '/splash',
    redirect: (context, state) {
      final isLoading = authState is AuthLoading || authState is AuthInitial;
      final isAuthenticated = authState is Authenticated;
      final isLoginOrRegister = state.matchedLocation == '/login' ||
          state.matchedLocation == '/register';

      if (isLoading) {
        return state.matchedLocation == '/splash' ? null : '/splash';
      }

      if (!isAuthenticated && !isLoginOrRegister) {
        return '/login';
      }

      if (isAuthenticated && (isLoginOrRegister || state.matchedLocation == '/splash')) {
        return '/home';
      }

      return null;
    },
    routes: [
      GoRoute(
        path: '/splash',
        builder: (context, state) => const Scaffold(
          body: Center(
            child: CircularProgressIndicator(),
          ),
        ),
      ),
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/register',
        builder: (context, state) => const RegisterScreen(),
      ),
      GoRoute(
        path: '/home',
        builder: (context, state) => const MainShell(),
      ),
      GoRoute(
        path: '/viewer/audio',
        builder: (context, state) {
          final item = state.extra as ContentItemModel;
          return AudioPlayerScreen(item: item);
        },
      ),
      GoRoute(
        path: '/viewer/pdf',
        builder: (context, state) {
          final item = state.extra as ContentItemModel;
          return PdfViewerScreen(item: item);
        },
      ),
      GoRoute(
        path: '/viewer/article',
        builder: (context, state) {
          final item = state.extra as ContentItemModel;
          return ArticleReaderScreen(item: item);
        },
      ),
      GoRoute(
        path: '/viewer/image',
        builder: (context, state) {
          final item = state.extra as ContentItemModel;
          return ImageViewerScreen(item: item);
        },
      ),
      GoRoute(
        path: '/notifications',
        builder: (context, state) => const NotificationInboxScreen(),
      ),
      GoRoute(
        path: '/notifications/settings',
        builder: (context, state) => const NotificationSettingsScreen(),
      ),
    ],
  );
});
