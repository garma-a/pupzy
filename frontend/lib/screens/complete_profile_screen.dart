import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';

import '../services/auth_service.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import 'app_shell.dart';

class CompleteProfileScreen extends StatefulWidget {
  const CompleteProfileScreen({super.key});

  @override
  State<CompleteProfileScreen> createState() => _CompleteProfileScreenState();
}

class _CompleteProfileScreenState extends State<CompleteProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _citySearchController = TextEditingController();

  List<Map<String, dynamic>> _cities = [];
  Map<String, dynamic>? _selectedCity;
  bool _loadingCities = true;
  bool _submitting = false;
  Position? _position;

  @override
  void initState() {
    super.initState();
    final user = context.read<AuthService>().currentUser;
    if (user?.displayName != null && user!.displayName!.isNotEmpty) {
      _nameController.text = user.displayName!;
    }
    _loadCities();
    _fetchLocation();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _citySearchController.dispose();
    super.dispose();
  }

  Future<void> _loadCities() async {
    final graphql = context.read<GraphQLService>();
    final cities = await graphql.fetchCities();
    if (mounted) {
      setState(() {
        _cities = cities;
        _loadingCities = false;
      });
    }
  }

  Future<void> _fetchLocation() async {
    try {
      bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) return;

      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied ||
            permission == LocationPermission.deniedForever) return;
      }

      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.medium,
          timeLimit: Duration(seconds: 10),
        ),
      );
      if (mounted) setState(() => _position = pos);
    } catch (_) {
      // Location is optional — silently ignore failures
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedCity == null) {
      Fluttertoast.showToast(
        msg: 'Please select your city',
        backgroundColor: AppColors.critical,
        textColor: Colors.white,
      );
      return;
    }

    setState(() => _submitting = true);

    final graphql = context.read<GraphQLService>();
    final rawDigits = _phoneController.text.trim().replaceAll(RegExp(r'\D'), '');
    final phone = rawDigits.startsWith('0')
        ? '+2$rawDigits'
        : '+20$rawDigits';

    final result = await graphql.completeProfile(
      fullName: _nameController.text.trim(),
      phoneNumber: phone,
      cityId: _selectedCity!['id'] as String,
      latitude: _position?.latitude,
      longitude: _position?.longitude,
    );

    if (!mounted) return;

    if (result != null) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const AppShell()),
      );
    } else {
      Fluttertoast.showToast(
        msg: 'Something went wrong. Please try again.',
        backgroundColor: AppColors.critical,
        textColor: Colors.white,
      );
      setState(() => _submitting = false);
    }
  }

  void _showCityPicker() {
    _citySearchController.clear();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return _CityPickerSheet(
          cities: _cities,
          searchController: _citySearchController,
          onSelected: (city) {
            setState(() => _selectedCity = city);
            Navigator.of(ctx).pop();
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.read<AuthService>();
    final user = auth.currentUser;
    final email = user?.email ?? '';

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: AppSpacing.xxl),

                Center(
                  child: Column(
                    children: [
                      CircleAvatar(
                        radius: 40,
                        backgroundImage: user?.photoURL != null
                            ? NetworkImage(user!.photoURL!)
                            : null,
                        child: user?.photoURL == null
                            ? const Icon(Icons.person, size: 40)
                            : null,
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      Text(
                        'Complete your profile',
                        style: Theme.of(context).textTheme.headlineLarge,
                      ),
                      const SizedBox(height: AppSpacing.xs),
                      Text(
                        'Just a few details to get started',
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.xxl),

                // Email (read-only, from Google OAuth)
                Text('Email', style: Theme.of(context).textTheme.labelLarge),
                const SizedBox(height: AppSpacing.sm),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceWarm,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.mail_outline, color: AppColors.textMuted, size: 20),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          email,
                          style: TextStyle(color: AppColors.textSecondary, fontSize: 14),
                        ),
                      ),
                      Icon(Icons.lock_outline, color: AppColors.textMuted, size: 16),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.xl),

                // Full name
                Text('Full Name', style: Theme.of(context).textTheme.labelLarge),
                const SizedBox(height: AppSpacing.sm),
                TextFormField(
                  controller: _nameController,
                  textInputAction: TextInputAction.next,
                  textCapitalization: TextCapitalization.words,
                  decoration: _inputDecoration('Enter your full name', Icons.person_outline),
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) return 'Name is required';
                    if (v.trim().length < 2) return 'At least 2 characters';
                    if (v.trim().length > 120) return 'Maximum 120 characters';
                    return null;
                  },
                ),
                const SizedBox(height: AppSpacing.xl),

                // Phone number
                Text('Phone Number', style: Theme.of(context).textTheme.labelLarge),
                const SizedBox(height: AppSpacing.sm),
                TextFormField(
                  controller: _phoneController,
                  keyboardType: TextInputType.phone,
                  textInputAction: TextInputAction.done,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(11),
                  ],
                  decoration: _inputDecoration('01012345678', Icons.phone_outlined).copyWith(
                    prefixIcon: Padding(
                      padding: const EdgeInsets.only(left: 16, right: 8),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text('\u{1F1EA}\u{1F1EC}', style: const TextStyle(fontSize: 20)),
                          const SizedBox(width: 6),
                          Text('+20', style: TextStyle(
                            color: AppColors.textPrimary,
                            fontWeight: FontWeight.w600,
                            fontSize: 15,
                          )),
                          Container(
                            width: 1,
                            height: 20,
                            margin: const EdgeInsets.only(left: 8),
                            color: AppColors.border,
                          ),
                        ],
                      ),
                    ),
                  ),
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) return 'Phone number is required';
                    final digits = v.trim().replaceAll(RegExp(r'\D'), '');
                    if (!RegExp(r'^0[1][0125]\d{8}$').hasMatch(digits)) {
                      return 'Enter a valid Egyptian mobile number';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: AppSpacing.xl),

                // City picker
                Text('City', style: Theme.of(context).textTheme.labelLarge),
                const SizedBox(height: AppSpacing.sm),
                GestureDetector(
                  onTap: _loadingCities ? null : _showCityPicker,
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: _selectedCity == null && _formKey.currentState?.validate() == false
                            ? AppColors.critical
                            : AppColors.border,
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.location_city_outlined, color: AppColors.textMuted, size: 20),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _loadingCities
                              ? SizedBox(
                                  height: 20,
                                  width: 20,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary),
                                )
                              : Text(
                                  _selectedCity != null
                                      ? '${_selectedCity!['nameEn']} - ${_selectedCity!['nameAr']}'
                                      : 'Search and select your city',
                                  style: TextStyle(
                                    color: _selectedCity != null
                                        ? AppColors.textPrimary
                                        : AppColors.textMuted,
                                    fontSize: 14,
                                  ),
                                ),
                        ),
                        Icon(Icons.search, color: AppColors.textMuted, size: 20),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.xxl),

                SizedBox(
                  width: double.infinity,
                  height: 54,
                  child: ElevatedButton(
                    onPressed: _submitting ? null : _submit,
                    child: _submitting
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.5,
                              color: Colors.white,
                            ),
                          )
                        : const Text('Get Started'),
                  ),
                ),
                const SizedBox(height: AppSpacing.xxl),
              ],
            ),
          ),
        ),
      ),
    );
  }

  InputDecoration _inputDecoration(String hint, IconData icon) {
    return InputDecoration(
      hintText: hint,
      hintStyle: TextStyle(color: AppColors.textMuted, fontSize: 14),
      prefixIcon: Icon(icon, color: AppColors.textMuted, size: 20),
      filled: true,
      fillColor: AppColors.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: AppColors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: AppColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: AppColors.primary, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: AppColors.critical),
      ),
    );
  }
}

class _CityPickerSheet extends StatefulWidget {
  final List<Map<String, dynamic>> cities;
  final TextEditingController searchController;
  final ValueChanged<Map<String, dynamic>> onSelected;

  const _CityPickerSheet({
    required this.cities,
    required this.searchController,
    required this.onSelected,
  });

  @override
  State<_CityPickerSheet> createState() => _CityPickerSheetState();
}

class _CityPickerSheetState extends State<_CityPickerSheet> {
  List<Map<String, dynamic>> _filtered = [];

  @override
  void initState() {
    super.initState();
    _filtered = widget.cities;
    widget.searchController.addListener(_onSearch);
  }

  void _onSearch() {
    final query = widget.searchController.text.toLowerCase().trim();
    setState(() {
      if (query.isEmpty) {
        _filtered = widget.cities;
      } else {
        _filtered = widget.cities.where((city) {
          final en = (city['nameEn'] as String).toLowerCase();
          final ar = city['nameAr'] as String;
          final gov = (city['governorate'] as String).toLowerCase();
          return en.contains(query) || ar.contains(query) || gov.contains(query);
        }).toList();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final bottomPad = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      height: MediaQuery.of(context).size.height * 0.7,
      decoration: const BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
      ),
      child: Column(
        children: [
          const SizedBox(height: 12),
          Container(width: 40, height: 4, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2))),
          const SizedBox(height: AppSpacing.lg),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Text('Select your city', style: Theme.of(context).textTheme.headlineSmall),
          ),
          const SizedBox(height: AppSpacing.md),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: TextField(
              controller: widget.searchController,
              autofocus: true,
              decoration: InputDecoration(
                hintText: 'Search by city, governorate...',
                hintStyle: TextStyle(color: AppColors.textMuted, fontSize: 14),
                prefixIcon: const Icon(Icons.search, color: AppColors.textMuted, size: 20),
                filled: true,
                fillColor: AppColors.surface,
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: AppColors.border),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: AppColors.border),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: AppColors.primary, width: 1.5),
                ),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Expanded(
            child: _filtered.isEmpty
                ? Center(
                    child: Text(
                      'No cities found',
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  )
                : ListView.builder(
                    padding: EdgeInsets.only(bottom: bottomPad + AppSpacing.lg),
                    itemCount: _filtered.length,
                    itemBuilder: (context, index) {
                      final city = _filtered[index];
                      return ListTile(
                        leading: Icon(Icons.location_on_outlined, color: AppColors.primary, size: 20),
                        title: Text(
                          '${city['nameEn']} - ${city['nameAr']}',
                          style: TextStyle(color: AppColors.textPrimary, fontSize: 14),
                        ),
                        subtitle: Text(
                          city['governorate'] as String,
                          style: TextStyle(color: AppColors.textMuted, fontSize: 12),
                        ),
                        dense: true,
                        onTap: () => widget.onSelected(city),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
