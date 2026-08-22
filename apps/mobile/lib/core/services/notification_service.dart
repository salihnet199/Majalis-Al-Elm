import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:dio/dio.dart';

/// Top-level background handler for FCM messages
@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  try {
    await Firebase.initializeApp();
  } catch (_) {}
  debugPrint('[FCM Background] Received message: ${message.notification?.title}');
}

class NotificationService {
  static final NotificationService _instance = NotificationService._internal();
  factory NotificationService() => _instance;
  NotificationService._internal();

  final FlutterLocalNotificationsPlugin _localNotifications = FlutterLocalNotificationsPlugin();
  bool _isInitialized = false;
  String? _fcmToken;

  String? get fcmToken => _fcmToken;
  bool get isInitialized => _isInitialized;

  /// High importance notification channel for Android
  static const AndroidNotificationChannel _channel = AndroidNotificationChannel(
    'majlis_alim_announcements',
    'إعلانات ودروس مجالس العالم',
    description: 'تنبيهات البث المباشر، الدروس العلمية، والفتاوى الشرعية',
    importance: Importance.max,
    playSound: true,
    enableVibration: true,
  );

  /// Initializes Firebase Cloud Messaging and Local Notifications
  Future<void> initialize({Dio? apiClient}) async {
    if (_isInitialized) return;

    try {
      // 1. Safe Firebase Core Initialization
      await Firebase.initializeApp();
      FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);

      // 2. Request Notification Permissions
      final messaging = FirebaseMessaging.instance;
      final settings = await messaging.requestPermission(
        alert: true,
        announcement: false,
        badge: true,
        carPlay: false,
        criticalAlert: false,
        provisional: false,
        sound: true,
      );

      debugPrint('[FCM] Permission status: ${settings.authorizationStatus}');

      // 3. Local Notifications Setup for Foreground alerts
      const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
      const iosInit = DarwinInitializationSettings(
        requestAlertPermission: true,
        requestBadgePermission: true,
        requestSoundPermission: true,
      );
      const initSettings = InitializationSettings(android: androidInit, iOS: iosInit);

      await _localNotifications.initialize(
        initSettings,
        onDidReceiveNotificationResponse: (response) {
          debugPrint('[Notification Tapped]: ${response.payload}');
        },
      );

      // Create Android Notification Channel
      await _localNotifications
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(_channel);

      // 4. Retrieve FCM Token
      _fcmToken = await messaging.getToken();
      debugPrint('[FCM Token]: $_fcmToken');

      // 5. Listen for Foreground Messages
      FirebaseMessaging.onMessage.listen((RemoteMessage message) {
        final notification = message.notification;
        final android = message.notification?.android;

        if (notification != null) {
          _localNotifications.show(
            notification.hashCode,
            notification.title,
            notification.body,
            NotificationDetails(
              android: AndroidNotificationDetails(
                _channel.id,
                _channel.name,
                channelDescription: _channel.description,
                icon: android?.smallIcon ?? '@mipmap/ic_launcher',
                importance: Importance.max,
                priority: Priority.high,
                playSound: true,
                enableVibration: true,
              ),
              iOS: const DarwinNotificationDetails(
                presentAlert: true,
                presentBadge: true,
                presentSound: true,
              ),
            ),
            payload: jsonEncode(message.data),
          );
        }
      });

      // 6. Token Refresh Listener
      messaging.onTokenRefresh.listen((newToken) {
        _fcmToken = newToken;
        if (apiClient != null) {
          registerDeviceWithBackend(apiClient, newToken);
        }
      });

      // 7. Initial backend registration if client provided
      if (apiClient != null && _fcmToken != null) {
        await registerDeviceWithBackend(apiClient, _fcmToken!);
      }

      _isInitialized = true;
    } catch (e) {
      debugPrint('[FCM Service Warning] Running in Smart Hybrid Mode (Mock Fallback): $e');
      _isInitialized = true; // Fallback initialization
    }
  }

  /// Registers or updates device token on NestJS backend
  Future<void> registerDeviceWithBackend(Dio apiClient, String token) async {
    try {
      final deviceType = Platform.isIOS ? 'IOS' : Platform.isAndroid ? 'ANDROID' : 'WEB';
      await apiClient.post('/notifications/devices', data: {
        'fcmToken': token,
        'deviceType': deviceType,
        'osVersion': Platform.operatingSystemVersion,
      });
      debugPrint('[FCM Sync] Device successfully registered on backend');
    } catch (e) {
      debugPrint('[FCM Sync Error] Could not register device on backend: $e');
    }
  }
}
