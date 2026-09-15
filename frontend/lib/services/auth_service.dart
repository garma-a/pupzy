import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

class AuthService extends ChangeNotifier {
  final FirebaseAuth _auth = FirebaseAuth.instance;

  User? get currentUser => _auth.currentUser;
  bool get isLoggedIn => _auth.currentUser != null;

  Stream<User?> get authStateChanges => _auth.authStateChanges();

  Future<String?> getIdToken() async {
    return await _auth.currentUser?.getIdToken();
  }

  Future<UserCredential?> signInWithGoogle() async {
    final googleUser = await GoogleSignIn().signIn();
    if (googleUser == null) return null;

    final googleAuth = await googleUser.authentication;
    final credential = GoogleAuthProvider.credential(
      accessToken: googleAuth.accessToken,
      idToken: googleAuth.idToken,
    );

    final result = await _auth.signInWithCredential(credential);
    notifyListeners();
    return result;
  }

  /// Creates a new account with email + password and sends a verification
  /// email. The backend rejects unverified email/password sign-ins, so the
  /// caller must gate navigation on `currentUser.emailVerified`.
  Future<UserCredential> signUpWithEmail(String email, String password) async {
    final result = await _auth.createUserWithEmailAndPassword(email: email, password: password);
    await result.user?.sendEmailVerification();
    notifyListeners();
    return result;
  }

  Future<UserCredential> signInWithEmail(String email, String password) async {
    final result = await _auth.signInWithEmailAndPassword(email: email, password: password);
    notifyListeners();
    return result;
  }

  /// Syncs the display name to Firebase Auth itself (not just the backend
  /// profile) so Firebase-sourced UI — e.g. the top bar avatar initial —
  /// shows correctly. Google sign-in sets this automatically; email/password
  /// accounts never get a displayName otherwise.
  Future<void> updateDisplayName(String name) async {
    await _auth.currentUser?.updateDisplayName(name);
    await _auth.currentUser?.reload();
    notifyListeners();
  }

  Future<void> sendPasswordResetEmail(String email) async {
    await _auth.sendPasswordResetEmail(email: email);
  }

  Future<void> resendVerificationEmail() async {
    await _auth.currentUser?.sendEmailVerification();
  }

  /// Refreshes the cached Firebase user (e.g. to pick up a fresh
  /// `emailVerified` value after the user clicks the link in their inbox).
  ///
  /// `reload()` alone only updates the local `User.emailVerified` flag — it
  /// does NOT refresh the cached ID token, which Firebase keeps valid for up
  /// to an hour. The backend reads `email_verified` from that token's claims,
  /// not from a live lookup, so without a forced token refresh every GraphQL
  /// request keeps sending the stale pre-verification token and the backend
  /// keeps rejecting it — even though the client-side check now says
  /// "verified". Force-refreshing here fixes both.
  Future<void> reloadUser() async {
    await _auth.currentUser?.reload();
    await _auth.currentUser?.getIdToken(true);
    notifyListeners();
  }

  Future<void> signOut() async {
    await GoogleSignIn().signOut();
    await _auth.signOut();
    notifyListeners();
  }

  /// Whether the current user's primary sign-in method is Google
  /// (vs. email/password) — determines which re-auth flow to show before
  /// a sensitive action like account deletion.
  bool get signedInWithGoogle {
    final providers = _auth.currentUser?.providerData ?? const [];
    return providers.any((p) => p.providerId == 'google.com');
  }

  /// Re-confirms the user's identity via Google, refreshing the Firebase
  /// session's `auth_time` to "now". Required by the backend before
  /// deleteMyAccount, which only accepts requests authenticated within the
  /// preceding 5 minutes. Throws if the user cancels or re-auth fails.
  Future<void> reauthenticateWithGoogle() async {
    final user = _auth.currentUser;
    if (user == null) throw StateError('No signed-in user to re-authenticate.');
    final googleUser = await GoogleSignIn().signIn();
    if (googleUser == null) throw StateError('Re-authentication cancelled.');
    final googleAuth = await googleUser.authentication;
    final credential = GoogleAuthProvider.credential(
      accessToken: googleAuth.accessToken,
      idToken: googleAuth.idToken,
    );
    await user.reauthenticateWithCredential(credential);
    notifyListeners();
  }

  /// Re-confirms the user's identity via their account password. Same
  /// purpose as [reauthenticateWithGoogle], for email/password accounts.
  Future<void> reauthenticateWithPassword(String password) async {
    final user = _auth.currentUser;
    final email = user?.email;
    if (user == null || email == null) throw StateError('No signed-in email/password user to re-authenticate.');
    final credential = EmailAuthProvider.credential(email: email, password: password);
    await user.reauthenticateWithCredential(credential);
    notifyListeners();
  }
}
