import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_dotenv/flutter_dotenv.dart';

class ApiService {
  final String baseUrl = dotenv.env['API_URL'] ?? 'http://localhost:3000';

  // إرسال رسالة
  Future<String> sendChatMessage(String message) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/api/chat/message'),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: jsonEncode({
          'message': message,
          'userId': 'flutter_user',
        }),
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return data['response'] ?? 'آسف، ما فهمت سؤالك. حاول مرة أخرى.';
      } else {
        throw Exception('Server error: ${response.statusCode}');
      }
    } catch (e) {
      print('API Error: $e');
      throw Exception('Network error: $e');
    }
  }

  // جلب الإحصائيات (للواجهة الإدارية)
  Future<Map<String, dynamic>> getAnalytics() async {
    try {
      final response = await http.get(
        Uri.parse('$baseUrl/api/chat/analytics'),
        headers: {
          'Content-Type': 'application/json',
        },
      );

      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      } else {
        throw Exception('Failed to fetch analytics');
      }
    } catch (e) {
      print('Analytics Error: $e');
      return {};
    }
  }
}
