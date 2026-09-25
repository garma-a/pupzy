import 'package:flutter/widgets.dart';

import '../localization/lang_provider.dart';

/// Short localized name of how a Post ended (or that it lapsed), for the
/// disabled action a visitor sees once it stops taking new requests.
String postOutcomeLabel(BuildContext context, String status) => switch (status) {
      'RESOLVED' => t(context, 'Resolved', 'تم الحل'),
      'REUNITED' => t(context, 'Reunited', 'تم لمّ الشمل'),
      'ADOPTED' => t(context, 'Adopted', 'تم التبني'),
      'SOLD' => t(context, 'Sold', 'مباع'),
      'EXPIRED' => t(context, 'Expired', 'منتهي'),
      _ => t(context, 'Closed', 'مغلق'),
    };

/// Label for the contact button when the Post no longer accepts new contact
/// requests and the viewer has none: says why instead of inviting a request
/// the backend would reject.
String closedToNewRequestsLabel(BuildContext context, String status) =>
    '${postOutcomeLabel(context, status)} — ${t(context, 'no new requests', 'لا تُقبل طلبات جديدة')}';

/// As [closedToNewRequestsLabel], for adoption applications.
String closedToNewApplicationsLabel(BuildContext context, String status) =>
    '${postOutcomeLabel(context, status)} — ${t(context, 'no new applications', 'لا تُقبل طلبات تبنٍّ جديدة')}';
