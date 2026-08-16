import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class ImageWithFallback extends StatelessWidget {
  final String url;
  final double? width;
  final double? height;
  final BoxFit fit;
  final BorderRadius? borderRadius;

  const ImageWithFallback({
    super.key,
    required this.url,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.borderRadius,
  });

  @override
  Widget build(BuildContext context) {
    final isAsset = url.startsWith('assets/');
    // Decode at (roughly) the size the image will actually render at, not
    // whatever resolution the source file happens to be — keeps memory use
    // low when a full-size photo is shown as a small feed thumbnail.
    final dpr = MediaQuery.of(context).devicePixelRatio;
    // width/height are often double.infinity (fill available space) — only
    // ever pass a concrete decode size when the dimension is actually finite.
    final memCacheWidth = width != null && width!.isFinite ? (width! * dpr).round() : null;
    final memCacheHeight = height != null && height!.isFinite ? (height! * dpr).round() : null;
    final image = isAsset
        ? Image.asset(
            url,
            width: width,
            height: height,
            fit: fit,
            cacheWidth: memCacheWidth,
            cacheHeight: memCacheHeight,
            errorBuilder: (context, e, s) => Container(
              width: width,
              height: height,
              color: AppColors.border,
              child: const Icon(Icons.pets, color: AppColors.textMuted, size: 32),
            ),
          )
        : CachedNetworkImage(
            imageUrl: url,
            width: width,
            height: height,
            fit: fit,
            memCacheWidth: memCacheWidth,
            memCacheHeight: memCacheHeight,
            placeholder: (context, _) => Container(
              width: width,
              height: height,
              color: AppColors.border,
            ),
            errorWidget: (context, e, w) => Container(
              width: width,
              height: height,
              color: AppColors.border,
              child: const Icon(Icons.pets, color: AppColors.textMuted, size: 32),
            ),
          );

    if (borderRadius == null) return image;
    return ClipRRect(borderRadius: borderRadius!, child: image);
  }
}
