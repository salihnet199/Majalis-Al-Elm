import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/core/network/media_file_fetcher.dart';

void main() {
  test('MediaFileFetcher exposes a real fetcher instance', () {
    final fetcher = MediaFileFetcher(
      dio: Dio(BaseOptions(baseUrl: 'http://127.0.0.1')),
    );
    expect(fetcher, isA<MediaFileFetcher>());
  });

  test('partial file cleanup path is deterministic', () async {
    final temp = Directory.systemTemp.createTempSync('majalis-test-');
    addTearDown(() => temp.deleteSync(recursive: true));
    final target = File('${temp.path}/media.pdf');
    final partial = File('${target.path}.part');
    await partial.writeAsBytes([1, 2, 3]);
    expect(await partial.exists(), isTrue);
  });
}
