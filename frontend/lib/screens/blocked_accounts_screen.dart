import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/blocked_user.dart';
import '../services/graphql_service.dart';
import '../services/safety_events.dart';
import '../theme/app_theme.dart';

/// Lists the accounts the viewer has blocked (newest first, cursor-paginated)
/// with a per-row Unblock action. Shows display identity and the date only —
/// never Block direction or reason, per the backend integration contract.
class BlockedAccountsScreen extends StatefulWidget {
  const BlockedAccountsScreen({super.key});

  @override
  State<BlockedAccountsScreen> createState() => _BlockedAccountsScreenState();
}

class _BlockedAccountsScreenState extends State<BlockedAccountsScreen> {
  static const _pageSize = 20;

  bool _loading = true;
  String? _errorMessage;
  List<BlockedUser> _users = [];
  String? _endCursor;
  bool _hasNextPage = false;
  bool _loadingMore = false;
  bool _loadMoreFailed = false;
  final Set<String> _unblocking = {};

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
    final (users, endCursor, hasNextPage, error) = await graphql.fetchBlockedUsers(first: _pageSize);
    if (!mounted) return;
    setState(() {
      _loading = false;
      _loadMoreFailed = false;
      if (error != null) {
        _errorMessage = error;
        return;
      }
      _users = users;
      _endCursor = endCursor;
      _hasNextPage = hasNextPage;
    });
  }

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasNextPage) return;
    setState(() {
      _loadingMore = true;
      _loadMoreFailed = false;
    });
    final graphql = context.read<GraphQLService>();
    final (more, endCursor, hasNextPage, error) = await graphql.fetchBlockedUsers(first: _pageSize, after: _endCursor);
    if (!mounted) return;
    setState(() {
      _loadingMore = false;
      if (error != null) {
        // Stop auto-loading until the user taps Retry, so a persistent
        // failure can't turn into a request loop.
        _loadMoreFailed = true;
        return;
      }
      _users = [..._users, ...more];
      _endCursor = endCursor;
      _hasNextPage = hasNextPage;
    });
  }

  Future<void> _unblock(BlockedUser user) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.background,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.card)),
        title: Text(t(ctx, 'Unblock', 'إلغاء الحظر')),
        content: Text(t(ctx, 'Unblock this account? They may appear in your feed again.', 'هل تريد إلغاء حظر هذا الحساب؟ قد يظهر مرة أخرى في صفحتك الرئيسية.')),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(t(ctx, 'Cancel', 'إلغاء'))),
          TextButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(t(ctx, 'Unblock', 'إلغاء الحظر'))),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    final graphql = context.read<GraphQLService>();
    final events = context.read<SafetyEvents>();
    final unblockedCopy = t(context, 'Account unblocked.', 'تم إلغاء الحظر.');
    final failedCopy = t(context, 'Could not unblock this account. Try again.', 'تعذر إلغاء حظر هذا الحساب. حاول مرة أخرى.');

    setState(() => _unblocking.add(user.id));
    final result = await graphql.unblockUser(user.id);
    if (!mounted) return;
    setState(() => _unblocking.remove(user.id));
    if (!result.ok) {
      Fluttertoast.showToast(msg: result.message ?? failedCopy);
      return;
    }
    setState(() => _users = _users.where((u) => u.id != user.id).toList());
    // Their content is reachable again — make every feed reload.
    events.blockListChanged();
    Fluttertoast.showToast(msg: unblockedCopy);
  }

  @override
  Widget build(BuildContext context) {
    // Own pushed route — see account_suspended_screen.dart's comment for
    // why this direct dependency is needed for immediate language updates.
    context.watch<LangProvider>();
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        title: Text(t(context, 'Blocked Accounts', 'الحسابات المحظورة'), style: Theme.of(context).textTheme.headlineSmall),
      ),
      body: SafeArea(child: _buildBody(context)),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());

    if (_errorMessage != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_outlined, size: 40, color: AppColors.textMuted),
              const SizedBox(height: AppSpacing.sm),
              Text(_errorMessage!, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted)),
              const SizedBox(height: AppSpacing.md),
              OutlinedButton(onPressed: _load, child: Text(t(context, 'Retry', 'إعادة المحاولة'))),
            ],
          ),
        ),
      );
    }

    if (_users.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.block_outlined, size: 40, color: AppColors.textMuted),
              const SizedBox(height: AppSpacing.sm),
              Text(
                t(context, "You haven't blocked anyone.", 'لم تقم بحظر أي حساب.'),
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
              ),
            ],
          ),
        ),
      );
    }

    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(AppSpacing.lg),
        itemCount: _users.length + (_hasNextPage ? 1 : 0),
        separatorBuilder: (_, _) => const Divider(height: 1, color: AppColors.border),
        itemBuilder: (context, i) {
          if (i >= _users.length) {
            if (_loadMoreFailed) {
              return Center(child: TextButton(onPressed: _loadMore, child: Text(t(context, 'Retry', 'إعادة المحاولة'))));
            }
            // The loader row is only built once the list reaches it (or when
            // the first page doesn't fill the screen), which is exactly when
            // the next page is needed.
            if (!_loadingMore) {
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (mounted) _loadMore();
              });
            }
            return const Padding(
              padding: EdgeInsets.symmetric(vertical: AppSpacing.md),
              child: Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))),
            );
          }
          final user = _users[i];
          final name = user.displayName(arabic: arabic) ?? t(context, 'Pupzy user', 'مستخدم Pupzy');
          final date = MaterialLocalizations.of(context).formatShortDate(user.blockedAt.toLocal());
          final busy = _unblocking.contains(user.id);
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 22,
                  backgroundColor: AppColors.surfaceWarm,
                  backgroundImage: user.profilePictureUrl != null ? NetworkImage(user.profilePictureUrl!) : null,
                  child: user.profilePictureUrl == null ? const Icon(Icons.person, color: AppColors.textMuted) : null,
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Flexible(
                            child: Text(name, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700)),
                          ),
                          if (user.isVerified) ...[
                            const SizedBox(width: 4),
                            const Icon(Icons.verified, size: 16, color: AppColors.primary),
                          ],
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        t(context, 'Blocked on $date', 'تم الحظر في $date'),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                OutlinedButton(
                  key: Key('unblock_${user.id}'),
                  onPressed: busy ? null : () => _unblock(user),
                  child: busy
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : Text(t(context, 'Unblock', 'إلغاء الحظر')),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
