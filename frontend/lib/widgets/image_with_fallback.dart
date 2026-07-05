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
    final image = isAsset
        ? Image.asset(
            url,
            width: width,
            height: height,
            fit: fit,
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
