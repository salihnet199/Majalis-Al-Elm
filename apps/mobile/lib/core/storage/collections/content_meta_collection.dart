import 'package:isar/isar.dart';

part 'content_meta_collection.g.dart';

@collection
class ContentMetaCollection {
  Id id = Isar.autoIncrement;

  @Index(unique: true, replace: true)
  late String contentId;

  late String slug;

  @Index()
  late String contentType; // 'AUDIO', 'PDF', 'TEXT', 'IMAGE'

  late String title;

  String? description;

  String? authorName;

  String? categoryName;

  String? thumbnailUrl;

  String? localFilePath;

  int? fileSizeBytes;

  int? durationMs;

  DateTime? downloadedAt;

  DateTime? lastOpenedAt; // for 'recently opened' sorting only - NO reading/listening position tracked
}
