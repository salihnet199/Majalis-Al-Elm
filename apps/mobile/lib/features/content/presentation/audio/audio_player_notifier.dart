import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:just_audio/just_audio.dart';
import 'package:equatable/equatable.dart';

class AudioPlayerState extends Equatable {
  final bool isPlaying;
  final bool isLoading;
  final Duration position;
  final Duration duration;
  final Duration bufferedPosition;
  final double speed;
  final String? errorMessage;

  const AudioPlayerState({
    this.isPlaying = false,
    this.isLoading = false,
    this.position = Duration.zero,
    this.duration = Duration.zero,
    this.bufferedPosition = Duration.zero,
    this.speed = 1.0,
    this.errorMessage,
  });

  AudioPlayerState copyWith({
    bool? isPlaying,
    bool? isLoading,
    Duration? position,
    Duration? duration,
    Duration? bufferedPosition,
    double? speed,
    String? errorMessage,
  }) {
    return AudioPlayerState(
      isPlaying: isPlaying ?? this.isPlaying,
      isLoading: isLoading ?? this.isLoading,
      position: position ?? this.position,
      duration: duration ?? this.duration,
      bufferedPosition: bufferedPosition ?? this.bufferedPosition,
      speed: speed ?? this.speed,
      errorMessage: errorMessage,
    );
  }

  @override
  List<Object?> get props => [
        isPlaying,
        isLoading,
        position,
        duration,
        bufferedPosition,
        speed,
        errorMessage,
      ];
}

class AudioPlayerNotifier extends StateNotifier<AudioPlayerState> {
  final AudioPlayer _player;

  AudioPlayerNotifier({AudioPlayer? player})
      : _player = player ?? AudioPlayer(),
        super(const AudioPlayerState()) {
    _initStreams();
  }

  AudioPlayer get player => _player;

  void _initStreams() {
    _player.playerStateStream.listen((playerState) {
      state = state.copyWith(
        isPlaying: playerState.playing,
        isLoading: playerState.processingState == ProcessingState.loading ||
            playerState.processingState == ProcessingState.buffering,
      );
    });

    _player.positionStream.listen((pos) {
      state = state.copyWith(position: pos);
    });

    _player.durationStream.listen((dur) {
      if (dur != null) {
        state = state.copyWith(duration: dur);
      }
    });

    _player.bufferedPositionStream.listen((buf) {
      state = state.copyWith(bufferedPosition: buf);
    });

    _player.speedStream.listen((spd) {
      state = state.copyWith(speed: spd);
    });
  }

  Future<void> loadAudio(String url) async {
    try {
      state = state.copyWith(isLoading: true, errorMessage: null);
      if (url.startsWith('http://') || url.startsWith('https://')) {
        await _player.setUrl(url);
      } else if (url.startsWith('asset://') || url.startsWith('assets/')) {
        final assetPath = url.replaceFirst('asset://', '');
        await _player.setAsset(assetPath);
      } else {
        await _player.setFilePath(url);
      }
      state = state.copyWith(isLoading: false);
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        errorMessage: 'تعذر تحميل الملف الصوتي: ${e.toString()}',
      );
    }
  }

  Future<void> play() async {
    await _player.play();
  }

  Future<void> pause() async {
    await _player.pause();
  }

  Future<void> togglePlayPause() async {
    if (_player.playing) {
      await _player.pause();
    } else {
      await _player.play();
    }
  }

  Future<void> seek(Duration position) async {
    await _player.seek(position);
  }

  Future<void> seekRelative(int seconds) async {
    final target = _player.position + Duration(seconds: seconds);
    if (target < Duration.zero) {
      await _player.seek(Duration.zero);
    } else if (target > (_player.duration ?? Duration.zero)) {
      await _player.seek(_player.duration ?? Duration.zero);
    } else {
      await _player.seek(target);
    }
  }

  Future<void> setSpeed(double speed) async {
    await _player.setSpeed(speed);
  }

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }
}

final audioPlayerProvider =
    StateNotifierProvider.autoDispose<AudioPlayerNotifier, AudioPlayerState>((ref) {
  final notifier = AudioPlayerNotifier();
  return notifier;
});
