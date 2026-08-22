import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/constants/app_constants.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/features/content/domain/models/content_item_model.dart';
import 'package:mobile/features/content/presentation/audio/audio_player_notifier.dart';
import 'package:mobile/features/content/presentation/audio/audio_player_screen.dart';

void main() {
  const testAudioItem = ContentItemModel(
    id: 'audio-test-1',
    title: 'شرح ثلاثة الأصول',
    description: 'شرح صوتي',
    type: AppConstants.typeAudio,
    url: 'https://example.com/test.mp3',
    author: 'فضيلة الشيخ',
    durationSeconds: 1800,
  );

  group('AudioPlayerState Unit Tests', () {
    test('initial state has default values', () {
      const state = AudioPlayerState();
      expect(state.isPlaying, false);
      expect(state.isLoading, false);
      expect(state.speed, 1.0);
      expect(state.position, Duration.zero);
    });

    test('copyWith updates speed and position correctly', () {
      const state = AudioPlayerState();
      final updated = state.copyWith(speed: 1.5, position: const Duration(seconds: 45));
      expect(updated.speed, 1.5);
      expect(updated.position, const Duration(seconds: 45));
    });
  });

  group('AudioPlayerScreen Widget Tests', () {
    testWidgets('renders audio title, author, and playback controls', (WidgetTester tester) async {
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const Directionality(
              textDirection: TextDirection.rtl,
              child: AudioPlayerScreen(item: testAudioItem),
            ),
          ),
        ),
      );

      await tester.pump();

      expect(find.text('مشغل الصوتيات'), findsOneWidget);
      expect(find.text('شرح ثلاثة الأصول'), findsOneWidget);
      expect(find.text('فضيلة الشيخ'), findsOneWidget);
      expect(find.byType(Slider), findsOneWidget);
      expect(find.text('1.0x'), findsOneWidget);
    });
  });
}
