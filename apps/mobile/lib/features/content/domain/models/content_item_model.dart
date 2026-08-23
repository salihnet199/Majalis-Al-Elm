import 'package:equatable/equatable.dart';

class ContentItemModel extends Equatable {
  final String id;

  /// The URL-safe identifier the API addresses this item by. Protected media is
  /// fetched as `GET /content/:slug/media/stream`, so without it AUDIO and PDF
  /// cannot be played at all.
  final String slug;

  final String title;
  final String description;
  final String type; // AUDIO, PDF, TEXT, IMAGE

  /// The item's **public** URL — the CDN thumbnail, or the image itself for
  /// IMAGE items. It is NOT the protected media file: per ADR-013 an AUDIO or PDF
  /// asset never receives a permanent `cdn_url`, so this is empty or a thumbnail
  /// for them. Playing it directly is what made the player fail on every
  /// protected item. Resolve those through `mediaSourceProvider` instead.
  final String url;

  final String author;
  final String? category;
  final int? durationSeconds;
  final int? pageCount;
  final String? textContent;
  final int fileSizeBytes;
  final bool isDownloaded;

  /// Whether the server verified real bytes in storage for this item's media
  /// (`upload_status = COMPLETED`). The stream endpoint answers 409 when it is
  /// false, so the UI uses this to avoid offering playback that cannot work.
  ///
  /// Absent from a response means "not known to be available" — false, never an
  /// optimistic true.
  final bool isMediaAvailable;

  const ContentItemModel({
    required this.id,
    required this.title,
    required this.description,
    required this.type,
    required this.url,
    required this.author,
    this.slug = '',
    this.category,
    this.durationSeconds,
    this.pageCount,
    this.textContent,
    this.fileSizeBytes = 0,
    this.isDownloaded = false,
    this.isMediaAvailable = false,
  });

  factory ContentItemModel.fromJson(Map<String, dynamic> json) {
    final authorObj = json['author'];
    final authorName = authorObj is Map<String, dynamic>
        ? (authorObj['name'] as String? ?? '')
        : (json['author'] as String? ?? 'مجالس العلم');

    final categoryObj = json['category'];
    final categoryName = categoryObj is Map<String, dynamic>
        ? (categoryObj['name'] as String? ?? categoryObj['slug'] as String?)
        : (json['category'] as String?);

    final mediaObj = json['media'] as Map<String, dynamic>?;
    final durationMs = mediaObj?['durationMs'] as int?;
    final durationSec = durationMs != null ? (durationMs / 1000).round() : json['durationSeconds'] as int?;
    final pageCount = mediaObj?['pageCount'] as int? ?? json['pageCount'] as int?;
    final mediaUrl = mediaObj?['thumbnailUrl'] as String? ?? json['url'] as String? ?? '';

    final id = json['id'] as String? ?? json['slug'] as String? ?? '';

    return ContentItemModel(
      id: id,
      // Both list and detail responses carry `slug`; falling back to `id` covers
      // rows restored from local storage, which key on the content id.
      slug: json['slug'] as String? ?? id,
      title: json['title'] as String? ?? '',
      description: json['description'] as String? ?? '',
      type: json['type'] as String? ?? 'TEXT',
      url: mediaUrl,
      author: authorName.isNotEmpty ? authorName : 'مجالس العلم',
      category: categoryName,
      durationSeconds: durationSec,
      pageCount: pageCount,
      textContent: json['body'] as String? ?? json['textContent'] as String?,
      fileSizeBytes: json['fileSizeBytes'] as int? ?? 0,
      isDownloaded: json['isDownloaded'] as bool? ?? false,
      isMediaAvailable: mediaObj?['isAvailable'] as bool? ?? json['isMediaAvailable'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'slug': slug,
      'title': title,
      'description': description,
      'type': type,
      'url': url,
      'author': author,
      'category': category,
      'durationSeconds': durationSeconds,
      'pageCount': pageCount,
      'textContent': textContent,
      'fileSizeBytes': fileSizeBytes,
      'isDownloaded': isDownloaded,
      'isMediaAvailable': isMediaAvailable,
    };
  }

  @override
  List<Object?> get props => [
        id,
        slug,
        title,
        description,
        type,
        url,
        author,
        category,
        durationSeconds,
        pageCount,
        textContent,
        fileSizeBytes,
        isDownloaded,
        isMediaAvailable,
      ];
}
