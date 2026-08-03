import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../localization/lang_provider.dart';
import '../models/post_detail.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import '../utils/time_format.dart';
import '../widgets/pet_carousel.dart';

const Map<String, (String, String)> _categoryLabels = {
  'CARE': ('Care', 'رعاية'),
  'FOOD': ('Food', 'طعام'),
  'TRANSPORT': ('Transport', 'نقل'),
  'ACCESSORIES': ('Accessories', 'إكسسوارات'),
  'GROOMING': ('Grooming', 'تجميل'),
  'MEDICAL_SUPPLIES': ('Medical Supplies', 'مستلزمات طبية'),
  'OTHER': ('Other', 'أخرى'),
};

const Map<String, (String, String)> _conditionLabels = {
  'NEW': ('New', 'جديد'),
  'LIKE_NEW': ('Like New', 'شبه جديد'),
  'USED': ('Used', 'مستعمل'),
};

String _categoryLabel(BuildContext context, String? category) {
  final l = _categoryLabels[category];
  return l != null ? t(context, l.$1, l.$2) : (category ?? '');
}

String _conditionLabel(BuildContext context, String condition) {
  final l = _conditionLabels[condition];
  return l != null ? t(context, l.$1, l.$2) : condition;
}

class ProductDetailScreen extends StatefulWidget {
  final String postId;

  const ProductDetailScreen({super.key, required this.postId});

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  bool _loading = true;
  String? _errorMessage;
  PostDetail? _post;
  ProductPostExtension? _ext;
  String? _myUserId;
  bool _busy = false;

  bool get _isOwner => _myUserId != null && _post != null && _post!.creator.id == _myUserId;
  bool get _isSold => _post?.status == 'SOLD';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    final graphql = context.read<GraphQLService>();
    final me = await graphql.fetchMe();
    final (post, postError) = await graphql.fetchPostDetail(widget.postId);
    if (!mounted) return;
    if (postError != null || post == null) {
      setState(() {
        _loading = false;
        _errorMessage = postError ?? t(context, 'This listing is no longer available.', 'هذا الإعلان لم يعد متاحًا.');
      });
      return;
    }
    graphql.recordView(post.id);
    final (ext, extError) = await graphql.fetchProductPostDetail(widget.postId);
    if (!mounted) return;
    setState(() {
      _loading = false;
      _post = post;
      _ext = ext;
      _myUserId = me?['id'] as String?;
      _errorMessage = ext == null ? extError : null;
    });
  }

  Future<void> _toggleSave() async {
    if (_post == null) return;
    final graphql = context.read<GraphQLService>();
    final (count, saved, error) = await graphql.toggleSave(_post!.id);
    if (!mounted) return;
    if (error != null || count == null || saved == null) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not update. Try again.', 'تعذر التحديث. حاول مرة أخرى.'));
      return;
    }
    setState(() => _post = _post!.copyWith(saveCount: count, isSavedByMe: saved));
    Fluttertoast.showToast(msg: saved ? t(context, 'Saved to favorites', 'تم الحفظ في المفضلة') : t(context, 'Removed from favorites', 'تمت الإزالة من المفضلة'));
  }

  void _shareListing() {
    final post = _post!;
    final ext = _ext!;
    final priceLabel = ext.isFree ? t(context, 'Free', 'مجاني') : '${ext.priceAmount?.toStringAsFixed(0) ?? '-'} ${ext.priceCurrency}';
    SharePlus.instance.share(
      ShareParams(text: '${t(context, 'Check out this listing on Pupzy', 'شاهد هذا الإعلان على بابزي')}: ${post.title} — $priceLabel\n${post.description}'),
    );
  }

  String? _sellerContactLink;

  Future<String?> _fetchSellerContactLink() async {
    if (_sellerContactLink != null) return _sellerContactLink;
    if (_post == null) return null;
    final graphql = context.read<GraphQLService>();
    final (link, error) = await graphql.getProductSellerContact(_post!.id);
    if (!mounted) return null;
    if (link == null) {
      Fluttertoast.showToast(msg: error ?? t(context, "This seller hasn't added a contact number yet", 'لم يضف هذا البائع رقم تواصل بعد'));
      return null;
    }
    _sellerContactLink = link;
    return link;
  }

  Future<void> _handleCall() async {
    final link = await _fetchSellerContactLink();
    if (link == null || !mounted) return;
    final digits = RegExp(r'\d+').firstMatch(link)?.group(0);
    if (digits == null) return;
    final opened = await launchUrl(Uri(scheme: 'tel', path: '+$digits'));
    if (!opened && mounted) {
      Fluttertoast.showToast(msg: t(context, 'Could not open phone dialer', 'تعذر فتح تطبيق الهاتف'));
    }
  }

  Future<void> _handleMessage() async {
    final link = await _fetchSellerContactLink();
    if (link == null || !mounted) return;
    final opened = await launchUrl(Uri.parse(link), mode: LaunchMode.externalApplication);
    if (!opened && mounted) {
      Fluttertoast.showToast(msg: t(context, 'Could not open WhatsApp', 'تعذر فتح واتساب'));
    }
  }

  Future<void> _markSold() async {
    if (_post == null || _busy) return;
    setState(() => _busy = true);
    final graphql = context.read<GraphQLService>();
    final (success, error) = await graphql.updatePostStatus(postId: _post!.id, status: 'SOLD');
    if (!mounted) return;
    setState(() => _busy = false);
    if (!success) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not update listing. Try again.', 'تعذر تحديث الإعلان. حاول مرة أخرى.'));
      return;
    }
    setState(() => _post = _post!.copyWith(status: 'SOLD'));
    Fluttertoast.showToast(msg: t(context, 'Listing marked as sold', 'تم تحديد الإعلان كمباع'));
  }

  Future<void> _deleteListing() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(t(ctx, 'Delete listing?', 'حذف الإعلان؟')),
        content: Text(t(ctx, 'This cannot be undone.', 'لا يمكن التراجع عن هذا الإجراء.')),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(t(ctx, 'Cancel', 'إلغاء'))),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(t(ctx, 'Delete', 'حذف'), style: const TextStyle(color: AppColors.critical)),
          ),
        ],
      ),
    );
    if (confirmed != true || _post == null || !mounted) return;
    setState(() => _busy = true);
    final graphql = context.read<GraphQLService>();
    final (success, error) = await graphql.deletePost(_post!.id);
    if (!mounted) return;
    setState(() => _busy = false);
    if (!success) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not delete listing. Try again.', 'تعذر حذف الإعلان. حاول مرة أخرى.'));
      return;
    }
    Navigator.of(context).pop();
    Fluttertoast.showToast(msg: t(context, 'Listing deleted', 'تم حذف الإعلان'));
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator(color: AppColors.primary)));
    }
    if (_errorMessage != null || _post == null || _ext == null) {
      return Scaffold(
        appBar: AppBar(backgroundColor: Colors.transparent, elevation: 0),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.cloud_off_outlined, size: 40, color: AppColors.textMuted),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  _errorMessage ?? t(context, 'Something went wrong.', 'حدث خطأ ما.'),
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: AppSpacing.md),
                OutlinedButton(onPressed: _load, child: Text(t(context, 'Retry', 'إعادة المحاولة'))),
              ],
            ),
          ),
        ),
      );
    }

    final post = _post!;
    final ext = _ext!;
    final lang = context.watch<LangProvider>().lang;
    final images = post.mediaUrls.isNotEmpty ? post.mediaUrls : [''];
    final cityName = Localizations.localeOf(context).languageCode == 'ar' ? post.cityNameArabic : post.cityNameEnglish;
    final location = post.areaName != null ? '$cityName · ${post.areaName}' : cityName;

    return Scaffold(
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: EdgeInsets.zero,
              children: [
                Stack(
                  children: [
                    PetCarousel(imageUrls: images, height: 300),
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
                      Text(_categoryLabel(context, post.marketCategory).toUpperCase(),
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.primary, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 4),
                      Text(post.title, style: Theme.of(context).textTheme.headlineLarge),
                      const SizedBox(height: AppSpacing.sm),
                      Wrap(
                        spacing: AppSpacing.sm,
                        runSpacing: AppSpacing.sm,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(
                            ext.isFree ? t(context, 'Free', 'مجاني') : '${ext.priceAmount?.toStringAsFixed(0) ?? '-'} ${ext.priceCurrency}',
                            style: Theme.of(context).textTheme.headlineMedium?.copyWith(color: AppColors.primary),
                          ),
                          _Badge(label: _conditionLabel(context, ext.condition), color: AppColors.textSecondary),
                          if (ext.openToOffers) _Badge(label: t(context, 'Negotiable', 'قابل للتفاوض'), color: AppColors.sectionLineGreen),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          const Icon(Icons.location_on_outlined, size: 14, color: AppColors.textMuted),
                          const SizedBox(width: 2),
                          Text(location, style: Theme.of(context).textTheme.bodySmall),
                          const SizedBox(width: AppSpacing.sm),
                          Text(
                            '· ${t(context, 'Posted', 'نُشر')} ${timeAgo(post.createdAt, lang)} ${t(context, 'ago', 'مضت')}',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      Text(t(context, 'Description', 'الوصف'), style: Theme.of(context).textTheme.headlineSmall),
                      const SizedBox(height: AppSpacing.xs),
                      Text(post.description, style: Theme.of(context).textTheme.bodyMedium),
                      const SizedBox(height: AppSpacing.lg),
                      const _SafetyNotice(),
                      const SizedBox(height: AppSpacing.lg),
                      _SellerCard(seller: post.creator),
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
          child: _isOwner ? _buildOwnerActions() : _buildBuyerActions(post),
        ),
      ),
    );
  }

  Widget _buildBuyerActions(PostDetail post) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          children: [
            _IconAction(icon: Icons.call_outlined, label: t(context, 'Call', 'اتصال'), onTap: _isSold ? null : _handleCall),
            _IconAction(icon: Icons.chat, label: t(context, 'WhatsApp', 'واتساب'), color: AppColors.sectionLineGreen, onTap: _isSold ? null : _handleMessage),
            _IconAction(
              icon: post.isSavedByMe ? Icons.bookmark : Icons.bookmark_border,
              label: t(context, 'Save', 'حفظ'),
              color: post.isSavedByMe ? AppColors.primary : null,
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
            label: Text(_isSold ? t(context, 'Sold', 'مباع') : t(context, 'Message Seller', 'راسل البائع')),
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
          child: OutlinedButton(
            onPressed: _busy ? null : _deleteListing,
            style: OutlinedButton.styleFrom(foregroundColor: AppColors.critical, side: const BorderSide(color: AppColors.critical)),
            child: Text(t(context, 'Delete', 'حذف')),
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: ElevatedButton(
            onPressed: _busy || _isSold ? null : _markSold,
            child: Text(_isSold ? t(context, 'Sold', 'مباع') : t(context, 'Mark Sold', 'تحديد كمباع')),
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
  final PostDetailUser seller;

  const _SellerCard({required this.seller});

  static const _monthsEn = [
    '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  static const _monthsAr = [
    '', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
  ];

  @override
  Widget build(BuildContext context) {
    final joined = seller.createdAt;
    final lang = context.watch<LangProvider>().lang;
    final name = lang == Lang.ar && seller.fullNameArabic != null && seller.fullNameArabic!.isNotEmpty
        ? seller.fullNameArabic!
        : (seller.fullName ?? t(context, 'Seller', 'البائع'));
    final monthName = lang == Lang.ar ? _monthsAr[joined.month] : _monthsEn[joined.month];
    final joinLabel = '$monthName ${joined.year}';
    final listingsLabel = seller.productPostCount == 1
        ? t(context, '1 listing', 'إعلان واحد')
        : '${seller.productPostCount} ${t(context, 'listings', 'إعلانات')}';
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
            backgroundImage: seller.profilePictureUrl != null ? NetworkImage(seller.profilePictureUrl!) : null,
            child: seller.profilePictureUrl == null ? Text(name.isNotEmpty ? name[0].toUpperCase() : '?') : null,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700)),
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
