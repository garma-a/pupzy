import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/mock_data.dart';
import '../localization/lang_provider.dart';
import '../models/product.dart';
import '../theme/app_theme.dart';
import '../utils/time_format.dart';
import '../widgets/pet_carousel.dart';

const Map<String, String> _categoryAr = {
  'Care': 'رعاية',
  'Food': 'طعام',
  'Transport': 'نقل',
  'Accessories': 'إكسسوارات',
  'Grooming': 'تجميل',
  'Medical Supplies': 'مستلزمات طبية',
  'Other': 'أخرى',
};

const Map<String, String> _conditionAr = {
  'New': 'جديد',
  'Like New': 'شبه جديد',
  'Used': 'مستعمل',
};

String _categoryLabel(BuildContext context, String category) => t(context, category, _categoryAr[category] ?? category);
String _conditionLabel(BuildContext context, String condition) => t(context, condition, _conditionAr[condition] ?? condition);

class ProductDetailScreen extends StatefulWidget {
  final Product product;

  const ProductDetailScreen({super.key, required this.product});

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  late Product _product;

  @override
  void initState() {
    super.initState();
    _product = widget.product;
  }

  bool get _isOwner => _product.sellerId == MockData.mockCurrentUserId;
  bool get _isSaved => MockData.savedProductIds.contains(_product.id);
  bool get _isSold => _product.status == ListingStatus.sold;

  void _syncToMockList() {
    final idx = MockData.products.indexWhere((p) => p.id == _product.id);
    if (idx != -1) MockData.products[idx] = _product;
  }

  Future<void> _launchPhone(String phone) async {
    final uri = Uri(scheme: 'tel', path: phone);
    if (!await launchUrl(uri)) {
      Fluttertoast.showToast(msg: t(context, 'Could not open phone dialer', 'تعذر فتح تطبيق الهاتف'));
    }
  }

  Future<void> _launchWhatsApp(String phone, String message) async {
    final digits = phone.replaceAll(RegExp(r'[^0-9]'), '');
    final uri = Uri.parse('https://wa.me/$digits?text=${Uri.encodeComponent(message)}');
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      Fluttertoast.showToast(msg: t(context, 'Could not open WhatsApp', 'تعذر فتح واتساب'));
    }
  }

  void _noContactNumberToast() {
    Fluttertoast.showToast(
      msg: t(context, "This seller hasn't added a contact number yet", 'لم يضف هذا البائع رقم تواصل بعد'),
      backgroundColor: AppColors.critical,
      textColor: Colors.white,
    );
  }

  void _handleCall() {
    final phone = _product.sellerPhone;
    if (phone == null) {
      _noContactNumberToast();
      return;
    }
    _launchPhone(phone);
  }

  void _handleMessage() {
    final product = _product;
    final phone = product.sellerPhone;
    if (phone == null) {
      _noContactNumberToast();
      return;
    }
    final defaultMessage =
        "${t(context, "Hi, I'm interested in your listing", 'مرحبًا، أنا مهتم بإعلانك')} \"${product.title}\" ${t(context, 'on Pupzy.', 'على بابزي.')}";
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _MessageSellerSheet(
        sellerName: product.sellerName,
        sellerAvatarUrl: product.sellerAvatarUrl,
        initialMessage: defaultMessage,
        onSend: (message) => _launchWhatsApp(phone, message),
      ),
    );
  }

  void _toggleSave() {
    setState(() {
      if (_isSaved) {
        MockData.savedProductIds.remove(_product.id);
      } else {
        MockData.savedProductIds.add(_product.id);
      }
    });
    Fluttertoast.showToast(msg: _isSaved ? t(context, 'Saved to favorites', 'تم الحفظ في المفضلة') : t(context, 'Removed from favorites', 'تمت الإزالة من المفضلة'));
  }

  void _shareListing() {
    final priceLabel = _product.isFree ? t(context, 'Free', 'مجاني') : '${_product.price?.toStringAsFixed(0)} ${_product.currency}';
    SharePlus.instance.share(
      ShareParams(text: '${t(context, 'Check out this listing on Pupzy', 'شاهد هذا الإعلان على بابزي')}: ${_product.title} — $priceLabel\n${_product.description}'),
    );
  }

  void _markSold() {
    setState(() => _product = _product.copyWith(status: ListingStatus.sold));
    _syncToMockList();
    Fluttertoast.showToast(msg: t(context, 'Listing marked as sold', 'تم تحديد الإعلان كمباع'));
  }

  void _renew() {
    setState(() => _product = _product.copyWith(status: ListingStatus.available));
    _syncToMockList();
    Fluttertoast.showToast(msg: t(context, 'Listing renewed', 'تم تجديد الإعلان'));
  }

  void _deleteListing() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(t(ctx, 'Delete listing?', 'حذف الإعلان؟')),
        content: Text(t(ctx, 'This cannot be undone.', 'لا يمكن التراجع عن هذا الإجراء.')),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: Text(t(ctx, 'Cancel', 'إلغاء'))),
          TextButton(
            onPressed: () {
              MockData.products.removeWhere((p) => p.id == _product.id);
              Navigator.of(ctx).pop();
              Navigator.of(context).pop();
              Fluttertoast.showToast(msg: t(ctx, 'Listing deleted', 'تم حذف الإعلان'));
            },
            child: Text(t(ctx, 'Delete', 'حذف'), style: const TextStyle(color: AppColors.critical)),
          ),
        ],
      ),
    );
  }

  void _editListing() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _EditListingSheet(
        product: _product,
        onSave: (updated) {
          setState(() => _product = updated);
          _syncToMockList();
          Navigator.of(context).pop();
          Fluttertoast.showToast(msg: t(context, 'Listing updated', 'تم تحديث الإعلان'));
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final product = _product;
    final lang = context.watch<LangProvider>().lang;
    return Scaffold(
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: EdgeInsets.zero,
              children: [
                Stack(
                  children: [
                    PetCarousel(imageUrls: product.imageUrls, height: 300),
                    if (_isSold)
                      Positioned.fill(
                        child: Container(
                          color: Colors.black.withValues(alpha: 0.35),
                          child: Center(
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                              decoration: BoxDecoration(
                                color: AppColors.critical,
                                borderRadius: BorderRadius.circular(AppRadius.chip),
                              ),
                              child: Text(
                                t(context, 'SOLD', 'مباع'),
                                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, letterSpacing: 1.2),
                              ),
                            ),
                          ),
                        ),
                      ),
                    SafeArea(
                      child: Padding(
                        padding: const EdgeInsets.all(AppSpacing.sm),
                        child: CircleAvatar(
                          backgroundColor: Colors.black45,
                          child: IconButton(
                            icon: const Icon(Icons.arrow_back, color: Colors.white),
                            onPressed: () => Navigator.of(context).pop(),
                            tooltip: t(context, 'Back', 'رجوع'),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                Padding(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_categoryLabel(context, product.category).toUpperCase(),
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.primary, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 4),
                      Text(product.title, style: Theme.of(context).textTheme.headlineLarge),
                      const SizedBox(height: AppSpacing.sm),
                      Wrap(
                        spacing: AppSpacing.sm,
                        runSpacing: AppSpacing.sm,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(
                            product.isFree ? t(context, 'Free', 'مجاني') : '${product.price?.toStringAsFixed(0) ?? '-'} ${product.currency}',
                            style: Theme.of(context).textTheme.headlineMedium?.copyWith(color: AppColors.primary),
                          ),
                          _Badge(label: _conditionLabel(context, product.condition), color: AppColors.textSecondary),
                          if (product.openToOffers) _Badge(label: t(context, 'Negotiable', 'قابل للتفاوض'), color: AppColors.sectionLineGreen),
                          if (product.status == ListingStatus.reserved) _Badge(label: t(context, 'Reserved', 'محجوز'), color: Colors.amber.shade800),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          const Icon(Icons.location_on_outlined, size: 14, color: AppColors.textMuted),
                          const SizedBox(width: 2),
                          Text(product.location, style: Theme.of(context).textTheme.bodySmall),
                          const SizedBox(width: AppSpacing.sm),
                          Text(
                            '· ${t(context, 'Posted', 'نُشر')} ${timeAgo(product.createdAt, lang)} ${t(context, 'ago', 'مضت')}',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      Text(t(context, 'Description', 'الوصف'), style: Theme.of(context).textTheme.headlineSmall),
                      const SizedBox(height: AppSpacing.xs),
                      Text(product.description, style: Theme.of(context).textTheme.bodyMedium),
                      const SizedBox(height: AppSpacing.lg),
                      const _SafetyNotice(),
                      const SizedBox(height: AppSpacing.lg),
                      _SellerCard(product: product),
                      const SizedBox(height: 96),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: _isOwner ? _buildOwnerActions() : _buildBuyerActions(),
        ),
      ),
    );
  }

  Widget _buildBuyerActions() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          children: [
            _IconAction(
              icon: Icons.call_outlined,
              label: t(context, 'Call', 'اتصال'),
              onTap: _isSold ? null : _handleCall,
            ),
            _IconAction(
              icon: Icons.chat,
              label: t(context, 'WhatsApp', 'واتساب'),
              color: AppColors.sectionLineGreen,
              onTap: _isSold ? null : _handleMessage,
            ),
            _IconAction(
              icon: _isSaved ? Icons.bookmark : Icons.bookmark_border,
              label: t(context, 'Save', 'حفظ'),
              color: _isSaved ? AppColors.primary : null,
              onTap: _toggleSave,
            ),
            _IconAction(icon: Icons.share_outlined, label: t(context, 'Share', 'مشاركة'), onTap: _shareListing),
          ],
        ),
        const SizedBox(height: AppSpacing.sm),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: _isSold ? null : _handleMessage,
            icon: _isSold ? null : const Icon(Icons.chat, size: 18),
            label: Text(_isSold ? t(context, 'Sold', 'مباع') : t(context, 'Message on WhatsApp', 'راسل عبر واتساب')),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.sectionLineGreen,
              disabledBackgroundColor: AppColors.sectionLineGreen.withValues(alpha: 0.35),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildOwnerActions() {
    return Row(
      children: [
        Expanded(
          child: OutlinedButton(onPressed: _editListing, child: Text(t(context, 'Edit', 'تعديل'))),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: OutlinedButton(
            onPressed: _deleteListing,
            style: OutlinedButton.styleFrom(foregroundColor: AppColors.critical, side: const BorderSide(color: AppColors.critical)),
            child: Text(t(context, 'Delete', 'حذف')),
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: ElevatedButton(
            onPressed: _isSold ? _renew : _markSold,
            child: Text(_isSold ? t(context, 'Renew', 'تجديد') : t(context, 'Mark Sold', 'تحديد كمباع')),
          ),
        ),
      ],
    );
  }
}

class _Badge extends StatelessWidget {
  final String label;
  final Color color;

  const _Badge({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppRadius.chip),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 12)),
    );
  }
}

class _IconAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final Color? color;

  const _IconAction({required this.icon, required this.label, required this.onTap, this.color});

  @override
  Widget build(BuildContext context) {
    final disabled = onTap == null;
    final c = disabled ? AppColors.textMuted : (color ?? AppColors.textSecondary);
    return Expanded(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.chip),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            children: [
              Icon(icon, size: 22, color: c),
              const SizedBox(height: 2),
              Text(label, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: c)),
            ],
          ),
        ),
      ),
    );
  }
}

class _SafetyNotice extends StatelessWidget {
  const _SafetyNotice();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceWarm,
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.shield_outlined, size: 18, color: AppColors.primary),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              t(
                context,
                'Meet in a safe public place. Inspect the item before paying. Never send money in advance.',
                'قابل البائع في مكان عام آمن. افحص الغرض قبل الدفع. لا ترسل المال مقدمًا أبدًا.',
              ),
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        ],
      ),
    );
  }
}

class _SellerCard extends StatelessWidget {
  final Product product;

  const _SellerCard({required this.product});

  static const _monthsEn = [
    '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  static const _monthsAr = [
    '', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
  ];

  @override
  Widget build(BuildContext context) {
    final joined = product.sellerJoinDate;
    final lang = context.watch<LangProvider>().lang;
    final monthName = lang == Lang.ar ? _monthsAr[joined.month] : _monthsEn[joined.month];
    final joinLabel = '$monthName ${joined.year}';
    final listingsLabel = product.sellerActiveListingsCount == 1
        ? t(context, '1 active listing', 'إعلان نشط واحد')
        : '${product.sellerActiveListingsCount} ${t(context, 'active listings', 'إعلانات نشطة')}';
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 24,
            backgroundImage: product.sellerAvatarUrl != null ? NetworkImage(product.sellerAvatarUrl!) : null,
            child: product.sellerAvatarUrl == null
                ? Text(product.sellerName.isNotEmpty ? product.sellerName[0].toUpperCase() : '?')
                : null,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(product.sellerName, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700)),
                Text('${t(context, 'Member since', 'عضو منذ')} $joinLabel', style: Theme.of(context).textTheme.bodySmall),
                Text(listingsLabel, style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _EditListingSheet extends StatefulWidget {
  final Product product;
  final ValueChanged<Product> onSave;

  const _EditListingSheet({required this.product, required this.onSave});

  @override
  State<_EditListingSheet> createState() => _EditListingSheetState();
}

class _EditListingSheetState extends State<_EditListingSheet> {
  late final TextEditingController _titleController;
  late final TextEditingController _descController;
  late final TextEditingController _priceController;
  late bool _isFree;
  late bool _openToOffers;
  late String _condition;

  static const _conditions = ['New', 'Like New', 'Used'];

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.product.title);
    _descController = TextEditingController(text: widget.product.description);
    _priceController = TextEditingController(text: widget.product.price?.toStringAsFixed(0) ?? '');
    _isFree = widget.product.isFree;
    _openToOffers = widget.product.openToOffers;
    _condition = widget.product.condition;
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descController.dispose();
    _priceController.dispose();
    super.dispose();
  }

  void _save() {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;
    final p = widget.product;
    widget.onSave(Product(
      id: p.id,
      title: title,
      imageUrls: p.imageUrls,
      price: _isFree ? null : double.tryParse(_priceController.text.trim()),
      currency: p.currency,
      isFree: _isFree,
      openToOffers: _openToOffers,
      description: _descController.text.trim(),
      category: p.category,
      condition: _condition,
      location: p.location,
      status: p.status,
      createdAt: p.createdAt,
      viewCount: p.viewCount,
      saveCount: p.saveCount,
      sellerId: p.sellerId,
      sellerName: p.sellerName,
      sellerAvatarUrl: p.sellerAvatarUrl,
      sellerJoinDate: p.sellerJoinDate,
      sellerActiveListingsCount: p.sellerActiveListingsCount,
      sellerPhone: p.sellerPhone,
    ));
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
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(t(context, 'Edit listing', 'تعديل الإعلان'), style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: AppSpacing.md),
              TextField(controller: _titleController, decoration: InputDecoration(labelText: t(context, 'Title', 'العنوان'))),
              const SizedBox(height: AppSpacing.sm),
              TextField(controller: _descController, maxLines: 3, decoration: InputDecoration(labelText: t(context, 'Description', 'الوصف'))),
              const SizedBox(height: AppSpacing.sm),
              Wrap(
                spacing: AppSpacing.sm,
                children: _conditions.map((c) {
                  return ChoiceChip(
                    label: Text(_conditionLabel(context, c)),
                    selected: _condition == c,
                    onSelected: (_) => setState(() => _condition = c),
                  );
                }).toList(),
              ),
              const SizedBox(height: AppSpacing.sm),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(t(context, 'List as free / giveaway', 'إعلان مجاني / تبرع')),
                value: _isFree,
                onChanged: (v) => setState(() => _isFree = v),
              ),
              if (!_isFree)
                TextField(
                  controller: _priceController,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(labelText: t(context, 'Price (EGP)', 'السعر (جنيه مصري)')),
                ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(t(context, 'Open to offers', 'قابل للتفاوض')),
                value: _openToOffers,
                onChanged: (v) => setState(() => _openToOffers = v),
              ),
              const SizedBox(height: AppSpacing.md),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(onPressed: _save, child: Text(t(context, 'Save changes', 'حفظ التغييرات'))),
              ),
              const SizedBox(height: AppSpacing.sm),
            ],
          ),
        ),
      ),
    );
  }
}

class _MessageSellerSheet extends StatefulWidget {
  final String sellerName;
  final String? sellerAvatarUrl;
  final String initialMessage;
  final void Function(String message) onSend;

  const _MessageSellerSheet({
    required this.sellerName,
    required this.sellerAvatarUrl,
    required this.initialMessage,
    required this.onSend,
  });

  @override
  State<_MessageSellerSheet> createState() => _MessageSellerSheetState();
}

class _MessageSellerSheetState extends State<_MessageSellerSheet> {
  static const Color _whatsappGreen = Color(0xFF25D366);

  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialMessage);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
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
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2)),
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
              Row(
                children: [
                  CircleAvatar(
                    radius: 20,
                    backgroundColor: _whatsappGreen.withValues(alpha: 0.12),
                    backgroundImage: widget.sellerAvatarUrl != null ? NetworkImage(widget.sellerAvatarUrl!) : null,
                    child: widget.sellerAvatarUrl == null
                        ? Text(widget.sellerName.isNotEmpty ? widget.sellerName[0].toUpperCase() : '?')
                        : null,
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(t(context, 'Message seller', 'مراسلة البائع'), style: Theme.of(context).textTheme.headlineSmall),
                        Text(widget.sellerName, style: Theme.of(context).textTheme.bodySmall),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.lg),
              Text(t(context, 'Your message', 'رسالتك'), style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: AppSpacing.sm),
              TextField(
                controller: _controller,
                maxLines: 4,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  filled: true,
                  fillColor: AppColors.surfaceWarm,
                  contentPadding: const EdgeInsets.all(16),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppRadius.card),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              Row(
                children: [
                  const Icon(Icons.chat, size: 16, color: _whatsappGreen),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      t(
                        context,
                        "You'll be redirected to WhatsApp to send this",
                        'سيتم تحويلك إلى واتساب لإرسال هذه الرسالة',
                      ),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.lg),
              SizedBox(
                width: double.infinity,
                height: 54,
                child: ElevatedButton.icon(
                  onPressed: _controller.text.trim().isEmpty
                      ? null
                      : () {
                          Navigator.of(context).pop();
                          widget.onSend(_controller.text.trim());
                        },
                  icon: const Icon(Icons.chat, size: 20),
                  label: Text(t(context, 'Continue to WhatsApp', 'المتابعة إلى واتساب')),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _whatsappGreen,
                    disabledBackgroundColor: _whatsappGreen.withValues(alpha: 0.35),
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
            ],
          ),
        ),
      ),
    );
  }
}
