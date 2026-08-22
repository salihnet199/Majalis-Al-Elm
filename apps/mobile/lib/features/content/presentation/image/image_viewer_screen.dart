import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../domain/models/content_item_model.dart';

class ImageViewerScreen extends StatefulWidget {
  final ContentItemModel item;

  const ImageViewerScreen({
    super.key,
    required this.item,
  });

  @override
  State<ImageViewerScreen> createState() => _ImageViewerScreenState();
}

class _ImageViewerScreenState extends State<ImageViewerScreen> {
  final TransformationController _transformationController = TransformationController();
  TapDownDetails? _doubleTapDetails;
  bool _showInfo = true;

  @override
  void dispose() {
    _transformationController.dispose();
    super.dispose();
  }

  void _handleDoubleTap() {
    if (_transformationController.value != Matrix4.identity()) {
      _transformationController.value = Matrix4.identity();
    } else {
      final position = _doubleTapDetails?.localPosition ?? Offset.zero;
      _transformationController.value = Matrix4.diagonal3Values(2.5, 2.5, 1.0)
        ..setTranslationRaw(-position.dx * 1.5, -position.dy * 1.5, 0.0);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black.withAlpha(200),
        foregroundColor: Colors.white,
        title: Text(widget.item.title),
        actions: [
          IconButton(
            icon: Icon(_showInfo ? Icons.info_rounded : Icons.info_outline_rounded),
            tooltip: 'تفاصيل الصورة',
            onPressed: () {
              setState(() {
                _showInfo = !_showInfo;
              });
            },
          ),
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'إعادة ضبط التكبير',
            onPressed: () {
              _transformationController.value = Matrix4.identity();
            },
          ),
        ],
      ),
      body: Stack(
        children: [
          // Zoomable Image
          GestureDetector(
            onDoubleTapDown: (details) => _doubleTapDetails = details,
            onDoubleTap: _handleDoubleTap,
            child: Center(
              child: InteractiveViewer(
                transformationController: _transformationController,
                minScale: 0.8,
                maxScale: 5.0,
                child: widget.item.url.startsWith('http')
                    ? Image.network(
                        widget.item.url,
                        fit: BoxFit.contain,
                        errorBuilder: (ctx, _, __) => _buildPlaceholder(),
                      )
                    : widget.item.url.startsWith('asset') || widget.item.url.startsWith('assets')
                        ? Image.asset(
                            widget.item.url.replaceFirst('asset://', ''),
                            fit: BoxFit.contain,
                            errorBuilder: (ctx, _, __) => _buildPlaceholder(),
                          )
                        : _buildPlaceholder(),
              ),
            ),
          ),

          // Bottom Info Card
          if (_showInfo)
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [Colors.black.withAlpha(230), Colors.transparent],
                    begin: Alignment.bottomCenter,
                    end: Alignment.topCenter,
                  ),
                ),
                child: SafeArea(
                  top: false,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        widget.item.title,
                        style: AppTypography.titleMedium.copyWith(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      if (widget.item.description.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(
                          widget.item.description,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: AppTypography.bodySmall.copyWith(
                            color: Colors.white.withAlpha(200),
                          ),
                        ),
                      ],
                      const SizedBox(height: 6),
                      Text(
                        'إعداد: ${widget.item.author}',
                        style: AppTypography.bodySmall.copyWith(
                          color: AppColors.secondary,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildPlaceholder() {
    return Container(
      width: 320,
      height: 320,
      decoration: BoxDecoration(
        color: AppColors.primary.withAlpha(30),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.primaryLight.withAlpha(60)),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.image_rounded, size: 72, color: AppColors.primaryLight),
          const SizedBox(height: 16),
          Text(
            widget.item.title,
            textAlign: TextAlign.center,
            style: AppTypography.titleSmall.copyWith(color: Colors.white),
          ),
          const SizedBox(height: 6),
          Text(
            'انقر مرتين للتكبير / التصغير',
            style: AppTypography.bodySmall.copyWith(color: Colors.white.withAlpha(160)),
          ),
        ],
      ),
    );
  }
}
