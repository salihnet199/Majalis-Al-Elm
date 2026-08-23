import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pdfx/pdfx.dart';
import '../../../../core/network/error_handler.dart';
import '../../../../core/network/media_file_fetcher.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../domain/models/content_item_model.dart';
import '../../providers/media_source_provider.dart';

class PdfViewerScreen extends ConsumerStatefulWidget {
  final ContentItemModel item;

  /// Renders the chrome without opening a document. Used by widget tests, which
  /// have neither a storage provider nor a real PDF to open.
  final bool isTestMode;

  const PdfViewerScreen({super.key, required this.item, this.isTestMode = false});

  @override
  ConsumerState<PdfViewerScreen> createState() => _PdfViewerScreenState();
}

class _PdfViewerScreenState extends ConsumerState<PdfViewerScreen> {
  PdfController? _pdfController;
  int _actualPageNumber = 1;
  int _allPagesCount = 0;
  String? _errorMessage;

  /// The source the current controller was built from, so a rebuild does not
  /// re-open the same document and a re-signed URL does open.
  String? _openedSource;

  @override
  void initState() {
    super.initState();
    if (widget.isTestMode) {
      _allPagesCount = widget.item.pageCount ?? 1;
    }
  }

  /// Opens the resolved source.
  ///
  /// The screen used to open `widget.item.url` — the item's public CDN thumbnail,
  /// which for a protected PDF is empty or points at an image, never the document
  /// (ADR-013 gives protected assets no permanent `cdn_url`). Worse, remote URLs
  /// went through a local `InternetAddressCustomLoader` that returned
  /// `Uint8List(0)` unconditionally, so the viewer opened a zero-byte document and
  /// reported success for a file it had never fetched. Both are gone: the source
  /// comes from `mediaSourceProvider` and remote bytes are really downloaded.
  Future<void> _open(MediaSource source) async {
    final target = switch (source) {
      LocalFileMediaSource(path: final p) => p,
      RemoteMediaSource(url: final u) => u,
    };

    if (_openedSource == target) return;
    _openedSource = target;

    try {
      final Future<PdfDocument> documentFuture = switch (source) {
        LocalFileMediaSource(path: final p) => PdfDocument.openFile(p),
        RemoteMediaSource(url: final u) =>
          ref.read(mediaFileFetcherProvider).fetch(u).then(PdfDocument.openData),
      };

      // Awaited here rather than handed to PdfController unresolved, so a failed
      // download surfaces as an Arabic error instead of an exception thrown inside
      // the viewer's own future.
      final document = await documentFuture;
      if (!mounted) return;

      final controller = PdfController(document: Future.value(document));
      setState(() {
        _pdfController?.dispose();
        _pdfController = controller;
        _errorMessage = null;
      });
    } on AppException catch (e) {
      if (!mounted) return;
      // Allows "إعادة المحاولة" to retry the same source.
      _openedSource = null;
      setState(() => _errorMessage = e.message);
    } catch (e) {
      if (!mounted) return;
      _openedSource = null;
      setState(() => _errorMessage = 'تعذر فتح ملف PDF: $e');
    }
  }

  String _resolutionMessage(Object error) {
    if (error is AppException) return error.message;
    return 'تعذر تجهيز ملف PDF: $error';
  }

  @override
  void dispose() {
    _pdfController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final totalPages = _allPagesCount > 0 ? _allPagesCount : widget.item.pageCount ?? 1;

    // In test mode nothing is resolved and nothing is opened; the chrome is the
    // subject. Watching the provider here would try to reach the network.
    final sourceAsync = widget.isTestMode
        ? const AsyncValue<MediaSource>.loading()
        : ref.watch(mediaSourceProvider(widget.item));

    if (!widget.isTestMode) {
      sourceAsync.whenData((source) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _open(source);
        });
      });
    }

    final errorMessage =
        _errorMessage ?? (sourceAsync.hasError ? _resolutionMessage(sourceAsync.error!) : null);

    final isBusy = errorMessage == null && _pdfController == null && !widget.isTestMode;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.item.title),
        actions: [
          IconButton(
            icon: Icon(
              widget.item.isDownloaded
                  ? Icons.download_done_rounded
                  : Icons.download_for_offline_outlined,
              color: widget.item.isDownloaded ? AppColors.secondary : null,
            ),
            tooltip: widget.item.isDownloaded ? 'محفوظ محلياً' : 'التنزيل للقراءة بدون إنترنت',
            onPressed: () {
              // This used to say "جاري إضافة الكتاب إلى قائمة التنزيل" while
              // nothing was queued and no file was written — a success message for
              // an operation that does not exist (POLICY-SEC-001 category 3).
              // The offline downloader is TECH-DEBT-016; until it exists the
              // button states the truth.
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    widget.item.isDownloaded
                        ? 'الكتاب محفوظ بالفعل في المحفوظات'
                        : 'التنزيل للقراءة بدون إنترنت غير متاح بعد — القراءة تعمل عبر الإنترنت',
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
          if (isBusy)
            const Center(child: CircularProgressIndicator())
          else if (errorMessage != null)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.error_outline_rounded, size: 48, color: AppColors.error),
                    const SizedBox(height: 16),
                    Text(
                      errorMessage,
                      textAlign: TextAlign.center,
                      style: AppTypography.bodyMedium.copyWith(color: AppColors.error),
                    ),
                    const SizedBox(height: 16),
                    TextButton.icon(
                      onPressed: () {
                        setState(() => _errorMessage = null);
                        _openedSource = null;
                        ref.invalidate(mediaSourceProvider(widget.item));
                      },
                      icon: const Icon(Icons.refresh_rounded),
                      label: const Text('إعادة المحاولة'),
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
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('إلغاء')),
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
