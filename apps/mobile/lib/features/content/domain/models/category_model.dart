import 'package:equatable/equatable.dart';

class CategoryModel extends Equatable {
  final String id;
  final String slug;
  final String name;
  final String? parentId;
  final int sortOrder;

  const CategoryModel({
    required this.id,
    required this.slug,
    required this.name,
    this.parentId,
    this.sortOrder = 0,
  });

  factory CategoryModel.fromJson(Map<String, dynamic> json) {
    return CategoryModel(
      id: json['id'] as String? ?? '',
      slug: json['slug'] as String? ?? '',
      name: json['name'] as String? ?? json['slug'] as String? ?? '',
      parentId: json['parentId'] as String?,
      sortOrder: json['sortOrder'] as int? ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'slug': slug,
      'name': name,
      'parentId': parentId,
      'sortOrder': sortOrder,
    };
  }

  @override
  List<Object?> get props => [id, slug, name, parentId, sortOrder];
}
