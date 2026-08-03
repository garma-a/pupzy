import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';

/// Compose sheet for `requestContact` — sends a message to a RESCUE/LOST/
/// ADOPTION post's owner, asking them to approve sharing their WhatsApp.
/// Pops `true` on success.
class ContactRequestSheet extends StatefulWidget {
  final String postId;
  const ContactRequestSheet({super.key, required this.postId});

  @override
  State<ContactRequestSheet> createState() => _ContactRequestSheetState();
}

class _ContactRequestSheetState extends State<ContactRequestSheet> {
  final _controller = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final message = _controller.text.trim();
    if (message.isEmpty || _sending) return;
    setState(() => _sending = true);
    final graphql = context.read<GraphQLService>();
    final (request, error) = await graphql.requestContact(postId: widget.postId, message: message);
    if (!mounted) return;
    setState(() => _sending = false);
    if (request == null) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not send request. Try again.', 'تعذر إرسال الطلب. حاول مرة أخرى.'));
      return;
    }
    Navigator.of(context).pop(true);
    Fluttertoast.showToast(msg: t(context, 'Request sent', 'تم إرسال الطلب'));
  }

  @override
  Widget build(BuildContext context) {
    final bottomPad = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottomPad),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: const BoxDecoration(
          color: AppColors.background,
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(width: 40, height: 4, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2))),
            ),
            const SizedBox(height: AppSpacing.lg),
            Text(t(context, 'Send a contact request', 'إرسال طلب تواصل'), style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: AppSpacing.xs),
            Text(
              t(context, 'The owner will see your message and can approve to share their WhatsApp.', 'سيرى المالك رسالتك ويمكنه الموافقة لمشاركة رقم واتساب.'),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: AppSpacing.md),
            TextField(
              controller: _controller,
              maxLines: 4,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: t(context, 'Write your message...', 'اكتب رسالتك...'),
                filled: true,
                fillColor: AppColors.surfaceWarm,
                contentPadding: const EdgeInsets.all(16),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.card), borderSide: BorderSide.none),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: ElevatedButton(
                onPressed: _sending || _controller.text.trim().isEmpty ? null : _send,
                child: _sending
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : Text(t(context, 'Send Request', 'إرسال الطلب')),
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
        ),
      ),
    );
  }
}
