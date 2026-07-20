import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
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
      });
    }
  }

  void _showEditProfile() {
    final lang = context.read<LangProvider>().lang;
    final nameController = TextEditingController(text: _user?['fullName'] ?? '');
    final existingPhone = (_user?['phoneNumber'] as String?) ?? '';
    final phoneController = TextEditingController(
      text: existingPhone.replaceAll(RegExp(r'^\+20'), '0').replaceAll(RegExp(r'\D'), ''),
    );
    final cityField = lang == Lang.ar ? 'nameArabic' : 'nameEnglish';
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return _EditProfileSheet(
          nameController: nameController,
          phoneController: phoneController,
          initialCity: _user?['city']?[cityField] ?? t(ctx, 'Not set', 'غير محدد'),
          onUpdateLocation: _updateLocation,
          onSave: (name, phone) async {
            final graphql = context.read<GraphQLService>();
            String? e164Phone;
            if (phone.isNotEmpty) {
              final digits = phone.replaceAll(RegExp(r'\D'), '');
              e164Phone = digits.startsWith('0') ? '+2$digits' : '+20$digits';
            }
            final result = await graphql.updateProfile(fullName: name, phoneNumber: e164Phone);
            if (result != null) {
              Navigator.of(ctx).pop();
              _fetchProfile();
              Fluttertoast.showToast(
                msg: t(ctx, 'Profile updated', 'تم تحديث الملف الشخصي'),
                backgroundColor: AppColors.primary,
                textColor: Colors.white,
              );
            } else {
              Fluttertoast.showToast(
                msg: t(ctx, 'Failed to update profile', 'فشل تحديث الملف الشخصي'),
                backgroundColor: AppColors.critical,
                textColor: Colors.white,
              );
            }
          },
        );
      },
    );
  }

  Future<String?> _updateLocation() async {
    final lang = context.read<LangProvider>().lang;
    Fluttertoast.showToast(
      msg: t(context, 'Getting your location...', 'جارٍ تحديد موقعك...'),
      backgroundColor: AppColors.primary,
      textColor: Colors.white,
    );

    try {
      bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        Fluttertoast.showToast(
          msg: t(context, 'Please enable location services', 'يرجى تفعيل خدمات الموقع'),
          backgroundColor: AppColors.critical,
          textColor: Colors.white,
        );
        return null;
      }

      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied ||
            permission == LocationPermission.deniedForever) {
          Fluttertoast.showToast(
            msg: t(context, 'Location permission denied', 'تم رفض إذن الموقع'),
            backgroundColor: AppColors.critical,
            textColor: Colors.white,
          );
          return null;
        }
      }

      var pos = await Geolocator.getLastKnownPosition();
      pos ??= await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.low,
          timeLimit: Duration(seconds: 30),
        ),
      );

      final graphql = context.read<GraphQLService>();
      final result = await graphql.updateMyLocation(
        latitude: pos.latitude,
        longitude: pos.longitude,
      );

      if (result != null && mounted) {
        _fetchProfile();
        final cityField = lang == Lang.ar ? 'nameArabic' : 'nameEnglish';
        final cityName = result['city']?[cityField] ?? t(context, 'Unknown', 'غير معروف');
        Fluttertoast.showToast(
          msg: '${t(context, 'Location updated', 'تم تحديث الموقع')} — $cityName',
          backgroundColor: AppColors.primary,
          textColor: Colors.white,
        );
        return cityName;
      }
      return null;
    } catch (e) {
      debugPrint('Location error: $e');
      Fluttertoast.showToast(
        msg: '${t(context, 'Location error', 'خطأ في تحديد الموقع')}: $e',
        backgroundColor: AppColors.critical,
        textColor: Colors.white,
        toastLength: Toast.LENGTH_LONG,
      );
      return null;
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
    final lang = context.watch<LangProvider>().lang;
    final cityField = lang == Lang.ar ? 'nameArabic' : 'nameEnglish';
    final auth = context.read<AuthService>();
    final firebaseUser = auth.currentUser;
    final displayName = _user?['fullName'] ?? firebaseUser?.displayName ?? t(context, 'Pupzy User', 'مستخدم بابزي');
    final arabicName = _user?['fullNameArabic'] ?? '';
    final email = _user?['email'] ?? firebaseUser?.email ?? '';
    final photoUrl = _user?['profilePictureUrl'] ?? firebaseUser?.photoURL;
    final rescues = _user?['rescuePostCount']?.toString() ?? '0';
    final adopted = _user?['adoptionPostCount']?.toString() ?? '0';
    final lost = _user?['lostPostCount']?.toString() ?? '0';
    final cityName = _user?['city']?[cityField] as String?;

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
                      if (cityName != null) ...[
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            const Icon(Icons.location_on, size: 12, color: AppColors.primary),
                            const SizedBox(width: 2),
                            Text(cityName, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.primary, fontWeight: FontWeight.w600)),
                          ],
                        ),
                      ],
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
                  _StatCard(value: rescues, label: t(context, 'RESCUES', 'إنقاذ')),
                  const SizedBox(width: AppSpacing.sm),
                  _StatCard(value: adopted, label: t(context, 'ADOPTED', 'تبني')),
                  const SizedBox(width: AppSpacing.sm),
                  _StatCard(value: lost, label: t(context, 'LOST', 'مفقود')),
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
                Text(t(context, 'LANGUAGE', 'اللغة'), style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.5)),
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
                      onTap: () => context.read<LangProvider>().setLang(Lang.en),
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        decoration: BoxDecoration(
                          color: lang == Lang.en ? AppColors.primary : Colors.transparent,
                          borderRadius: BorderRadius.circular(AppRadius.chip),
                        ),
                        child: Center(
                          child: Text('English', style: TextStyle(color: lang == Lang.en ? Colors.white : AppColors.textPrimary, fontWeight: FontWeight.w600)),
                        ),
                      ),
                    ),
                  ),
                  Expanded(
                    child: GestureDetector(
                      onTap: () => context.read<LangProvider>().setLang(Lang.ar),
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        decoration: BoxDecoration(
                          color: lang == Lang.ar ? AppColors.primary : Colors.transparent,
                          borderRadius: BorderRadius.circular(AppRadius.chip),
                        ),
                        child: Center(
                          child: Text('العربية', style: TextStyle(color: lang == Lang.ar ? Colors.white : AppColors.textPrimary, fontWeight: FontWeight.w600)),
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
                Text(t(context, 'SETTINGS', 'الإعدادات'), style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.5)),
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
                  _SettingsRow(
                    icon: Icons.person_outline,
                    label: t(context, 'Edit profile', 'تعديل الملف الشخصي'),
                    onTap: () => _showEditProfile(),
                  ),
                  const Divider(height: 1, indent: 48),
                  _SettingsRow(
                    icon: Icons.notifications_none,
                    label: t(context, 'Notifications', 'الإشعارات'),
                    trailing: _user?['notificationsEnabled'] == true ? t(context, 'On', 'مفعّل') : t(context, 'Off', 'متوقف'),
                  ),
                  const Divider(height: 1, indent: 48),
                  _SettingsRow(icon: Icons.mail_outline, label: t(context, 'Contact Requests', 'طلبات التواصل'), trailing: '3'),
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
                label: Text(t(context, 'Sign Out', 'تسجيل الخروج')),
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
  const _StatCard({required this.value, required this.label});

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
  final VoidCallback? onTap;
  const _SettingsRow({required this.icon, required this.label, this.trailing, this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Padding(
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
      ),
    );
  }
}

class _EditProfileSheet extends StatefulWidget {
  final TextEditingController nameController;
  final TextEditingController phoneController;
  final String initialCity;
  final Future<String?> Function() onUpdateLocation;
  final Future<void> Function(String name, String phone) onSave;

  const _EditProfileSheet({
    required this.nameController,
    required this.phoneController,
    required this.initialCity,
    required this.onUpdateLocation,
    required this.onSave,
  });

  @override
  State<_EditProfileSheet> createState() => _EditProfileSheetState();
}

class _EditProfileSheetState extends State<_EditProfileSheet> {
  final _formKey = GlobalKey<FormState>();
  bool _saving = false;
  bool _locating = false;
  late final String _initialName;
  late final String _initialPhone;
  late String _cityName;

  @override
  void initState() {
    super.initState();
    _initialName = widget.nameController.text.trim();
    _initialPhone = widget.phoneController.text.trim();
    _cityName = widget.initialCity;
    widget.nameController.addListener(_onChanged);
    widget.phoneController.addListener(_onChanged);
  }

  @override
  void dispose() {
    widget.nameController.removeListener(_onChanged);
    widget.phoneController.removeListener(_onChanged);
    super.dispose();
  }

  void _onChanged() => setState(() {});

  bool get _isDirty =>
      widget.nameController.text.trim() != _initialName ||
      widget.phoneController.text.trim() != _initialPhone;

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    await widget.onSave(widget.nameController.text.trim(), widget.phoneController.text.trim());
    if (mounted) setState(() => _saving = false);
  }

  Future<void> _handleUpdateLocation() async {
    if (_locating) return;
    setState(() => _locating = true);
    final cityName = await widget.onUpdateLocation();
    if (mounted) {
      setState(() {
        _locating = false;
        if (cityName != null) _cityName = cityName;
      });
    }
  }

  Future<void> _handleClose() async {
    if (!_isDirty) {
      Navigator.of(context).pop();
      return;
    }
    final discard = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.background,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.card)),
        title: Text(t(ctx, 'Discard changes?', 'تجاهل التغييرات؟')),
        content: Text(t(ctx, 'Your edits haven\'t been saved yet.', 'لم يتم حفظ تعديلاتك بعد.')),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(t(ctx, 'Keep editing', 'متابعة التعديل')),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: TextButton.styleFrom(foregroundColor: AppColors.critical),
            child: Text(t(ctx, 'Discard', 'تجاهل')),
          ),
        ],
      ),
    );
    if (discard == true && mounted) Navigator.of(context).pop();
  }

  InputDecoration _fieldDecoration({
    required String hint,
    required IconData icon,
  }) {
    return InputDecoration(
      hintText: hint,
      hintStyle: const TextStyle(color: AppColors.textMuted, fontSize: 14),
      prefixIcon: Icon(icon, color: AppColors.textMuted, size: 20),
      filled: true,
      fillColor: AppColors.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      counterStyle: const TextStyle(color: AppColors.textMuted, fontSize: 11),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: AppColors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: AppColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: AppColors.critical),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: AppColors.critical, width: 1.5),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bottomPad = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
      ),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: EdgeInsets.only(bottom: bottomPad),
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.xl),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 40,
                      height: 4,
                      decoration: BoxDecoration(
                        color: AppColors.border,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Row(
                    children: [
                      Expanded(
                        child: Text(t(context, 'Edit Profile', 'تعديل الملف الشخصي'), style: Theme.of(context).textTheme.headlineSmall),
                      ),
                      GestureDetector(
                        onTap: _handleClose,
                        child: Container(
                          width: 32,
                          height: 32,
                          decoration: BoxDecoration(
                            color: AppColors.surface,
                            shape: BoxShape.circle,
                            border: Border.all(color: AppColors.border),
                          ),
                          child: const Icon(Icons.close, size: 16, color: AppColors.textSecondary),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    t(
                      context,
                      'Keep your details current so fellow rescuers can recognize and reach you.',
                      'حافظ على تحديث بياناتك حتى يتمكن باقي المنقذين من التعرف عليك والتواصل معك.',
                    ),
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  Text(t(context, 'Full Name', 'الاسم الكامل'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextFormField(
                    controller: widget.nameController,
                    autofocus: true,
                    textCapitalization: TextCapitalization.words,
                    textInputAction: TextInputAction.next,
                    maxLength: 120,
                    decoration: _fieldDecoration(hint: t(context, 'Enter your full name', 'أدخل اسمك الكامل'), icon: Icons.person_outline),
                    validator: (v) {
                      if (v == null || v.trim().isEmpty) return t(context, 'Name is required', 'الاسم مطلوب');
                      if (v.trim().length < 2) return t(context, 'At least 2 characters', 'حرفان على الأقل');
                      if (RegExp(r'\d').hasMatch(v)) return t(context, 'Name cannot contain numbers', 'لا يمكن أن يحتوي الاسم على أرقام');
                      if (!v.trim().contains(' ')) return t(context, 'Enter first and last name', 'أدخل الاسم الأول والأخير');
                      return null;
                    },
                  ),
                  const SizedBox(height: 4),
                  Text(
                    t(
                      context,
                      'This is how other members will see you on posts and messages.',
                      'هكذا سيراك الأعضاء الآخرون في المنشورات والرسائل.',
                    ),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  Text(t(context, 'Phone Number  ·  optional', 'رقم الهاتف  ·  اختياري'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextFormField(
                    controller: widget.phoneController,
                    keyboardType: TextInputType.phone,
                    textInputAction: TextInputAction.done,
                    onFieldSubmitted: (_) => _saving ? null : _save(),
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(11),
                    ],
                    decoration: _fieldDecoration(hint: 'e.g. 01012345678', icon: Icons.phone_outlined),
                    validator: (v) {
                      if (v == null || v.trim().isEmpty) return null;
                      final digits = v.trim().replaceAll(RegExp(r'\D'), '');
                      if (digits.length != 11) return t(context, 'Phone number must be 11 digits', 'يجب أن يتكون رقم الهاتف من 11 رقمًا');
                      if (!RegExp(r'^01[0125]\d{8}$').hasMatch(digits)) {
                        return t(context, 'Must start with 010, 011, 012, or 015', 'يجب أن يبدأ بـ 010 أو 011 أو 012 أو 015');
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 4),
                  Text(
                    t(
                      context,
                      'Only shared with adopters once you accept their request — never shown publicly.',
                      'يُشارك فقط مع من يتبنى بعد قبولك لطلبه — لا يُعرض للعامة أبدًا.',
                    ),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  Text(t(context, 'Location', 'الموقع'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.location_on_outlined, color: AppColors.textMuted, size: 20),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(t(context, 'Current city', 'المدينة الحالية'), style: Theme.of(context).textTheme.bodySmall),
                              const SizedBox(height: 2),
                              Text(
                                _cityName,
                                style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600),
                              ),
                            ],
                          ),
                        ),
                        _locating
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary),
                              )
                            : GestureDetector(
                                onTap: _handleUpdateLocation,
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                  decoration: BoxDecoration(
                                    color: AppColors.primary.withValues(alpha: 0.08),
                                    borderRadius: BorderRadius.circular(AppRadius.chip),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Icon(Icons.my_location, size: 13, color: AppColors.primary),
                                      const SizedBox(width: 4),
                                      Text(
                                        t(context, 'Update', 'تحديث'),
                                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                              color: AppColors.primary,
                                              fontWeight: FontWeight.w700,
                                            ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    t(context, 'Used to show nearby rescues and pets in your area.', 'يُستخدم لعرض عمليات الإنقاذ والحيوانات القريبة منك.'),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  Row(
                    children: [
                      Expanded(
                        child: SizedBox(
                          height: 54,
                          child: OutlinedButton(
                            onPressed: _saving ? null : _handleClose,
                            child: Text(t(context, 'Cancel', 'إلغاء')),
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        flex: 2,
                        child: SizedBox(
                          height: 54,
                          child: ElevatedButton(
                            onPressed: (_saving || !_isDirty) ? null : _save,
                            child: _saving
                                ? const SizedBox(
                                    width: 22,
                                    height: 22,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2.5,
                                      color: Colors.white,
                                    ),
                                  )
                                : Text(t(context, 'Save Changes', 'حفظ التغييرات')),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.lg),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
