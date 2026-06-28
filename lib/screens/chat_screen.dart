import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:lottie/lottie.dart';
import 'package:intl/intl.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:url_launcher/url_launcher.dart';

import '../providers/chat_provider.dart';
import '../models/message.dart';
import '../widgets/message_bubble.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  bool _isTyping = false;

  @override
  void initState() {
    super.initState();
    // تحميل المحادثات السابقة
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ChatProvider>().loadMessages();
    });
  }

  @override
  Widget build(BuildContext context) {
    final chatProvider = context.watch<ChatProvider>();
    
    return Scaffold(
      appBar: _buildAppBar(chatProvider),
      body: Column(
        children: [
          // جزء المحادثات
          Expanded(
            child: chatProvider.isLoading
                ? const Center(
                    child: CircularProgressIndicator(),
                  )
                : _buildMessagesList(chatProvider.messages),
          ),
          // مؤشر الكتابة
          if (_isTyping) _buildTypingIndicator(),
          // حقل الإدخال
          _buildMessageInput(chatProvider),
        ],
      ),
    );
  }

  PreferredSizeWidget _buildAppBar(ChatProvider chatProvider) {
    return AppBar(
      elevation: 0,
      backgroundColor: const Color(0xFF1A2B4A),
      title: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: const BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.chat_bubble_outline,
              color: Color(0xFF1A2B4A),
              size: 24,
            ),
          ),
          const SizedBox(width: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'سوداني بوت',
                style: GoogleFonts.tajawal(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              Text(
                'متصل 🟢',
                style: TextStyle(
                  color: Colors.white.withOpacity(0.7),
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ],
      ),
      actions: [
        IconButton(
          icon: const Icon(Icons.refresh, color: Colors.white),
          onPressed: () {
            chatProvider.clearMessages();
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('تم مسح المحادثة'),
                duration: Duration(seconds: 2),
              ),
            );
          },
        ),
      ],
    );
  }

  Widget _buildMessagesList(List<Message> messages) {
    if (messages.isEmpty) {
      return _buildEmptyState();
    }

    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
      itemCount: messages.length,
      itemBuilder: (context, index) {
        final message = messages[index];
        return MessageBubble(message: message);
      },
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Lottie.asset(
            'assets/animations/chat_empty.json',
            height: 200,
            repeat: true,
          ),
          const SizedBox(height: 20),
          Text(
            'مرحباً! كيف أقدر أساعدك اليوم؟',
            style: GoogleFonts.tajawal(
              fontSize: 20,
              fontWeight: FontWeight.bold,
              color: Colors.grey[700],
            ),
          ),
          const SizedBox(height: 10),
          Text(
            'اسألني عن الباقات، الرصيد، أو أي خدمة',
            style: GoogleFonts.tajawal(
              fontSize: 16,
              color: Colors.grey[600],
            ),
          ),
          const SizedBox(height: 30),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            alignment: WrapAlignment.center,
            children: [
              _buildSuggestionChip('عايز باقة نت'),
              _buildSuggestionChip('رصيدي خلص'),
              _buildSuggestionChip('كيف أشحن؟'),
              _buildSuggestionChip('سوداني كاش'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSuggestionChip(String text) {
    return ActionChip(
      label: Text(
        text,
        style: GoogleFonts.tajawal(fontSize: 14),
      ),
      onPressed: () {
        _sendMessage(text);
      },
      backgroundColor: const Color(0xFFE8F0FE),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
      ),
    );
  }

  Widget _buildTypingIndicator() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          CircleAvatar(
            radius: 16,
            backgroundColor: const Color(0xFF1A2B4A),
            child: const Text(
              'ب',
              style: TextStyle(
                color: Colors.white,
                fontSize: 12,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              color: const Color(0xFF1A2B4A).withOpacity(0.1),
              borderRadius: BorderRadius.circular(15),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                _buildDotAnimation(),
                const SizedBox(width: 4),
                _buildDotAnimation(delay: 0.5),
                const SizedBox(width: 4),
                _buildDotAnimation(delay: 1.0),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDotAnimation({double delay = 0}) {
    return AnimatedContainer(
      duration: Duration(milliseconds: 600 + (delay * 1000).toInt()),
      height: 8,
      width: 8,
      decoration: const BoxDecoration(
        color: Color(0xFF1A2B4A),
        shape: BoxShape.circle,
      ),
    );
  }

  Widget _buildMessageInput(ChatProvider chatProvider) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, -5),
          ),
        ],
      ),
      child: SafeArea(
        child: Row(
          children: [
            // زر الاختصارات
            IconButton(
              icon: const Icon(Icons.more_horiz),
              onPressed: () {
                _showQuickActions(context);
              },
            ),
            // حقل النص
            Expanded(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                decoration: BoxDecoration(
                  color: Colors.grey.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(25),
                ),
                child: TextField(
                  controller: _messageController,
                  textDirection: TextDirection.rtl,
                  style: GoogleFonts.tajawal(fontSize: 16),
                  decoration: InputDecoration(
                    hintText: 'اكتب سؤالك هنا...',
                    hintStyle: GoogleFonts.tajawal(
                      color: Colors.grey[500],
                    ),
                    border: InputBorder.none,
                    suffixIcon: IconButton(
                      icon: const Icon(Icons.mic, color: Colors.grey),
                      onPressed: () {
                        // TODO: تفعيل الإدخال الصوتي
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('ميزة الإدخال الصوتي قريباً!'),
                            duration: Duration(seconds: 2),
                          ),
                        );
                      },
                    ),
                  ),
                  onSubmitted: (text) {
                    if (text.trim().isNotEmpty) {
                      _sendMessage(text.trim());
                    }
                  },
                ),
              ),
            ),
            const SizedBox(width: 8),
            // زر الإرسال
            Container(
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF1A2B4A), Color(0xFF2A3F66)],
                ),
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFF1A2B4A).withOpacity(0.3),
                    blurRadius: 10,
                  ),
                ],
              ),
              child: IconButton(
                icon: const Icon(Icons.send, color: Colors.white),
                onPressed: () {
                  if (_messageController.text.trim().isNotEmpty) {
                    _sendMessage(_messageController.text.trim());
                  }
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _sendMessage(String text) async {
    _messageController.clear();
    
    final chatProvider = context.read<ChatProvider>();
    
    // إضافة رسالة المستخدم
    chatProvider.addMessage(Message(
      id: DateTime.now().toString(),
      text: text,
      isUser: true,
      timestamp: DateTime.now(),
    ));
    
    // التمرير للأسفل
    _scrollToBottom();
    
    // إظهار مؤشر الكتابة
    setState(() {
      _isTyping = true;
    });
    
    try {
      // الحصول على رد البوت
      final response = await chatProvider.sendMessage(text);
      
      // إضافة رسالة البوت
      chatProvider.addMessage(Message(
        id: DateTime.now().toString(),
        text: response,
        isUser: false,
        timestamp: DateTime.now(),
      ));
      
      _scrollToBottom();
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('حدث خطأ: ${e.toString()}'),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      setState(() {
        _isTyping = false;
      });
    }
  }

  void _scrollToBottom() {
    Future.delayed(const Duration(milliseconds: 100), () {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _showQuickActions(BuildContext context) {
    showModalBottomSheet(
      context: context,
      builder: (context) {
        return Container(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'الأسئلة الشائعة',
                style: GoogleFonts.tajawal(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 16),
              _buildQuickActionItem('📱 معرفة الرصيد', '*444#'),
              _buildQuickActionItem('💳 شحن الرصيد', '*123#'),
              _buildQuickActionItem('🌐 باقات الإنترنت', '*555#'),
              _buildQuickActionItem('💰 سوداني كاش', '*555#'),
            ],
          ),
        );
      },
    );
  }

  Widget _buildQuickActionItem(String title, String code) {
    return ListTile(
      leading: const Icon(Icons.code, color: Color(0xFF1A2B4A)),
      title: Text(
        title,
        style: GoogleFonts.tajawal(),
      ),
      subtitle: Text(
        code,
        style: const TextStyle(
          color: Color(0xFF1A2B4A),
          fontWeight: FontWeight.bold,
        ),
      ),
      trailing: IconButton(
        icon: const Icon(Icons.copy, size: 20),
        onPressed: () {
          // نسخ الكود
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('تم نسخ الكود'),
              duration: Duration(seconds: 1),
            ),
          );
          Navigator.pop(context);
        },
      ),
      onTap: () {
        // إرسال الكود كرسالة
        _sendMessage(title);
        Navigator.pop(context);
      },
    );
  }

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }
}
