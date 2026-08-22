import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../domain/models/content_item_model.dart';

class ArticleReaderScreen extends StatefulWidget {
  final ContentItemModel item;

  const ArticleReaderScreen({
    super.key,
    required this.item,
  });

  @override
  State<ArticleReaderScreen> createState() => _ArticleReaderScreenState();
}

class _ArticleReaderScreenState extends State<ArticleReaderScreen> {
  double _fontSize = 18.0;

  void _increaseFontSize() {
    if (_fontSize < 28.0) {
      setState(() {
        _fontSize += 2.0;
      });
    }
  }

  void _decreaseFontSize() {
    if (_fontSize > 14.0) {
      setState(() {
        _fontSize -= 2.0;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = widget.item.textContent ?? widget.item.description;

    return Scaffold(
      appBar: AppBar(
        title: const Text('قراءة المقال'),
        actions: [
          // Font size controls
          IconButton(
            icon: const Icon(Icons.text_decrease_rounded),
            tooltip: 'تصغير الخط',
            onPressed: _decreaseFontSize,
          ),
          IconButton(
            icon: const Icon(Icons.text_increase_rounded),
            tooltip: 'تكبير الخط',
            onPressed: _increaseFontSize,
          ),
          IconButton(
            icon: const Icon(Icons.copy_rounded),
            tooltip: 'نسخ النص',
            onPressed: () {
              Clipboard.setData(ClipboardData(text: text));
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('تم نسخ نص المقال إلى الحافظة')),
              );
            },
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Article Header
              Text(
                widget.item.title,
                style: AppTypography.displayMedium.copyWith(
                  fontWeight: FontWeight.bold,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 12),

              Row(
                children: [
                  const Icon(Icons.person_outline_rounded, size: 16, color: AppColors.primary),
                  const SizedBox(width: 6),
                  Text(
                    widget.item.author,
                    style: AppTypography.bodySmall.copyWith(
                      color: AppColors.primary,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppColors.primary.withAlpha(20),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      'خط Amiri الأصيل',
                      style: AppTypography.bodySmall.copyWith(
                        fontSize: 10,
                        color: AppColors.primary,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
              const Divider(height: 28, color: AppColors.borderLight),

              // Article Body in Amiri Font
              SelectableText(
                text,
                style: AppTypography.articleBody.copyWith(
                  fontSize: _fontSize,
                  height: 1.9,
                  color: Theme.of(context).colorScheme.onSurface,
                ),
                textAlign: TextAlign.justify,
              ),

              const SizedBox(height: 40),
            ],
          ),
        ),
      ),
    );
  }
}
