import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../localization/lang_provider.dart';
import '../models/adoption_application.dart';
import '../services/adoption_application_lookup.dart';
import '../services/graphql_service.dart';
import 'adoption_application_sheet.dart';

/// The button on a feed card for an adoption listing. It shows the same state as the listing's
/// detail screen: "Ask to adopt" only when the viewer hasn't applied yet,
/// otherwise where their application stands. On the viewer's own listing it
/// opens the listing instead.
class AdoptCardButton extends StatefulWidget {
  final String postId;

  /// Who posted the listing; compared with [myUserId] to spot the viewer's own.
  final String? creatorId;

  /// The signed-in user's id, or null while it is still loading.
  final String? myUserId;

  /// Change this to make the button re-check the viewer's application, e.g.
  /// when the screen comes back into view.
  final int applicationCheck;
  final VoidCallback onOpenDetails;
  const AdoptCardButton({
    super.key,
    required this.postId,
    required this.creatorId,
    required this.myUserId,
    required this.applicationCheck,
    required this.onOpenDetails,
  });

  @override
  State<AdoptCardButton> createState() => _AdoptCardButtonState();
}

class _AdoptCardButtonState extends State<AdoptCardButton> {
  AdoptionApplication? _application;

  /// True until the first check finishes, so the button never offers a
  /// second application it would then have to take back.
  bool _checking = true;
  bool _openingWhatsApp = false;

  bool get _isMine => widget.myUserId != null && widget.myUserId == widget.creatorId;

  @override
  void initState() {
    super.initState();
    _check();
  }

  @override
  void didUpdateWidget(covariant AdoptCardButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.postId != widget.postId) {
      setState(() {
        _application = null;
        _checking = true;
      });
      _check();
    } else if (oldWidget.applicationCheck != widget.applicationCheck) {
      _check();
    }
  }

  Future<void> _check() async {
    final postId = widget.postId;
    final (mine, error) = await findMyAdoptionApplication(context.read<GraphQLService>(), postId);
    if (!mounted || widget.postId != postId) return;
    setState(() {
      _checking = false;
      // A failed check keeps what we knew; the server still refuses a
      // second application to the same listing.
      if (error == null) _application = mine;
    });
  }

  Future<void> _apply() async {
    final submitted = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => AdoptionApplicationSheet(postId: widget.postId),
    );
    if (submitted == true && mounted) await _check();
  }

  Future<void> _messageOwner(AdoptionApplication application) async {
    if (_openingWhatsApp) return;
    setState(() => _openingWhatsApp = true);
    final (link, error) = await context.read<GraphQLService>().getAdoptionWhatsAppLink(application.id);
    if (!mounted) return;
    setState(() => _openingWhatsApp = false);
    if (link == null) {
      Fluttertoast.showToast(msg: error ?? t(context, "This content isn't available.", 'هذا المحتوى غير متاح.'));
      return;
    }
    final opened = await launchUrl(Uri.parse(link), mode: LaunchMode.externalApplication);
    if (!opened && mounted) {
      Fluttertoast.showToast(msg: t(context, 'Could not open WhatsApp', 'تعذر فتح واتساب'));
    }
  }

  @override
  Widget build(BuildContext context) {
    final application = _application;
    final String label;
    VoidCallback? onPressed;
    if (_isMine) {
      label = t(context, 'View details', 'عرض التفاصيل');
      onPressed = widget.onOpenDetails;
    } else {
      switch (application?.status) {
        case 'PENDING':
          label = t(context, 'Application Sent ✓', 'تم إرسال الطلب ✓');
        case 'APPROVED':
          label = t(context, 'Message Owner on WhatsApp', 'راسل المالك على واتساب');
          onPressed = _openingWhatsApp ? null : () => _messageOwner(application!);
        case 'REJECTED':
          label = t(context, 'Application Declined', 'تم رفض الطلب');
        default:
          label = t(context, 'Ask to adopt', 'اطلب التبني');
          onPressed = _checking ? null : _apply;
      }
    }
    return ElevatedButton(
      onPressed: onPressed,
      style: ElevatedButton.styleFrom(minimumSize: const Size(double.infinity, 48)),
      child: Text(label),
    );
  }
}
