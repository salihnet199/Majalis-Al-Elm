import 'package:equatable/equatable.dart';

class UserModel extends Equatable {
  final String id;
  final String fullName;
  final String? email;
  final String? phoneE164;
  final String role;
  final String locale;
  final String theme;
  final double audioSpeed;

  const UserModel({
    required this.id,
    required this.fullName,
    this.email,
    this.phoneE164,
    required this.role,
    this.locale = 'ar',
    this.theme = 'system',
    this.audioSpeed = 1.0,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      id: json['id'] as String,
      fullName: json['fullName'] as String,
      email: json['email'] as String?,
      phoneE164: json['phoneE164'] as String?,
      role: json['role'] as String? ?? 'User',
      locale: json['locale'] as String? ?? 'ar',
      theme: json['theme'] as String? ?? 'system',
      audioSpeed: (json['audioSpeed'] as num?)?.toDouble() ?? 1.0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'fullName': fullName,
      'email': email,
      'phoneE164': phoneE164,
      'role': role,
      'locale': locale,
      'theme': theme,
      'audioSpeed': audioSpeed,
    };
  }

  UserModel copyWith({
    String? id,
    String? fullName,
    String? email,
    String? phoneE164,
    String? role,
    String? locale,
    String? theme,
    double? audioSpeed,
  }) {
    return UserModel(
      id: id ?? this.id,
      fullName: fullName ?? this.fullName,
      email: email ?? this.email,
      phoneE164: phoneE164 ?? this.phoneE164,
      role: role ?? this.role,
      locale: locale ?? this.locale,
      theme: theme ?? this.theme,
      audioSpeed: audioSpeed ?? this.audioSpeed,
    );
  }

  @override
  List<Object?> get props => [id, fullName, email, phoneE164, role, locale, theme, audioSpeed];
}
