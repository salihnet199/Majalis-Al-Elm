import 'package:equatable/equatable.dart';

/// A time-limited presigned URL for one protected media file.
///
/// This is the payload of `GET /content/:slug/media/stream` (ADR-013 Stage A).
/// Protected AUDIO and PDF never receive a permanent `cdn_url`, so this URL is
/// the only way to reach their bytes — and it expires, so it must be fetched at
/// playback time rather than cached with the content item.
///
/// The model has no "empty" constructor on purpose. A stream response without a
/// usable URL is a failure, and POLICY-SEC-001 (docs/governance/TECHNICAL_DEBT.md)
/// forbids representing it as a success with a blank field: a player handed an
/// empty URL fails far from the cause, and looks like a broken file rather than a
/// broken response.
class MediaStreamModel extends Equatable {
  /// The presigned URL. Never empty — the parser rejects a response without one.
  final String url;

  /// When the signature stops being accepted by the storage provider.
  final DateTime? expiresAt;

  final String? mimeType;

  /// Size in bytes as verified in storage (`headObject`), not as claimed by the
  /// uploader. Used to show download progress against a real total.
  final int? sizeBytes;

  const MediaStreamModel({
    required this.url,
    this.expiresAt,
    this.mimeType,
    this.sizeBytes,
  });

  /// Returns null when the payload carries no usable URL, so the caller decides
  /// which error to raise rather than receiving a hollow object.
  static MediaStreamModel? tryParse(Object? payload) {
    if (payload is! Map<String, dynamic>) return null;

    final url = payload['url'];
    if (url is! String || url.trim().isEmpty) return null;

    final rawExpiry = payload['expiresAt'];
    final sizeBytes = payload['sizeBytes'];

    return MediaStreamModel(
      url: url,
      expiresAt: rawExpiry is String ? DateTime.tryParse(rawExpiry) : null,
      mimeType: payload['mimeType'] as String?,
      sizeBytes: sizeBytes is int ? sizeBytes : null,
    );
  }

  /// Whether the signature is already past its expiry, with a small margin so a
  /// URL that expires mid-request is treated as expired before it is used.
  bool isExpired({DateTime? now, Duration margin = const Duration(seconds: 30)}) {
    final expiry = expiresAt;
    if (expiry == null) return false;
    return (now ?? DateTime.now()).isAfter(expiry.subtract(margin));
  }

  @override
  List<Object?> get props => [url, expiresAt, mimeType, sizeBytes];
}
