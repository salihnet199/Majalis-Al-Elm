import 'package:equatable/equatable.dart';

class NotificationItemModel extends Equatable {
  final String id;
  final String title;
  final String body;
  final String category; // 'lesson', 'fatwa', 'announcement', 'general'
  final String channel;
  final bool isRead;
  final String? actionUrl;
  final DateTime createdAt;

  const NotificationItemModel({
    required this.id,
    required this.title,
    required this.body,
    required this.category,
    required this.channel,
    required this.isRead,
    this.actionUrl,
    required this.createdAt,
  });

  factory NotificationItemModel.fromJson(Map<String, dynamic> json) {
    return NotificationItemModel(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      body: json['body'] as String? ?? '',
      category: json['category'] as String? ?? 'announcement',
      channel: json['channel'] as String? ?? 'IN_APP',
      isRead: json['isRead'] as bool? ?? (json['readAt'] != null),
      actionUrl: json['actionUrl'] as String?,
      createdAt: json['createdAt'] != null
          ? DateTime.tryParse(json['createdAt'].toString()) ?? DateTime.now()
          : DateTime.now(),
    );
  }

  NotificationItemModel copyWith({
    String? id,
    String? title,
    String? body,
    String? category,
    String? channel,
    bool? isRead,
    String? actionUrl,
    DateTime? createdAt,
  }) {
    return NotificationItemModel(
      id: id ?? this.id,
      title: title ?? this.title,
      body: body ?? this.body,
      category: category ?? this.category,
      channel: channel ?? this.channel,
      isRead: isRead ?? this.isRead,
      actionUrl: actionUrl ?? this.actionUrl,
      createdAt: createdAt ?? this.createdAt,
    );
  }

  @override
  List<Object?> get props => [id, title, body, category, channel, isRead, actionUrl, createdAt];
}
