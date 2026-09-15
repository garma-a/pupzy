import 'package:flutter/material.dart';

/// Lets non-widget code (GraphQLService, in particular) trigger navigation
/// from deep in a data call — e.g. forcing the user to a dedicated
/// lockout screen the moment the backend rejects a request for being
/// banned or having an account deletion in progress — regardless of which
/// screen they were on when it happened.
final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();
