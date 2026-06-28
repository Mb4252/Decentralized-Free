import 'package:flutter/material.dart';
import 'package:lottie/lottie.dart';
import 'package:shared_preferences/shared_preferences.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    _checkFirstTime();
  }

  Future<void> _checkFirstTime() async {
    final prefs = await SharedPreferences.getInstance();
    final isFirstTime = prefs.getBool('is_first_time') ?? true;

    await Future.delayed(const Duration(seconds: 3));

    if (mounted) {
      if (isFirstTime) {
        // أول مرة يفتح التطبيق
        Navigator.pushReplacementNamed(context, '/welcome');
        await prefs.setBool('is_first_time', false);
      } else {
        // مستخدم موجود
        Navigator.pushReplacementNamed(context, '/chat');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              const Color(0xFF1A2B4A),
              const Color(0xFF2A3F66),
              Colors.white.withOpacity(0.1),
            ],
          ),
        ),
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // لوجو سوداني
              Container(
                width: 150,
                height: 150,
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.9),
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.3),
                      blurRadius: 20,
                      spreadRadius: 5,
                    ),
                  ],
                ),
                child: const Icon(
                  Icons.chat_bubble_outline,
                  size: 80,
                  color: Color(0xFF1A2B4A),
                ),
              ),
              const SizedBox(height: 30),
              // نص الترحيب
              Text(
                'سوداني بوت',
                style: TextStyle(
                  fontSize: 32,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                  shadows: [
                    Shadow(
                      color: Colors.black.withOpacity(0.3),
                      blurRadius: 10,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              Text(
                'مساعدك الذكي',
                style: TextStyle(
                  fontSize: 18,
                  color: Colors.white.withOpacity(0.8),
                ),
              ),
              const SizedBox(height: 50),
              // أنيميشن تحميل
              SizedBox(
                height: 60,
                width: 60,
                child: Lottie.asset(
                  'assets/animations/loading.json',
                  repeat: true,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
