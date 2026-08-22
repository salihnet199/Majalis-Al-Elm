import 'package:equatable/equatable.dart';

class NotificationPreferencesModel extends Equatable {
  final bool enableLessons;
  final bool enableFatwas;
  final bool enableAnnouncements;
  final bool enablePush;
  final bool enableEmail;

  const NotificationPreferencesModel({
    this.enableLessons = true,
    this.enableFatwas = true,
    this.enableAnnouncements = true,
    this.enablePush = true,
    this.enableEmail = false,
  });

  factory NotificationPreferencesModel.fromJson(Map<String, dynamic> json) {
    return NotificationPreferencesModel(
      enableLessons: json['enableLessons'] as bool? ?? json['lessons'] as bool? ?? true,
      enableFatwas: json['enableFatwas'] as bool? ?? json['fatwas'] as bool? ?? true,
      enableAnnouncements: json['enableAnnouncements'] as bool? ?? json['announcements'] as bool? ?? true,
      enablePush: json['enablePush'] as bool? ?? json['push'] as bool? ?? true,
      enableEmail: json['enableEmail'] as bool? ?? json['email'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'enableLessons': enableLessons,
      'enableFatwas': enableFatwas,
      'enableAnnouncements': enableAnnouncements,
      'enablePush': enablePush,
      'enableEmail': enableEmail,
    };
  }

  NotificationPreferencesModel copyWith({
    bool? enableLessons,
    bool? enableFatwas,
    bool? enableAnnouncements,
    bool? enablePush,
    bool? enableEmail,
  }) {
    return NotificationPreferencesModel(
      enableLessons: enableLessons ?? this.enableLessons,
      enableFatwas: enableFatwas ?? this.enableFatwas,
      enableAnnouncements: enableAnnouncements ?? this.enableAnnouncements,
      enablePush: enablePush ?? this.enablePush,
      enableEmail: enableEmail ?? this.enableEmail,
    );
  }

  @override
  List<Object?> get props => [
        enableLessons,
        enableFatwas,
        enableAnnouncements,
        enablePush,
        enableEmail,
      ];
}
