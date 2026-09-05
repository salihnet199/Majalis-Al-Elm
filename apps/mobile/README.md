# تطبيق مجالس العلم — Mobile

تطبيق Flutter الرسمي لمنصة مجالس العلم، يدعم المصادقة، تصفح المحتوى، تشغيل الصوتيات وقراءة PDF، والتنزيل المحلي للمواد المدعومة.

## المتطلبات

- Flutter SDK متوافق مع Dart `^3.12.2`.
- Android Studio/Xcode بحسب المنصة.
- Backend يعمل على `http://localhost:3000/api/v1` في بيئة التطوير.

## عنوان الـ API

يُمرر أثناء البناء عبر `--dart-define`:

```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

على Android Emulator استخدم `10.0.2.2` للوصول إلى خدمة `localhost` الموجودة على جهاز التطوير. على iOS Simulator أو Web يمكن استخدام `http://localhost:3000/api/v1`.

## التحقق قبل الإصدار

```bash
flutter pub get
flutter analyze
flutter test
flutter build apk --release --dart-define=API_BASE_URL=https://api.majalis-elm.app/api/v1
```

لا يُنصح بوضع عنوان الإنتاج داخل الشيفرة؛ مرره كـ `dart-define` في CI/CD.
