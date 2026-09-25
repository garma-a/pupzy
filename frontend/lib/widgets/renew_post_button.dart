import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../services/graphql_service.dart';
import '../services/safety_events.dart';

/// Explicit owner renewal for PRODUCT/ADOPTION listings — the only two
/// renewable post types (see post-expiry-and-renewal-contract.md). Only
/// meaningful for ACTIVE or EXPIRED listings; callers should not render
/// this for a closed (SOLD/ADOPTED/REMOVED) listing or a non-renewable
/// post type (RESCUE, LOST, MATING never expire and can't be renewed).
class RenewPostButton extends StatefulWidget {
  final String postId;

  /// Called with 'ACTIVE' after a successful renewal.
  final ValueChanged<String> onRenewed;

  const RenewPostButton({super.key, required this.postId, required this.onRenewed});

  @override
  State<RenewPostButton> createState() => _RenewPostButtonState();
}

class _RenewPostButtonState extends State<RenewPostButton> {
  bool _busy = false;

  Future<void> _renew() async {
    if (_busy) return;
    setState(() => _busy = true);
    final graphql = context.read<GraphQLService>();
    final (success, error) = await graphql.renewPost(widget.postId);
    if (!mounted) return;
    setState(() => _busy = false);
    if (!success) {
      final isCooldown = error?.toLowerCase().contains('cooldown') == true || error?.toUpperCase().contains('RENEWAL_COOLDOWN') == true;
      Fluttertoast.showToast(
        msg: isCooldown
            ? t(context, 'You can renew this listing again in a few days.', 'يمكنك تجديد هذا الإعلان مرة أخرى خلال أيام قليلة.')
            : (error ?? t(context, 'Could not renew. Try again.', 'تعذر التجديد. حاول مرة أخرى.')),
      );
      return;
    }
    context.read<SafetyEvents>().postsChanged();
    Fluttertoast.showToast(msg: t(context, 'Listing renewed', 'تم تجديد الإعلان'));
    widget.onRenewed('ACTIVE');
  }

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      key: const Key('renewPostButton'),
      onPressed: _busy ? null : _renew,
      icon: const Icon(Icons.refresh, size: 18),
      label: Text(t(context, 'Renew', 'تجديد')),
    );
  }
}
