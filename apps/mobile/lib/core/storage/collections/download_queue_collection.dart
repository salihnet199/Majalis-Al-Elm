import 'package:isar/isar.dart';

part 'download_queue_collection.g.dart';

@collection
class DownloadQueueCollection {
  Id id = Isar.autoIncrement;

  @Index(unique: true, replace: true)
  late String contentId;

  late String contentType;

  late String downloadUrl;

  late String targetLocalPath;

  /// Download state: 'PENDING', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED'
  @Index()
  String state = 'PENDING';

  /// Transient technical byte progress percentage (0.0 to 1.0)
  double progressPercent = 0.0;

  int attemptCount = 0;

  String? errorMessage;

  DateTime createdAt = DateTime.now();

  DateTime updatedAt = DateTime.now();
}
