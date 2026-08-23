import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/app_constants.dart';
import '../../../core/network/error_handler.dart';
import '../../downloads/providers/downloads_notifier.dart';
import '../data/repositories/content_repository.dart';
import '../data/repositories/offline_content_repository.dart';
import '../domain/models/content_item_model.dart';
import '../domain/models/media_stream_model.dart';
import 'content_provider.dart';

/// Where a viewer should actually read an item's bytes from.
sealed class MediaSource {}

/// A file already on this device, saved by a previous download.
class LocalFileMediaSource extends MediaSource {
  final String path;
  LocalFileMediaSource(this.path);
}

/// A time-limited presigned URL from the server (ADR-013 Stage A).
class RemoteMediaSource extends MediaSource {
  final MediaStreamModel stream;
  RemoteMediaSource(this.stream);

  String get url => stream.url;
}

/// Resolves the playable source for one content item.
///
/// The players used to open `ContentItemModel.url` directly. For protected AUDIO
/// and PDF that field holds a CDN **thumbnail** or an empty string — never the
/// media file, because ADR-013 gives protected assets no permanent `cdn_url`. So
/// every protected item failed at the player, presenting as a corrupt file.
///
/// Resolution order, and why:
///
///   1. A downloaded file that still exists on disk. Cheaper, works offline, and
///      does not spend a signature.
///   2. `GET /content/:slug/media/stream` → a presigned URL valid for 60 minutes.
///
/// A missing local file falls through to the network rather than being reported as
/// available: the Isar row can outlive the file (OS cache eviction, manual
/// deletion, restore to a new device), and treating a stale row as a playable file
/// is exactly the fabricated-readiness failure POLICY-SEC-001 forbids.
///
/// Failures propagate. There is no placeholder source, no empty URL, and no silent
/// fall back to the thumbnail — the UI shows the real Arabic error instead.
class MediaSourceResolver {
  final IContentRepository content;
  final IOfflineContentRepository offline;

  /// Injected so tests can assert against a file that does or does not exist
  /// without touching the real filesystem.
  final Future<bool> Function(String path) _fileExists;

  MediaSourceResolver({
    required this.content,
    required this.offline,
    Future<bool> Function(String path)? fileExists,
  }) : _fileExists = fileExists ?? _defaultFileExists;

  static Future<bool> _defaultFileExists(String path) => File(path).exists();

  Future<MediaSource> resolve(ContentItemModel item) async {
    if (item.type != AppConstants.typeAudio && item.type != AppConstants.typePdf) {
      throw AppException(
        code: 'MEDIA_TYPE_UNSUPPORTED',
        message: 'نوع المحتوى «${item.type}» لا يحتاج إلى ملف وسائط',
      );
    }

    final local = await _localSource(item);
    if (local != null) return local;

    final stream = await content.getMediaStreamUrl(item.slug.isNotEmpty ? item.slug : item.id);
    return RemoteMediaSource(stream);
  }

  Future<LocalFileMediaSource?> _localSource(ContentItemModel item) async {
    final meta = await offline.getDownloadedItem(item.id);
    final path = meta?.localFilePath;
    if (path == null || path.trim().isEmpty) return null;

    // The row can outlive the file. Verifying the file itself is what keeps a
    // stale index from being reported as an available download.
    if (!await _fileExists(path)) return null;

    return LocalFileMediaSource(path);
  }
}

final mediaSourceResolverProvider = Provider<MediaSourceResolver>((ref) {
  return MediaSourceResolver(
    content: ref.watch(contentRepositoryProvider),
    offline: ref.watch(offlineContentRepositoryProvider),
  );
});

/// Resolved source for one item. `autoDispose` so a presigned URL is re-fetched on
/// the next visit instead of being reused past its expiry.
final mediaSourceProvider =
    FutureProvider.autoDispose.family<MediaSource, ContentItemModel>((ref, item) {
  return ref.watch(mediaSourceResolverProvider).resolve(item);
});
