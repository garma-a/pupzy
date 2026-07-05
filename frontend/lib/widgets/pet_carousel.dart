import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import 'image_with_fallback.dart';

class PetCarousel extends StatefulWidget {
  final List<String> imageUrls;
  final double height;
  final BorderRadius? borderRadius;

  const PetCarousel({super.key, required this.imageUrls, this.height = 320, this.borderRadius});

  @override
  State<PetCarousel> createState() => _PetCarouselState();
}

class _PetCarouselState extends State<PetCarousel> {
  final PageController _controller = PageController();
  int _index = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: widget.height,
      child: Stack(
        alignment: Alignment.bottomCenter,
        children: [
          ClipRRect(
            borderRadius: widget.borderRadius ?? BorderRadius.zero,
            child: PageView.builder(
              controller: _controller,
              itemCount: widget.imageUrls.length,
              onPageChanged: (i) => setState(() => _index = i),
              itemBuilder: (context, i) => ImageWithFallback(
                url: widget.imageUrls[i],
                width: double.infinity,
                height: widget.height,
              ),
            ),
          ),
          if (widget.imageUrls.length > 1)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.md),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: List.generate(widget.imageUrls.length, (i) {
                  return AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    margin: const EdgeInsets.symmetric(horizontal: 3),
                    width: i == _index ? 18 : 6,
                    height: 6,
                    decoration: BoxDecoration(
                      color: i == _index ? AppColors.primary : Colors.white,
                      borderRadius: BorderRadius.circular(3),
                      boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 2)],
                    ),
                  );
                }),
              ),
            ),
        ],
      ),
    );
  }
}
