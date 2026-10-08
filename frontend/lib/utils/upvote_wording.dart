import 'package:flutter/material.dart';

import '../localization/lang_provider.dart';

/// What the upvote on a Post is called, by post type: people *support* a
/// Rescue or Lost & Found case and *like* an Adoption or Find a Mate listing.
/// Marketplace listings have no upvote.
class UpvoteWording {
  const UpvoteWording._(this._isSupport);

  factory UpvoteWording.of(String postType) => UpvoteWording._(postType == 'RESCUE' || postType == 'LOST');

  final bool _isSupport;

  /// The button before tapping: "Support" / "Like".
  String action(BuildContext context) =>
      _isSupport ? t(context, 'Support', 'ادعم') : t(context, 'Like', 'أعجبني');

  /// The button once tapped: "Supported" / "Liked".
  String done(BuildContext context) =>
      _isSupport ? t(context, 'Supported', 'تم الدعم') : t(context, 'Liked', 'تم الإعجاب');

  /// A count in a summary line, e.g. "3 supports" / "3 likes".
  String count(BuildContext context, int n) => _isSupport
      ? '$n ${t(context, n == 1 ? 'support' : 'supports', 'دعم')}'
      : '$n ${t(context, n == 1 ? 'like' : 'likes', 'إعجاب')}';

  /// Shown when the toggle fails.
  String failed(BuildContext context) => _isSupport
      ? t(context, 'Could not update support. Try again.', 'تعذر تحديث الدعم. حاول مرة أخرى.')
      : t(context, 'Could not update like. Try again.', 'تعذر تحديث الإعجاب. حاول مرة أخرى.');

  /// Why the owner's own button is disabled.
  String notOwnPost(BuildContext context) => _isSupport
      ? t(context, "You can't support your own post", 'لا يمكنك دعم منشورك الخاص')
      : t(context, "You can't like your own post", 'لا يمكنك الإعجاب بمنشورك الخاص');

  IconData get icon => _isSupport ? Icons.volunteer_activism_outlined : Icons.thumb_up_outlined;
  IconData get doneIcon => _isSupport ? Icons.volunteer_activism : Icons.thumb_up;
}
