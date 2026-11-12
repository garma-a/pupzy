import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/utils/distance_label.dart';

void main() {
  test('nearby distances keep one decimal', () {
    expect(formatDistanceKm(0.4), '0.4');
    expect(formatDistanceKm(2.36), '2.4');
    expect(formatDistanceKm(9.94), '9.9');
  });

  test('far distances are whole kilometres with separators', () {
    expect(formatDistanceKm(10), '10');
    expect(formatDistanceKm(12.6), '13');
    expect(formatDistanceKm(843.04), '843');
    expect(formatDistanceKm(1204.4), '1,204');
  });
}
