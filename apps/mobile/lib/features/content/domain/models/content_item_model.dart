import 'package:equatable/equatable.dart';

class ContentItemModel extends Equatable {
  final String id;
  final String title;
  final String description;
  final String type; // AUDIO, PDF, TEXT, IMAGE
  final String url;
  final String author;
  final String? category;
  final int? durationSeconds;
  final int? pageCount;
  final String? textContent;
  final int fileSizeBytes;
  final bool isDownloaded;

  const ContentItemModel({
    required this.id,
    required this.title,
    required this.description,
    required this.type,
    required this.url,
    required this.author,
    this.category,
    this.durationSeconds,
    this.pageCount,
    this.textContent,
    this.fileSizeBytes = 0,
    this.isDownloaded = false,
  });

  factory ContentItemModel.fromJson(Map<String, dynamic> json) {
    final authorObj = json['author'];
    final authorName = authorObj is Map<String, dynamic>
        ? (authorObj['name'] as String? ?? '')
        : (json['author'] as String? ?? 'مجالس العالم');

    final categoryObj = json['category'];
    final categoryName = categoryObj is Map<String, dynamic>
        ? (categoryObj['name'] as String? ?? categoryObj['slug'] as String?)
        : (json['category'] as String?);

    final mediaObj = json['media'] as Map<String, dynamic>?;
    final durationMs = mediaObj?['durationMs'] as int?;
    final durationSec = durationMs != null ? (durationMs / 1000).round() : json['durationSeconds'] as int?;
    final pageCount = mediaObj?['pageCount'] as int? ?? json['pageCount'] as int?;
    final mediaUrl = mediaObj?['thumbnailUrl'] as String? ?? json['url'] as String? ?? '';

    return ContentItemModel(
      id: json['id'] as String? ?? json['slug'] as String? ?? '',
      title: json['title'] as String? ?? '',
      description: json['description'] as String? ?? '',
      type: json['type'] as String? ?? 'TEXT',
      url: mediaUrl,
      author: authorName.isNotEmpty ? authorName : 'مجالس العالم',
      category: categoryName,
      durationSeconds: durationSec,
      pageCount: pageCount,
      textContent: json['body'] as String? ?? json['textContent'] as String?,
      fileSizeBytes: json['fileSizeBytes'] as int? ?? 0,
      isDownloaded: json['isDownloaded'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
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
    };
  }

  @override
  List<Object?> get props => [
        id,
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
      ];
}
