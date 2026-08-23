import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/constants/app_constants.dart';
import 'package:mobile/core/network/error_handler.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/features/content/domain/models/content_item_model.dart';
import 'package:mobile/features/content/domain/models/media_stream_model.dart';
import 'package:mobile/features/content/presentation/audio/audio_player_notifier.dart';
import 'package:mobile/features/content/presentation/audio/audio_player_screen.dart';
import 'package:mobile/features/content/providers/media_source_provider.dart';

void main() {
  const testAudioItem = ContentItemModel(
    id: 'audio-test-1',
    slug: 'sharh-thalathat-al-usul',
    title: 'شرح ثلاثة الأصول',
    description: 'شرح صوتي',
    type: AppConstants.typeAudio,
    // Deliberately a thumbnail: the screen must never open this field.
    url: 'https://cdn.example.com/thumbnails/audio.jpg',
    author: 'فضيلة الشيخ',
    durationSeconds: 1800,
  );

  Widget wrap(Widget child, {List<Override> overrides = const []}) {
    return ProviderScope(
      overrides: overrides,
      child: MaterialApp(
        theme: AppTheme.lightTheme,
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: child,
        ),
      ),
    );
  }

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
        wrap(
          const AudioPlayerScreen(item: testAudioItem),
          overrides: [
            // Overridden so the test does not reach Isar or the network. Without
            // it the screen would resolve for real, which a widget test cannot do.
            mediaSourceProvider(testAudioItem).overrideWith(
              (ref) async => RemoteMediaSource(
                const MediaStreamModel(url: 'https://storage.example.com/a.mp3?sig=1'),
              ),
            ),
          ],
        ),
      );

      await tester.pump();

      expect(find.text('مشغل الصوتيات'), findsOneWidget);
      expect(find.text('شرح ثلاثة الأصول'), findsOneWidget);
      expect(find.text('فضيلة الشيخ'), findsOneWidget);
      expect(find.byType(Slider), findsOneWidget);
      expect(find.text('1.0x'), findsOneWidget);
    });

    testWidgets('shows the real Arabic error and disables playback when resolution fails',
        (WidgetTester tester) async {
      // The screen used to hand `item.url` to the player and leave the controls
      // live, so an unplayable item looked like a corrupt file. A failed
      // resolution must state the server's reason and refuse to pretend it can
      // play (POLICY-SEC-001 category 3).
      await tester.pumpWidget(
        wrap(
          const AudioPlayerScreen(item: testAudioItem),
          overrides: [
            mediaSourceProvider(testAudioItem).overrideWith(
              (ref) async => throw const AppException(
                code: 'MEDIA_NOT_AVAILABLE',
                message: 'الملف غير متاح للتشغيل بعد',
              ),
            ),
          ],
        ),
      );

      await tester.pump();
      await tester.pump();

      expect(find.text('الملف غير متاح للتشغيل بعد'), findsOneWidget);
      expect(find.text('إعادة المحاولة'), findsOneWidget);

      final slider = tester.widget<Slider>(find.byType(Slider));
      expect(slider.onChanged, isNull, reason: 'seeking a player that was handed nothing');

      final playButton = tester.widget<IconButton>(
        find.ancestor(
          of: find.byIcon(Icons.play_arrow_rounded),
          matching: find.byType(IconButton),
        ),
      );
      expect(playButton.onPressed, isNull, reason: 'play must be disabled with no source');
    });

    testWidgets('download button states the truth instead of confirming a queued download',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        wrap(
          const AudioPlayerScreen(item: testAudioItem),
          overrides: [
            mediaSourceProvider(testAudioItem).overrideWith(
              (ref) async => RemoteMediaSource(
                const MediaStreamModel(url: 'https://storage.example.com/a.mp3?sig=1'),
              ),
            ),
          ],
        ),
      );
      await tester.pump();

      await tester.tap(find.byIcon(Icons.download_for_offline_outlined));
      await tester.pump();

      // TECH-DEBT-016: there is no downloader, so nothing may claim one ran.
      expect(find.textContaining('غير متاح بعد'), findsOneWidget);
      expect(find.textContaining('قائمة التنزيل'), findsNothing);
    });
  });
}
