import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';

import '../screens/adoption_detail_screen.dart';
import '../screens/mating_detail_screen.dart';
import '../screens/product_detail_screen.dart';
import '../screens/rescue_detail_screen.dart';
import '../services/graphql_service.dart';
import '../widgets/comments_sheet.dart';

/// Notifications about a Comment open the Post with its comments on top,
/// since the comment is what the notification is actually about.
const commentNotificationTypes = {
  'NEW_COMMENT',
  'NEW_REPLY',
  'COMMENT_BOOSTED',
  'COMMENT_PINNED',
};

/// Opens the Post a notification is about, from the inbox or a push tap.
///
/// Looks the Post up first: when it was removed or the viewer can no longer
/// reach it (for example after a Block) this shows [unavailableMessage] — or
/// the server's own message — instead of silently doing nothing, and returns
/// false. [beforeNavigate] runs only once the Post is known to be reachable
/// (the inbox uses it to close itself).
Future<bool> openNotificationTarget({
  required NavigatorState navigator,
  required GraphQLService graphql,
  required String type,
  required String postId,
  required String unavailableMessage,
  VoidCallback? beforeNavigate,
}) async {
  final (post, error) = await graphql.fetchPostDetail(postId);
  if (post == null) {
    Fluttertoast.showToast(msg: error ?? unavailableMessage);
    return false;
  }
  if (!navigator.mounted) return false;
  beforeNavigate?.call();

  final Widget screen = switch (post.postType) {
    'ADOPTION' => AdoptionDetailScreen(postId: postId),
    'PRODUCT' => ProductDetailScreen(postId: postId),
    'MATING' => MatingDetailScreen(postId: postId),
    _ => RescueDetailScreen(postId: postId),
  };
  navigator.push(MaterialPageRoute(builder: (_) => screen));

  if (commentNotificationTypes.contains(type)) {
    final me = await graphql.fetchMe();
    if (!navigator.mounted) return true;
    final isOwner = (me?['id'] as String?) == post.creator.id;
    // Opened on top of the detail screen that was just pushed, so closing
    // the comments leaves the reader on the Post.
    showModalBottomSheet(
      context: navigator.context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => CommentsSheet(postId: postId, isPostOwner: isOwner),
    );
  }
  return true;
}
