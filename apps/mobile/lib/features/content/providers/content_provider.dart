import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../auth/providers/auth_notifier.dart';
import '../data/repositories/content_repository.dart';

final contentRepositoryProvider = Provider<IContentRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return ContentRepository(apiClient: apiClient);
});
