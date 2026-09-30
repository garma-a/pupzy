/// One page of a cursor-paginated list (a GraphQL connection).
class ListPage<T> {
  final List<T> items;

  /// Pass as `after` to fetch the next page.
  final String? endCursor;
  final bool hasNextPage;

  /// Set when the page couldn't be loaded; [items] is then empty.
  final String? errorMessage;

  const ListPage({this.items = const [], this.endCursor, this.hasNextPage = false, this.errorMessage});

  bool get failed => errorMessage != null;
}
