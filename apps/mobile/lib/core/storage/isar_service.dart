import 'package:isar/isar.dart';
import 'package:path_provider/path_provider.dart';
import 'collections/content_meta_collection.dart';
import 'collections/download_queue_collection.dart';
import 'collections/offline_text_collection.dart';
import 'collections/user_preference_collection.dart';

class IsarService {
  static Isar? _instance;

  static Future<Isar> getInstance() async {
    if (_instance != null && _instance!.isOpen) {
      return _instance!;
    }

    final dir = await getApplicationSupportDirectory();
    _instance = await Isar.open(
      [
        ContentMetaCollectionSchema,
        DownloadQueueCollectionSchema,
        OfflineTextCollectionSchema,
        UserPreferenceCollectionSchema,
      ],
      directory: dir.path,
      name: 'majlis_alim_local_db',
    );
    return _instance!;
  }

  static Future<void> close() async {
    if (_instance != null && _instance!.isOpen) {
      await _instance!.close();
      _instance = null;
    }
  }
}
