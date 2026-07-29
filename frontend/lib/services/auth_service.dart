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
}
