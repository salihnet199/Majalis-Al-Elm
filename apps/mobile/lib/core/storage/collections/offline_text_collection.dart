import 'package:isar/isar.dart';

part 'offline_text_collection.g.dart';

@collection
class OfflineTextCollection {
  Id id = Isar.autoIncrement;

  @Index(unique: true, replace: true)
  late String contentId;

  late String slug;

  @Index(caseSensitive: false)
  late String title;

  /// Full-text search index for Arabic, English, and other text bodies
  @Index(caseSensitive: false)
  late String body;

  String locale = 'ar';

  DateTime cachedAt = DateTime.now();
}
