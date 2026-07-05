import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/auth_service.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import 'login_screen.dart';

class ProfileSheet extends StatefulWidget {
  const ProfileSheet({super.key});

  @override
  State<ProfileSheet> createState() => _ProfileSheetState();
}

class _ProfileSheetState extends State<ProfileSheet> {
  bool _english = true;
  Map<String, dynamic>? _user;
  bool _loadingProfile = true;

  @override
  void initState() {
    super.initState();
    _fetchProfile();
  }

  Future<void> _fetchProfile() async {
    final graphql = context.read<GraphQLService>();
    final data = await graphql.fetchMe();
    if (mounted) {
      setState(() {
        _user = data;
        _loadingProfile = false;
        if (data != null && data['languagePreference'] == 'ar') {
          _english = false;
        }
      });
    }
  }

  Future<void> _signOut() async {
    final auth = context.read<AuthService>();
    await auth.signOut();
    if (mounted) {
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const LoginScreen()),
        (_) => false,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.read<AuthService>();
    final firebaseUser = auth.currentUser;
    final displayName = _user?['fullName'] ?? firebaseUser?.displayName ?? 'Pupzy User';
    final arabicName = _user?['fullNameArabic'] ?? '';
    final email = _user?['email'] ?? firebaseUser?.email ?? '';
    final photoUrl = _user?['profilePictureUrl'] ?? firebaseUser?.photoURL;
    final rescues = _user?['rescuesCount']?.toString() ?? '0';
    final adopted = _user?['adoptedCount']?.toString() ?? '0';
    final helping = _user?['helpingCount']?.toString() ?? '0';

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 12),
          Container(width: 40, height: 4, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2))),
          const SizedBox(height: AppSpacing.lg),
          // Avatar + name
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 32,
                  backgroundImage: photoUrl != null ? NetworkImage(photoUrl) : null,
                  child: photoUrl == null
                      ? Text(
                          displayName.isNotEmpty ? displayName[0].toUpperCase() : '?',
                          style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                        )
                      : null,
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(displayName, style: Theme.of(context).textTheme.headlineSmall),
                      if (arabicName.isNotEmpty)
                        Text(arabicName, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.primary)),
                      const SizedBox(height: 2),
                      Text(email, style: Theme.of(context).textTheme.bodySmall),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          // Stats row
          if (!_loadingProfile)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              child: Row(
                children: [
                  _StatCard(value: rescues, label: 'RESCUES', arabic: 'إنقاذ'),
                  const SizedBox(width: AppSpacing.sm),
                  _StatCard(value: adopted, label: 'ADOPTED', arabic: 'تبني'),
                  const SizedBox(width: AppSpacing.sm),
                  _StatCard(value: helping, label: 'HELPING', arabic: 'مساعدة'),
                ],
              ),
            ),
          const SizedBox(height: AppSpacing.lg),
          // Language
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Row(
              children: [
                Container(width: 6, height: 6, decoration: const BoxDecoration(color: AppColors.primary, shape: BoxShape.circle)),
                const SizedBox(width: 6),
                Text('LANGUAGE  ·  لغة', style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.5)),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Container(
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(AppRadius.chip),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: GestureDetector(
                      onTap: () => setState(() => _english = true),
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        decoration: BoxDecoration(
                          color: _english ? AppColors.primary : Colors.transparent,
                          borderRadius: BorderRadius.circular(AppRadius.chip),
                        ),
                        child: Center(
                          child: Text('English', style: TextStyle(color: _english ? Colors.white : AppColors.textPrimary, fontWeight: FontWeight.w600)),
                        ),
                      ),
                    ),
                  ),
                  Expanded(
                    child: GestureDetector(
                      onTap: () => setState(() => _english = false),
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        decoration: BoxDecoration(
                          color: !_english ? AppColors.primary : Colors.transparent,
                          borderRadius: BorderRadius.circular(AppRadius.chip),
                        ),
                        child: Center(
                          child: Text('العربية', style: TextStyle(color: !_english ? Colors.white : AppColors.textPrimary, fontWeight: FontWeight.w600)),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          // Settings
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Row(
              children: [
                Container(width: 6, height: 6, decoration: const BoxDecoration(color: AppColors.primary, shape: BoxShape.circle)),
                const SizedBox(width: 6),
                Text('SETTINGS', style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.5)),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Container(
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(AppRadius.card),
                border: Border.all(color: AppColors.border),
              ),
              child: Column(
                children: [
                  _SettingsRow(icon: Icons.person_outline, label: 'Edit profile'),
                  const Divider(height: 1, indent: 48),
                  _SettingsRow(
                    icon: Icons.notifications_none,
                    label: 'Notifications',
                    trailing: _user?['notificationsEnabled'] == true ? 'On' : 'Off',
                  ),
                  const Divider(height: 1, indent: 48),
                  _SettingsRow(
                    icon: Icons.shield_outlined,
                    label: 'Privacy & location',
                    trailing: _user?['privacyLevel'] ?? 'Strict',
                  ),
                  const Divider(height: 1, indent: 48),
                  _SettingsRow(icon: Icons.mail_outline, label: 'Contact Requests', trailing: '3'),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          // Sign out button
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _signOut,
                icon: const Icon(Icons.logout, size: 18),
                label: const Text('Sign Out'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.critical,
                  side: BorderSide(color: AppColors.critical.withValues(alpha: 0.3)),
                ),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.xl),
        ],
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String value;
  final String label;
  final String arabic;
  const _StatCard({required this.value, required this.label, required this.arabic});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.card),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          children: [
            Text(value, style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: AppColors.primary)),
            Text(label, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700, fontSize: 10, letterSpacing: 0.5)),
            Text(arabic, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 10, color: AppColors.textMuted)),
          ],
        ),
      ),
    );
  }
}

class _SettingsRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String? trailing;
  const _SettingsRow({required this.icon, required this.label, this.trailing});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 14),
      child: Row(
        children: [
          Icon(icon, size: 20, color: AppColors.primary),
          const SizedBox(width: AppSpacing.md),
          Expanded(child: Text(label, style: Theme.of(context).textTheme.bodyLarge)),
          if (trailing != null)
            Padding(
              padding: const EdgeInsets.only(right: AppSpacing.sm),
              child: Text(trailing!, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted)),
            ),
          const Icon(Icons.chevron_right, size: 18, color: AppColors.textMuted),
        ],
      ),
    );
  }
}
