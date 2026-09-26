import 'package:pupzy/models/adoption_application.dart';
import 'package:pupzy/models/contact_request.dart';
import 'package:pupzy/models/list_page.dart';
import 'package:pupzy/models/mating_detail.dart';
import 'package:pupzy/models/post_detail.dart';

import 'safety_test_support.dart';

/// A [FakeSafetyGraphQL] that can also serve a Post's detail screen: the
/// viewer's identity, each post type's extension, and the viewer's own
/// applications, plus a scriptable renewal.
class FakeDetailGraphQL extends FakeSafetyGraphQL {
  String meId = 'viewer-1';
  RescuePostExtension? rescue;
  LostPostExtension? lost;
  AdoptionPostExtension? adoption;
  ProductPostExtension? product;
  MatingDetails? mating;
  List<AdoptionApplication> myApplications = [];
  String? renewError;
  int renewCalls = 0;

  @override
  Future<Map<String, dynamic>?> fetchMe() async => {'id': meId, 'fullName': 'Me', 'profileComplete': true};
  @override
  Future<void> recordView(String postId) async {}
  @override
  Future<(RescuePostExtension?, String?)> fetchRescuePostDetail(String postId) async => (rescue, null);
  @override
  Future<(LostPostExtension?, String?)> fetchLostPostDetail(String postId) async => (lost, null);
  @override
  Future<(AdoptionPostExtension?, String?)> fetchAdoptionPostDetail(String postId) async => (adoption, null);
  @override
  Future<(ProductPostExtension?, String?)> fetchProductPostDetail(String postId) async => (product, null);
  @override
  Future<(MatingDetails?, String?)> fetchMatingPostDetail(String postId) async => (mating, null);
  final List<String?> myApplicationCursors = [];
  @override
  Future<ListPage<AdoptionApplication>> fetchMyAdoptionApplications({int first = 20, String? after}) async {
    myApplicationCursors.add(after);
    return pageFor(myApplications, first, after);
  }
  @override
  Future<(bool, String?)> renewPost(String postId) async {
    renewCalls++;
    return (renewError == null, renewError);
  }
  /// Requests and applications received on the owner's Post.
  List<ContactRequest> postRequests = [];
  List<AdoptionApplication> postApplications = [];

  @override
  Future<ListPage<ContactRequest>> fetchPostContactRequests({
    required String postId,
    String? status,
    int first = 20,
    String? after,
  }) async =>
      keysetPage(postRequests, (r) => status == null || r.status == status, (r) => r.id, first, after);
  @override
  Future<ListPage<AdoptionApplication>> fetchPostAdoptionApplications({
    required String postId,
    String? status,
    int first = 20,
    String? after,
  }) async =>
      pageFor(postApplications.where((a) => status == null || a.status == status).toList(), first, after);

  /// Keyset paging like the API: continue after the last item's id, so rows
  /// that change status meanwhile never shift the next page.
  ListPage<T> keysetPage<T>(List<T> all, bool Function(T) keep, String Function(T) id, int first, String? after) {
    final start = after == null ? 0 : all.indexWhere((x) => id(x) == after) + 1;
    final out = <T>[];
    var i = start;
    for (; i < all.length && out.length < first; i++) {
      if (keep(all[i])) out.add(all[i]);
    }
    return ListPage(items: out, endCursor: out.isEmpty ? after : id(out.last), hasNextPage: all.skip(i).any(keep));
  }

  @override
  Future<(ContactRequest?, String?)> approveContactRequest(String requestId) async {
    final i = postRequests.indexWhere((r) => r.id == requestId);
    postRequests[i] = postRequests[i].copyWith(status: 'APPROVED');
    return (postRequests[i], null);
  }
}

const ownerId = 'owner-1';

PostDetail post(String type, {String status = 'ACTIVE'}) => PostDetail.fromJson({
      'id': 'post-$type',
      'postType': type,
      'title': 'A $type post',
      'description': 'Description long enough to read.',
      'status': status,
      'urgency': type == 'RESCUE' || type == 'LOST' ? 'URGENT' : null,
      'city': {'id': 'c1', 'nameEnglish': 'Qasr Al-Nile', 'nameArabic': 'قصر النيل', 'governorate': 'Cairo'},
      'coordinates': type == 'RESCUE' || type == 'LOST' ? {'latitude': 30.04, 'longitude': 31.23} : null,
      'media': <Object>[],
      'creator': {'id': ownerId, 'fullName': 'Olivia Owner', 'createdAt': '2026-01-01T00:00:00Z'},
      'upvoteCount': 0,
      'saveCount': 0,
      'viewCount': 0,
      'commentCount': 0,
      'createdAt': '2026-09-20T10:00:00Z',
      'nearestVetClinics': <Object>[],
    });
