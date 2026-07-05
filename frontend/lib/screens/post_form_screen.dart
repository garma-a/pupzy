import 'dart:io';

import 'package:fluttertoast/fluttertoast.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../data/mock_data.dart';
import '../models/post.dart';
import '../theme/app_theme.dart';

class PostFormScreen extends StatefulWidget {
  final PostType type;

  const PostFormScreen({super.key, required this.type});

  @override
  State<PostFormScreen> createState() => _PostFormScreenState();
}

class _PostFormScreenState extends State<PostFormScreen> {
  final TextEditingController _captionController = TextEditingController();
  final List<XFile> _images = [];
  String? _selectedCategory;

  List<String> get _categories {
    switch (widget.type) {
      case PostType.adoption:
        return ['Dog', 'Puppy', 'Senior', 'Special Needs'];
      case PostType.rescue:
        return ['Urgent', 'Found', 'Lost', 'Needs Foster'];
      case PostType.product:
        return ['Food', 'Toys', 'Gear', 'Health'];
      case PostType.general:
        return ['Funny', 'Cute', 'Training', 'Story'];
    }
  }

  String get _title {
    switch (widget.type) {
      case PostType.adoption:
        return 'New Adoption Listing';
      case PostType.rescue:
        return 'New Rescue Alert';
      case PostType.product:
        return 'New Product';
      case PostType.general:
        return 'New Post';
    }
  }

  Future<void> _pickImage() async {
    if (_images.length >= 5) return;
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (picked != null) setState(() => _images.add(picked));
  }

  void _submit() {
    final caption = _captionController.text.trim();
    if (caption.isEmpty) {
      Fluttertoast.showToast(msg: 'Please add a caption');
      return;
    }
    MockData.posts.insert(
      0,
      Post(
        id: 'p${DateTime.now().millisecondsSinceEpoch}',
        username: 'pup_lover_22',
        avatarUrl: 'https://i.pravatar.cc/150?img=12',
        imageUrls: ['https://placedog.net/600/400?id=${DateTime.now().millisecondsSinceEpoch % 50}'],
        caption: caption,
        timestamp: DateTime.now(),
        type: widget.type,
      ),
    );
    Fluttertoast.showToast(msg: 'Post submitted!');
    Navigator.of(context).pop();
  }

  @override
  void dispose() {
    _captionController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_title)),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          Text('Photos', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: AppSpacing.sm),
          SizedBox(
            height: 90,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                ..._images.map(
                  (img) => Padding(
                    padding: const EdgeInsets.only(right: AppSpacing.sm),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: Image.file(
                        File(img.path),
                        width: 90,
                        height: 90,
                        fit: BoxFit.cover,
                        errorBuilder: (ctx, err, st) => Container(
                          width: 90,
                          height: 90,
                          color: AppColors.border,
                          child: const Icon(Icons.image),
                        ),
                      ),
                    ),
                  ),
                ),
                if (_images.length < 5)
                  InkWell(
                    onTap: _pickImage,
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      width: 90,
                      height: 90,
                      decoration: BoxDecoration(
                        border: Border.all(color: AppColors.border),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(Icons.add_a_photo_outlined, color: AppColors.textMuted),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Text('Caption', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: AppSpacing.sm),
          TextField(
            controller: _captionController,
            maxLines: 4,
            decoration: InputDecoration(
              hintText: 'Tell the community about it...',
              filled: true,
              fillColor: AppColors.background,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppRadius.card),
                borderSide: const BorderSide(color: AppColors.border),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Text('Category', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: AppSpacing.sm,
            children: _categories.map((c) {
              final selected = _selectedCategory == c;
              return ChoiceChip(
                label: Text(c),
                selected: selected,
                selectedColor: AppColors.primary.withValues(alpha: 0.15),
                onSelected: (_) => setState(() => _selectedCategory = c),
              );
            }).toList(),
          ),
          const SizedBox(height: AppSpacing.xxl),
          ElevatedButton(
            onPressed: _submit,
            child: const SizedBox(width: double.infinity, child: Text('Submit', textAlign: TextAlign.center)),
          ),
        ],
      ),
    );
  }
}
