import 'dart:ui';

import 'package:flutter/material.dart';

import '../localization/lang_provider.dart';
import '../theme/app_theme.dart';
import 'image_with_fallback.dart';

/// A rescue/lost-pet photo blurred behind a frosted "sensitive content"
/// hint, for feed thumbnails — these photos can show an injured or
/// distressed animal, so they stay blurred in list view too, not just on
/// the detail screen (which has its own interactive tap-to-reveal blur).
/// Non-interactive by design: tapping a feed card already navigates to the
/// detail screen, where the real reveal happens.
class BlurredThumbnail extends StatelessWidget {
  final String imageUrl;
  final double? width;
  final double height;

  const BlurredThumbnail({super.key, required this.imageUrl, this.width, required this.height});

  @override
  Widget build(BuildContext context) {
    // Small thumbnails (avatar-sized list tiles) don't have room for the
    // full "Tap to see photo" chip with its label — just show the icon.
    final compact = height < 100;
    return SizedBox(
      width: width,
      height: height,
      child: Stack(
        fit: StackFit.expand,
        children: [
          ImageWithFallback(url: imageUrl, width: width ?? double.infinity, height: height),
          ClipRect(
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
              child: Container(
                color: Colors.black.withValues(alpha: 0.25),
                child: Center(
                  child: compact
                      ? const Icon(Icons.visibility_outlined, color: Colors.white, size: 18)
                      : Container(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                          decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(AppRadius.chip)),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.visibility_outlined, color: Colors.white, size: 16),
                              const SizedBox(width: 6),
                              Text(
                                t(context, 'Tap to see photo', 'اضغط لرؤية الصورة'),
                                style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
                              ),
                            ],
                          ),
                        ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
