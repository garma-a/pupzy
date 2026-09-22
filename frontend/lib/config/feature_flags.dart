import 'package:flutter/foundation.dart';

/// Rescue/found proof needs backend operations that are not deployed yet
/// (`submitRescueProof`, `postRescueProofs`, ...). Debug builds show it so it
/// can be built and reviewed; release builds hide it until it is switched on
/// with `--dart-define=RESCUE_PROOF_ENABLED=true`.
bool get kRescueProofEnabled => kDebugMode || const bool.fromEnvironment('RESCUE_PROOF_ENABLED');
