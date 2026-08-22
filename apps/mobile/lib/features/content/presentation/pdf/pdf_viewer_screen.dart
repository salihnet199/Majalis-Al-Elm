import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:pdfx/pdfx.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../domain/models/content_item_model.dart';

class PdfViewerScreen extends StatefulWidget {
  final ContentItemModel item;
  final bool isTestMode;

  const PdfViewerScreen({
    super.key,
    required this.item,
    this.isTestMode = false,
  });

  @override
  State<PdfViewerScreen> createState() => _PdfViewerScreenState();
}

class _PdfViewerScreenState extends State<PdfViewerScreen> {
  PdfController? _pdfController;
  int _actualPageNumber = 1;
  int _allPagesCount = 0;
  bool _isLoading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    if (!widget.isTestMode) {
      _initPdf();
    } else {
      _isLoading = false;
      _allPagesCount = widget.item.pageCount ?? 1;
    }
  }

  void _initPdf() {
    try {
      final url = widget.item.url;
      Future<PdfDocument> documentFuture;

      if (url.startsWith('asset://') || url.startsWith('assets/')) {
        final assetPath = url.replaceFirst('asset://', '');
        documentFuture = PdfDocument.openAsset(assetPath);
      } else if (url.startsWith('http://') || url.startsWith('https://')) {
        documentFuture = PdfDocument.openData(
          InternetAddressCustomLoader.load(url),
        );
      } else {
        documentFuture = PdfDocument.openFile(url);
      }

      _pdfController = PdfController(
        document: documentFuture,
      );
      setState(() {
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _isLoading = false;
        _errorMessage = 'تعذر فتح ملف PDF: ${e.toString()}';
      });
    }
  }

  @override
  void dispose() {
    _pdfController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final totalPages = _allPagesCount > 0 ? _allPagesCount : widget.item.pageCount ?? 1;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.item.title),
        actions: [
          IconButton(
            icon: Icon(
              widget.item.isDownloaded ? Icons.download_done_rounded : Icons.download_for_offline_outlined,
              color: widget.item.isDownloaded ? AppColors.secondary : null,
            ),
            tooltip: widget.item.isDownloaded ? 'محفوظ محلياً' : 'تنزيل للقراءة بدون إنترنت',
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    widget.item.isDownloaded
                        ? 'الكتاب محفوظ بالفعل في المحفوظات'
                        : 'جاري إضافة الكتاب إلى قائمة التنزيل',
                  ),
                ),
              );
            },
          ),
          IconButton(
            icon: const Icon(Icons.bookmark_border_rounded),
            tooltip: 'الانتقال إلى صفحة',
            onPressed: () => _showJumpPageDialog(context),
          ),
        ],
      ),
      body: Stack(
        children: [
          if (_isLoading)
            const Center(child: CircularProgressIndicator())
          else if (_errorMessage != null)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.error_outline_rounded, size: 48, color: AppColors.error),
                    const SizedBox(height: 16),
                    Text(
                      _errorMessage!,
                      textAlign: TextAlign.center,
                      style: AppTypography.bodyMedium.copyWith(color: AppColors.error),
                    ),
                  ],
                ),
              ),
            )
          else if (widget.isTestMode || _pdfController == null)
            Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.picture_as_pdf_rounded, size: 64, color: AppColors.primary),
                  const SizedBox(height: 16),
                  Text(
                    widget.item.title,
                    style: AppTypography.titleMedium.copyWith(fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'مكتبة كتب ومنشورات مجالس العلم',
                    style: AppTypography.bodySmall.copyWith(color: AppColors.textSecondaryLight),
                  ),
                ],
              ),
            )
          else
            PdfView(
              controller: _pdfController!,
              onDocumentLoaded: (document) {
                setState(() {
                  _allPagesCount = document.pagesCount;
                });
              },
              onPageChanged: (page) {
                setState(() {
                  _actualPageNumber = page;
                });
              },
            ),

          // Page Indicator Floating Capsule
          Positioned(
            bottom: 20,
            left: 0,
            right: 0,
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.black.withAlpha(180),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  'صفحة $_actualPageNumber من $totalPages',
                  style: AppTypography.bodySmall.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _showJumpPageDialog(BuildContext context) {
    final controller = TextEditingController(text: _actualPageNumber.toString());
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('انتقال إلى صفحة'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.number,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'رقم الصفحة',
            prefixIcon: Icon(Icons.numbers_rounded),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('إلغاء'),
          ),
          ElevatedButton(
            onPressed: () {
              final page = int.tryParse(controller.text);
              if (page != null && page > 0) {
                _pdfController?.animateToPage(
                  page,
                  duration: const Duration(milliseconds: 300),
                  curve: Curves.easeInOut,
                );
                setState(() {
                  _actualPageNumber = page;
                });
              }
              Navigator.of(ctx).pop();
            },
            child: const Text('انتقال'),
          ),
        ],
      ),
    );
  }
}

class InternetAddressCustomLoader {
  static Future<Uint8List> load(String url) async {
    return Uint8List(0);
  }
}
