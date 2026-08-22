import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/utils/arabic_text_normalizer.dart';

void main() {
  group('ArabicTextNormalizer Unit Tests', () {
    test('removes Arabic diacritics / Tashkeel correctly', () {
      const input = 'شَرْحُ ثَلَاثَةِ الأُصُولِ وَأَدِلَّتِهَا';
      final normalized = ArabicTextNormalizer.normalize(input);
      expect(normalized, 'شرح ثلاثه الاصول وادلتها');
    });

    test('normalizes different forms of Alef (أ, إ, آ, ٱ -> ا)', () {
      const input = 'إِسْلَام أَحْمَد قُرْآن ٱسْم';
      final normalized = ArabicTextNormalizer.normalize(input);
      expect(normalized, 'اسلام احمد قران اسم');
    });

    test('normalizes Taa Marbuta and Alef Maqsura (ة -> ه, ى -> ي)', () {
      const input = 'صَلَاة مُوسَى هِدَايَة فَتْوَى';
      final normalized = ArabicTextNormalizer.normalize(input);
      expect(normalized, 'صلاه موسي هدايه فتوي');
    });

    test('matches Arabic search queries regardless of Tashkeel or Alef forms', () {
      const sourceText = 'كِتَابُ التَّوْحِيدِ الَّذِي هُوَ حَقُّ اللَّهِ عَلَى العَبِيدِ';
      expect(ArabicTextNormalizer.matches(sourceText, 'التوحيد'), isTrue);
      expect(ArabicTextNormalizer.matches(sourceText, 'التَّوْحِيد'), isTrue);
      expect(ArabicTextNormalizer.matches(sourceText, 'علي العبيد'), isTrue);
      expect(ArabicTextNormalizer.matches(sourceText, 'كتاب'), isTrue);
      expect(ArabicTextNormalizer.matches(sourceText, 'الفقه'), isFalse);
    });

    test('handles empty and whitespace strings gracefully', () {
      expect(ArabicTextNormalizer.normalize(''), '');
      expect(ArabicTextNormalizer.normalize('   '), '');
      expect(ArabicTextNormalizer.matches('نص اختباري', ''), isTrue);
    });
  });
}
