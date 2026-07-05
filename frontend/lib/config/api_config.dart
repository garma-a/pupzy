class ApiConfig {
  ApiConfig._();

  // For Android emulator use 10.0.2.2, for iOS simulator use localhost
  // For physical device use your machine's local IP address
  static const String graphqlEndpoint = 'http://10.0.2.2:8080/graphql';

  // Use this for web or when running on the same machine
  static const String graphqlEndpointWeb = 'http://localhost:8080/graphql';
}
