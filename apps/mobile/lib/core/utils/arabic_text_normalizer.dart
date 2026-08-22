class ArabicTextNormalizer {
  ArabicTextNormalizer._();

  // Arabic Diacritics Regex (Fathah, Dammah, Kasrah, Sukun, Shaddah, Tanween, etc.)
  static final RegExp _tashkeelRegex = RegExp(r'[\u064B-\u065F\u0670\u06D6-\u06ED]');

  /// Normalizes Arabic text for high-accuracy search:
  /// 1. Removes all diacritics / Tashkeel
  /// 2. Normalizes Alef forms (أ, إ, آ, ٱ -> ا)
  /// 3. Normalizes Taa Marbuta (ة -> ه)
  /// 4. Normalizes Yaa / Alef Maqsura (ى -> ي)
  /// 5. Removes Tatweel / Kashida (ـ)
  /// 6. Trims and lowers case
  static String normalize(String text) {
    if (text.isEmpty) return '';

    var normalized = text.replaceAll(_tashkeelRegex, '');

    // Remove Tatweel
    normalized = normalized.replaceAll('ـ', '');

    // Normalize Alefs
    normalized = normalized
        .replaceAll('أ', 'ا')
        .replaceAll('إ', 'ا')
        .replaceAll('آ', 'ا')
        .replaceAll('ٱ', 'ا');

    // Normalize Taa Marbuta
    normalized = normalized.replaceAll('ة', 'ه');

    // Normalize Alef Maqsura / Yaa
    normalized = normalized.replaceAll('ى', 'ي');

    return normalized.trim().toLowerCase();
  }

  /// Returns true if normalized [source] contains normalized [query]
  static bool matches(String source, String query) {
    if (query.trim().isEmpty) return true;
    final normalizedSource = normalize(source);
    final normalizedQuery = normalize(query);
    return normalizedSource.contains(normalizedQuery);
  }
}
