import 'package:equatable/equatable.dart';

class TagModel extends Equatable {
  final String id;
  final String slug;
  final String name;

  const TagModel({
    required this.id,
    required this.slug,
    required this.name,
  });

  factory TagModel.fromJson(Map<String, dynamic> json) {
    return TagModel(
      id: json['id'] as String? ?? '',
      slug: json['slug'] as String? ?? '',
      name: json['name'] as String? ?? json['slug'] as String? ?? '',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'slug': slug,
      'name': name,
    };
  }

  @override
  List<Object?> get props => [id, slug, name];
}
