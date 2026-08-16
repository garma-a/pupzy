class ApiConfig {
  ApiConfig._();

  /// Flip to true once there's a real production backend + HTTPS endpoint
  /// to put in [_prodGraphqlEndpoint] below.
  static const bool useProduction = false;

  static const String _prodGraphqlEndpoint = ''; // TODO: set before flipping useProduction to true

  // For Android emulator use 10.0.2.2, for iOS simulator use localhost
  // For physical device use your machine's local IP address
  static const String _devGraphqlEndpoint = 'http://10.0.2.2:8080/graphql';

  // Use this for web or when running on the same machine
  static const String _devGraphqlEndpointWeb = 'http://localhost:8080/graphql';

  static String get graphqlEndpoint => useProduction ? _prodGraphqlEndpoint : _devGraphqlEndpoint;
  static String get graphqlEndpointWeb => useProduction ? _prodGraphqlEndpoint : _devGraphqlEndpointWeb;
}
