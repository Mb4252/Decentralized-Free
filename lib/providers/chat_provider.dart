import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/message.dart';
import '../services/api_service.dart';

class ChatProvider extends ChangeNotifier {
  List<Message> _messages = [];
  bool _isLoading = false;
  
  List<Message> get messages => _messages;
  bool get isLoading => _isLoading;

  final ApiService _apiService = ApiService();

  // تحميل المحادثات السابقة
  Future<void> loadMessages() async {
    _isLoading = true;
    notifyListeners();

    try {
      final prefs = await SharedPreferences.getInstance();
      final messagesJson = prefs.getStringList('messages') ?? [];
      
      _messages = messagesJson.map((json) {
        final data = jsonDecode(json);
        return Message.fromJson(data);
      }).toList();
    } catch (e) {
      print('Error loading messages: $e');
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // إضافة رسالة جديدة
  void addMessage(Message message) {
    _messages.add(message);
    _saveMessages();
    notifyListeners();
  }

  // إرسال رسالة إلى API
  Future<String> sendMessage(String text) async {
    _isLoading = true;
    notifyListeners();

    try {
      final response = await _apiService.sendChatMessage(text);
      return response;
    } catch (e) {
      print('Error sending message: $e');
      return 'آسف يا حبيبي، حدث خطأ. حاول مرة أخرى أو اتصل بنا على 123.';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // حفظ الرسائل في التخزين المحلي
  Future<void> _saveMessages() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final messagesJson = _messages.map((msg) => jsonEncode(msg.toJson())).toList();
      await prefs.setStringList('messages', messagesJson);
    } catch (e) {
      print('Error saving messages: $e');
    }
  }

  // مسح المحادثة
  void clearMessages() {
    _messages.clear();
    _saveMessages();
    notifyListeners();
  }
}
