import 'package:dio/dio.dart';
import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_response.dart';
import '../../../../core/network/error_handler.dart';
import '../../domain/models/category_model.dart';
import '../../domain/models/content_item_model.dart';
import '../../domain/models/tag_model.dart';

class ContentListResult {
  final List<ContentItemModel> items;
  final String? nextCursor;
  final String? prevCursor;
  final int limit;

  const ContentListResult({
    required this.items,
    this.nextCursor,
    this.prevCursor,
    this.limit = 20,
  });
}

abstract class IContentRepository {
  Future<ContentListResult> getContentList({
    String? type,
    String? category,
    String? cursor,
    int limit = 20,
    String locale = 'ar',
  });

  Future<ContentItemModel> getContentBySlug(
    String slug, {
    String locale = 'ar',
  });

  Future<List<CategoryModel>> getCategories({String locale = 'ar'});

  Future<List<TagModel>> getTags({String locale = 'ar'});

  Future<Map<String, dynamic>> getMediaStreamUrl(String slug);
}

class ContentRepository implements IContentRepository {
  final ApiClient apiClient;

  ContentRepository({required this.apiClient});

  @override
  Future<ContentListResult> getContentList({
    String? type,
    String? category,
    String? cursor,
    int limit = 20,
    String locale = 'ar',
  }) async {
    try {
      final queryParams = <String, dynamic>{
        'limit': limit,
        'locale': locale,
      };
      if (type != null && type.isNotEmpty) queryParams['type'] = type;
      if (category != null && category.isNotEmpty) queryParams['category'] = category;
      if (cursor != null && cursor.isNotEmpty) queryParams['cursor'] = cursor;

      final response = await apiClient.get(
        ApiEndpoints.contentList,
        queryParameters: queryParams,
      );

      final rawData = response.data;
      final payload = rawData is Map<String, dynamic> && rawData.containsKey('data')
          ? rawData['data']
          : rawData;

      final items = <ContentItemModel>[];
      if (payload is List) {
        for (final item in payload) {
          if (item is Map<String, dynamic>) {
            items.add(ContentItemModel.fromJson(item));
          }
        }
      }

      String? nextCursor;
      String? prevCursor;
      if (rawData is Map<String, dynamic> && rawData.containsKey('meta')) {
        final meta = rawData['meta'] as Map<String, dynamic>?;
        nextCursor = meta?['nextCursor'] as String?;
        prevCursor = meta?['prevCursor'] as String?;
      }

      return ContentListResult(
        items: items,
        nextCursor: nextCursor,
        prevCursor: prevCursor,
        limit: limit,
      );
    } on DioException catch (e) {
      if (e.response?.data != null && e.response?.data is Map<String, dynamic>) {
        final errorData = e.response!.data['error'];
        if (errorData != null) {
          throw AppException.fromApiError(ApiError.fromJson(errorData));
        }
      }
      throw AppException(
        code: 'NETWORK_ERROR',
        message: e.message ?? 'فشل جلب قائمة المحتوى',
      );
    }
  }

  @override
  Future<ContentItemModel> getContentBySlug(
    String slug, {
    String locale = 'ar',
  }) async {
    try {
      final response = await apiClient.get(
        ApiEndpoints.contentDetail(slug),
        queryParameters: {'locale': locale},
      );

      final rawData = response.data;
      final payload = rawData is Map<String, dynamic> && rawData.containsKey('data')
          ? rawData['data']
          : rawData;

      if (payload is Map<String, dynamic>) {
        return ContentItemModel.fromJson(payload);
      }

      throw const AppException(
        code: 'INVALID_DATA',
        message: 'بيانات المحتوى غير صالحة',
      );
    } on DioException catch (e) {
      if (e.response?.data != null && e.response?.data is Map<String, dynamic>) {
        final errorData = e.response!.data['error'];
        if (errorData != null) {
          throw AppException.fromApiError(ApiError.fromJson(errorData));
        }
      }
      throw AppException(
        code: 'CONTENT_NOT_FOUND',
        message: e.message ?? 'المحتوى المطلوب غير موجود',
      );
    }
  }

  @override
  Future<List<CategoryModel>> getCategories({String locale = 'ar'}) async {
    try {
      final response = await apiClient.get(
        ApiEndpoints.categories,
        queryParameters: {'locale': locale},
      );

      final rawData = response.data;
      final payload = rawData is Map<String, dynamic> && rawData.containsKey('data')
          ? rawData['data']
          : rawData;

      final categories = <CategoryModel>[];
      if (payload is List) {
        for (final item in payload) {
          if (item is Map<String, dynamic>) {
            categories.add(CategoryModel.fromJson(item));
          }
        }
      }
      return categories;
    } on DioException catch (e) {
      if (e.response?.data != null && e.response?.data is Map<String, dynamic>) {
        final errorData = e.response!.data['error'];
        if (errorData != null) {
          throw AppException.fromApiError(ApiError.fromJson(errorData));
        }
      }
      throw AppException(
        code: 'NETWORK_ERROR',
        message: e.message ?? 'فشل جلب التصنيفات',
      );
    }
  }

  @override
  Future<List<TagModel>> getTags({String locale = 'ar'}) async {
    try {
      final response = await apiClient.get(
        ApiEndpoints.tags,
        queryParameters: {'locale': locale},
      );

      final rawData = response.data;
      final payload = rawData is Map<String, dynamic> && rawData.containsKey('data')
          ? rawData['data']
          : rawData;

      final tags = <TagModel>[];
      if (payload is List) {
        for (final item in payload) {
          if (item is Map<String, dynamic>) {
            tags.add(TagModel.fromJson(item));
          }
        }
      }
      return tags;
    } on DioException catch (e) {
      if (e.response?.data != null && e.response?.data is Map<String, dynamic>) {
        final errorData = e.response!.data['error'];
        if (errorData != null) {
          throw AppException.fromApiError(ApiError.fromJson(errorData));
        }
      }
      throw AppException(
        code: 'NETWORK_ERROR',
        message: e.message ?? 'فشل جلب الوسوم',
      );
    }
  }

  @override
  Future<Map<String, dynamic>> getMediaStreamUrl(String slug) async {
    try {
      final response = await apiClient.get(
        ApiEndpoints.contentMediaStream(slug),
      );

      final rawData = response.data;
      final payload = rawData is Map<String, dynamic> && rawData.containsKey('data')
          ? rawData['data']
          : rawData;

      if (payload is Map<String, dynamic>) {
        return payload;
      }

      return {'url': ''};
    } on DioException catch (e) {
      if (e.response?.data != null && e.response?.data is Map<String, dynamic>) {
        final errorData = e.response!.data['error'];
        if (errorData != null) {
          throw AppException.fromApiError(ApiError.fromJson(errorData));
        }
      }
      throw AppException(
        code: 'STREAM_ERROR',
        message: e.message ?? 'فشل جلب رابط البث',
      );
    }
  }
}
