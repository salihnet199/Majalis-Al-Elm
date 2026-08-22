import 'package:isar/isar.dart';

part 'user_preference_collection.g.dart';

@collection
class UserPreferenceCollection {
  Id id = Isar.autoIncrement;

  @Index(unique: true, replace: true)
  late String userId;

  String themeMode = 'system'; // 'light', 'dark', 'system'

  @Index()
  String locale = 'ar'; // 'ar', 'en'

  double audioSpeed = 1.0;

  int? lastSyncTimestamp;
}
