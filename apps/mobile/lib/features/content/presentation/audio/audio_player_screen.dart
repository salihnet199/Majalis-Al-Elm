import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/error_handler.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../domain/models/content_item_model.dart';
import '../../providers/media_source_provider.dart';
import 'audio_player_notifier.dart';

class AudioPlayerScreen extends ConsumerStatefulWidget {
  final ContentItemModel item;

  const AudioPlayerScreen({super.key, required this.item});

  @override
  ConsumerState<AudioPlayerScreen> createState() => _AudioPlayerScreenState();
}

class _AudioPlayerScreenState extends ConsumerState<AudioPlayerScreen> {
  /// Guards against re-loading the same source on every rebuild. Holds the source
  /// actually handed to the player, so a re-resolved (re-signed) URL does load.
  String? _loadedSource;

  String _formatDuration(Duration d) {
    final minutes = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    final hours = d.inHours > 0 ? '${d.inHours.toString().padLeft(2, '0')}:' : '';
    return '$hours$minutes:$seconds';
  }

  /// Hands the resolved source to the player exactly once.
  ///
  /// The screen used to call `loadAudio(widget.item.url)` in `initState`. That
  /// field is the item's public CDN thumbnail — protected AUDIO has no permanent
  /// `cdn_url` under ADR-013 — so playback failed for every protected item and
  /// looked like a corrupt file. The source now comes from `mediaSourceProvider`:
  /// the downloaded file if one is really on disk, otherwise a freshly signed
  /// stream URL.
  void _loadResolved(MediaSource source) {
    final target = switch (source) {
      LocalFileMediaSource(path: final p) => p,
      RemoteMediaSource(url: final u) => u,
    };

    if (_loadedSource == target) return;
    _loadedSource = target;
    ref.read(audioPlayerProvider.notifier).loadAudio(target);
  }

  /// The user-facing Arabic text for a resolution failure.
  ///
  /// `AppException` already carries a translated message; anything else is
  /// reported as an unexpected error rather than being smoothed over into a
  /// generic "file unavailable", which would hide a real bug.
  String _resolutionMessage(Object error) {
    if (error is AppException) return error.message;
    return 'تعذر تجهيز ملف الصوت: $error';
  }

  @override
  Widget build(BuildContext context) {
    final playerState = ref.watch(audioPlayerProvider);
    final notifier = ref.read(audioPlayerProvider.notifier);
    final sourceAsync = ref.watch(mediaSourceProvider(widget.item));

    sourceAsync.whenData((source) {
      // Deferred: loadAudio drives the notifier, and a provider must not be
      // mutated during a build.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _loadResolved(source);
      });
    });

    final resolutionError = sourceAsync.hasError ? _resolutionMessage(sourceAsync.error!) : null;
    final playbackError = playerState.errorMessage;
    final errorMessage = resolutionError ?? playbackError;

    // Controls stay visible while the source resolves, but must not act on a
    // player that has been handed nothing.
    final isResolving = sourceAsync.isLoading;
    final canPlay = errorMessage == null && !isResolving && _loadedSource != null;

    final position = playerState.position;
    final duration = playerState.duration;
    final maxDurationMs = duration.inMilliseconds > 0 ? duration.inMilliseconds.toDouble() : 1.0;
    final currentPosMs = position.inMilliseconds.toDouble().clamp(0.0, maxDurationMs);

    return Scaffold(
      appBar: AppBar(
        title: const Text('مشغل الصوتيات'),
        actions: [
          IconButton(
            icon: Icon(
              widget.item.isDownloaded
                  ? Icons.download_done_rounded
                  : Icons.download_for_offline_outlined,
              color: widget.item.isDownloaded ? AppColors.secondary : null,
            ),
            tooltip: widget.item.isDownloaded ? 'محفوظ محلياً' : 'التنزيل للاستماع بدون إنترنت',
            onPressed: () {
              // This used to say "جاري إضافة المادة إلى قائمة التنزيل" while
              // nothing was queued and no file was fetched — a success message for
              // an operation that does not exist (POLICY-SEC-001 category 3).
              // The offline downloader is TECH-DEBT-016; until it exists the
              // button states the truth.
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    widget.item.isDownloaded
                        ? 'المادة محفوظة بالفعل في المحفوظات'
                        : 'التنزيل للاستماع بدون إنترنت غير متاح بعد — الاستماع يعمل عبر الإنترنت',
                  ),
                ),
              );
            },
          ),
        ],
      ),
      body: SafeArea(
        // The error banner adds height to a column that was sized exactly to the
        // screen, which overflowed on shorter viewports. Scrolling past the
        // minimum keeps the banner visible instead of clipping it, and the
        // Spacers still distribute the slack whenever the content does fit.
        child: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight),
              child: IntrinsicHeight(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                  child: Column(
                    children: [
                      const Spacer(),

                      // A real failure, stated plainly — resolution or playback.
                      if (errorMessage != null)
                        Container(
                          margin: const EdgeInsets.only(bottom: 16),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.error.withAlpha(24),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: AppColors.error.withAlpha(90)),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.error_outline_rounded, color: AppColors.error),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  errorMessage,
                                  style: AppTypography.bodySmall.copyWith(color: AppColors.error),
                                ),
                              ),
                              TextButton(
                                onPressed: () {
                                  // Re-resolves the source: a new signature for an expired
                                  // URL, or a fresh attempt after a network failure.
                                  _loadedSource = null;
                                  ref.invalidate(mediaSourceProvider(widget.item));
                                },
                                child: const Text('إعادة المحاولة'),
                              ),
                            ],
                          ),
                        ),

                      // Album Art / Disc
                      Container(
                        width: 220,
                        height: 220,
                        decoration: BoxDecoration(
                          gradient: const RadialGradient(
                            colors: [AppColors.primaryLight, AppColors.primaryDark],
                          ),
                          shape: BoxShape.circle,
                          boxShadow: [
                            BoxShadow(
                              color: AppColors.primary.withAlpha(80),
                              blurRadius: 20,
                              offset: const Offset(0, 8),
                            ),
                          ],
                        ),
                        child: Center(
                          child: Container(
                            width: 70,
                            height: 70,
                            decoration: BoxDecoration(
                              color: Theme.of(context).scaffoldBackgroundColor,
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons.headphones_rounded,
                              size: 36,
                              color: AppColors.primary,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 32),

                      // Title and Author
                      Text(
                        widget.item.title,
                        textAlign: TextAlign.center,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: AppTypography.titleLarge.copyWith(fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        widget.item.author,
                        textAlign: TextAlign.center,
                        style: AppTypography.bodyMedium.copyWith(
                          color: AppColors.textSecondaryLight,
                        ),
                      ),

                      const Spacer(),

                      // Slider and Timestamps
                      SliderTheme(
                        data: SliderTheme.of(context).copyWith(
                          trackHeight: 4,
                          thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 7),
                          overlayShape: const RoundSliderOverlayShape(overlayRadius: 14),
                          activeTrackColor: AppColors.primary,
                          inactiveTrackColor: AppColors.borderLight,
                          thumbColor: AppColors.primary,
                        ),
                        child: Slider(
                          value: currentPosMs,
                          max: maxDurationMs,
                          onChanged: canPlay
                              ? (val) {
                                  notifier.seek(Duration(milliseconds: val.toInt()));
                                }
                              : null,
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              _formatDuration(position),
                              style: AppTypography.bodySmall.copyWith(
                                color: AppColors.textSecondaryLight,
                              ),
                            ),
                            Text(
                              _formatDuration(duration),
                              style: AppTypography.bodySmall.copyWith(
                                color: AppColors.textSecondaryLight,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),

                      // Controls: Speed, Rewind 10s, Play/Pause, Forward 10s
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                        children: [
                          // Speed button
                          TextButton(
                            onPressed: () => _showSpeedDialog(context, notifier, playerState.speed),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                border: Border.all(color: AppColors.borderLight),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(
                                '${playerState.speed}x',
                                style: AppTypography.bodySmall.copyWith(
                                  fontWeight: FontWeight.bold,
                                  color: AppColors.primary,
                                ),
                              ),
                            ),
                          ),

                          // Rewind 10s
                          IconButton(
                            icon: const Icon(Icons.replay_10_rounded, size: 34),
                            color: Theme.of(context).colorScheme.onSurface,
                            onPressed: canPlay ? () => notifier.seekRelative(-10) : null,
                          ),

                          // Play / Pause Button
                          Container(
                            width: 64,
                            height: 64,
                            decoration: const BoxDecoration(
                              color: AppColors.primary,
                              shape: BoxShape.circle,
                            ),
                            child: IconButton(
                              icon: (playerState.isLoading || isResolving)
                                  ? const SizedBox(
                                      width: 24,
                                      height: 24,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2.5,
                                        valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                                      ),
                                    )
                                  : Icon(
                                      playerState.isPlaying
                                          ? Icons.pause_rounded
                                          : Icons.play_arrow_rounded,
                                      size: 36,
                                      color: Colors.white,
                                    ),
                              // Disabled until a real source is loaded: pressing play on a
                              // player that was handed nothing produced a silent no-op that
                              // read as a broken file.
                              onPressed: canPlay ? () => notifier.togglePlayPause() : null,
                            ),
                          ),

                          // Forward 10s
                          IconButton(
                            icon: const Icon(Icons.forward_10_rounded, size: 34),
                            color: Theme.of(context).colorScheme.onSurface,
                            onPressed: canPlay ? () => notifier.seekRelative(10) : null,
                          ),

                          const SizedBox(width: 48), // Balancing spacer
                        ],
                      ),
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _showSpeedDialog(BuildContext context, AudioPlayerNotifier notifier, double currentSpeed) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        final speeds = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'سرعة التشغيل',
                  style: AppTypography.titleMedium.copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 16),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: speeds.map((spd) {
                    final isSelected = spd == currentSpeed;
                    return ChoiceChip(
                      label: Text('${spd}x'),
                      selected: isSelected,
                      selectedColor: AppColors.primary,
                      labelStyle: TextStyle(
                        color: isSelected ? Colors.white : Theme.of(context).colorScheme.onSurface,
                        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                      ),
                      onSelected: (_) {
                        notifier.setSpeed(spd);
                        Navigator.of(ctx).pop();
                      },
                    );
                  }).toList(),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
