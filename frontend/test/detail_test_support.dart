import 'package:pupzy/models/adoption_application.dart';
import 'package:pupzy/models/contact_request.dart';
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
  @override
  Future<(List<AdoptionApplication>, String?)> fetchMyAdoptionApplications({int first = 20}) async => (List.of(myApplications), null);
  @override
  Future<(bool, String?)> renewPost(String postId) async {
    renewCalls++;
    return (renewError == null, renewError);
  }
  @override
  Future<(List<ContactRequest>, String?)> fetchPostContactRequests({required String postId, String? status, int first = 20}) async =>
      (<ContactRequest>[], null);
  @override
  Future<(List<AdoptionApplication>, String?)> fetchPostAdoptionApplications({required String postId, String? status, int first = 20}) async =>
      (<AdoptionApplication>[], null);
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
