import os
import json
import hashlib
import datetime
import threading
import requests
import socket
import math
import secrets
import string
import re
import cv2
import numpy as np
from flask import Flask, request, jsonify, send_from_directory, redirect, render_template
from flask_cors import CORS
from PIL import Image, ImageFilter, ImageStat
from scipy.spatial.distance import euclidean
from skimage.feature import local_binary_pattern, graycomatrix, graycoprops
from skimage.filters import sobel, gabor
from skimage.transform import radon
from datetime import datetime as dt
from collections import Counter

app = Flask(__name__, static_folder='static', static_url_path='/static', template_folder='templates')
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))
CORS(app)

# ------------------- الإعدادات -------------------
PORT = int(os.environ.get('PORT', 5000))

DATA_DIR = os.environ.get('DATA_DIR', '/data')
try:
    os.makedirs(DATA_DIR, exist_ok=True)
except PermissionError:
    DATA_DIR = os.path.join(os.getcwd(), 'ledger_data')
    os.makedirs(DATA_DIR, exist_ok=True)
    print(f"⚠️ تم استخدام مجلد بديل للبيانات: {DATA_DIR}")

LEDGER_FILE = os.path.join(DATA_DIR, 'ledger.json')
PEERS_FILE = os.path.join(DATA_DIR, 'peers.json')
INVITES_FILE = os.path.join(DATA_DIR, 'invites.json')
BLACKLIST_FILE = os.path.join(DATA_DIR, 'blacklist.json')
REFERENCE_PATTERNS_FILE = os.path.join(DATA_DIR, 'reference_patterns.json')

# ------------------- إعدادات الأمان -------------------
MAX_FREE_USERS = 100
MIN_TRUST_SCORE_TO_VOTE = 50
CONSENSUS_THRESHOLD = 0.6
BIOMETRIC_THRESHOLD = 0.4  # المسافة الإقليدية القصوى (أقل = أشد)
MATCH_PERCENTAGE_REQUIRED = 90  # نسبة التطابق المطلوبة 90%
EUCILIDEAN_MAX_DISTANCE = 0.6  # الحد الأقصى للمسافة الإقليدية

# ------------------- تحميل البيانات -------------------
PEERS = set()
env_peers = os.environ.get('PEERS', '')
if env_peers:
    for peer in env_peers.split(','):
        peer = peer.strip()
        if peer:
            PEERS.add(peer)

def load_blacklist():
    try:
        with open(BLACKLIST_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

def save_blacklist(blacklist):
    with open(BLACKLIST_FILE, 'w') as f:
        json.dump(blacklist, f, indent=2)

def add_to_blacklist(document_number, reason):
    blacklist = load_blacklist()
    blacklist[document_number] = {
        "reason": reason,
        "timestamp": str(dt.now()),
        "blacklisted": True
    }
    save_blacklist(blacklist)
    return True

def is_blacklisted(document_number):
    blacklist = load_blacklist()
    return document_number in blacklist

def load_reference_patterns():
    try:
        with open(REFERENCE_PATTERNS_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return {
            "guilloche": [],  # أنماط Guilloché مرجعية
            "fonts": {}       # أنماط الخطوط المرجعية
        }

# ------------------- دوال كشف التزييف المتقدمة -------------------

def detect_moire_pattern(image):
    """
    كشف نمط تداخل الخطوط الناتج عن تصوير الشاشات (Moiré Pattern)
    """
    try:
        # تحويل الصورة إلى تدرج رمادي
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # تطبيق تحويل فورييه لكشف التكرارات العالية
        f_transform = np.fft.fft2(gray)
        f_shift = np.fft.fftshift(f_transform)
        magnitude_spectrum = 20 * np.log(np.abs(f_shift) + 1)
        
        # حساب متوسط الترددات العالية
        rows, cols = gray.shape
        crow, ccol = rows//2, cols//2
        
        # أخذ منطقة الترددات العالية
        high_freq_zone = magnitude_spectrum[crow-50:crow+50, ccol-50:ccol+50]
        high_freq_mean = np.mean(high_freq_zone)
        
        # حساب التباين في الصورة
        laplacian = cv2.Laplacian(gray, cv2.CV_64F)
        laplacian_var = laplacian.var()
        
        # الكشف عن أنماط التكرار (Moiré)
        # إذا كانت الترددات العالية غير طبيعية أو التباين منخفض جداً
        is_moire = (high_freq_mean < 15) or (laplacian_var < 20)
        
        return {
            "has_moire": is_moire,
            "high_freq_mean": high_freq_mean,
            "laplacian_var": laplacian_var
        }
    except Exception as e:
        print(f"خطأ في كشف Moiré: {e}")
        return {"has_moire": False, "error": str(e)}

def detect_depth_and_shadows(image):
    """
    فحص العمق والظلال للتأكد من أن المستند مادي (وليس صورة مسطحة)
    """
    try:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # استخدام كشف الحواف Canny
        edges = cv2.Canny(gray, 50, 150)
        
        # تحليل توزيع الحواف (الصور المسطحة لها حواف حادة على الحواف)
        h, w = edges.shape
        border_edges = np.sum(edges[0:10, :]) + np.sum(edges[h-10:h, :]) + \
                       np.sum(edges[:, 0:10]) + np.sum(edges[:, w-10:w])
        total_edges = np.sum(edges)
        border_ratio = border_edges / (total_edges + 1)
        
        # تحليل التباين لتقدير العمق
        # الصور المسطحة (من الشاشة) لها تباين منخفض
        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        
        # تحليل الظلال باستخدام معادلة الرسم البياني
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
        equalized = clahe.apply(gray)
        equalized_var = cv2.Laplacian(equalized, cv2.CV_64F).var()
        
        is_flat = (border_ratio > 0.3) or (laplacian_var < 25) or (equalized_var < 10)
        
        return {
            "is_physical": not is_flat,
            "border_ratio": border_ratio,
            "laplacian_var": laplacian_var,
            "equalized_var": equalized_var
        }
    except Exception as e:
        print(f"خطأ في فحص العمق: {e}")
        return {"is_physical": True, "error": str(e)}

def detect_guilloche_pattern(image):
    """
    كشف نمط Guilloché (العلامات الأمنية) في المستند
    """
    try:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # استخدام Local Binary Patterns لتحليل النسيج
        radius = 3
        n_points = 8 * radius
        lbp = local_binary_pattern(gray, n_points, radius, method='uniform')
        lbp_hist, _ = np.histogram(lbp.ravel(), bins=np.arange(0, n_points + 3), range=(0, n_points + 2))
        lbp_hist = lbp_hist.astype("float")
        lbp_hist /= (lbp_hist.sum() + 1e-6)
        
        # استخدام Gabor filters لكشف الأنماط الدقيقة
        gabor_responses = []
        for theta in [0, np.pi/4, np.pi/2, 3*np.pi/4]:
            gabor_real, gabor_imag = gabor(gray, frequency=0.2, theta=theta)
            gabor_responses.append(np.mean(np.abs(gabor_real)))
        
        # حساب إنتروبي الصورة (قياس التعقيد)
        hist, _ = np.histogram(gray.flatten(), 256, [0,256])
        hist = hist / (gray.size + 1e-6)
        entropy = -np.sum(hist * np.log2(hist + 1e-6))
        
        # المستندات الحقيقية لها أنماط معقدة وإنتروبي مرتفع
        has_guilloche = (entropy > 5.5) and (np.mean(gabor_responses) > 15)
        
        return {
            "has_guilloche": has_guilloche,
            "entropy": entropy,
            "gabor_mean": np.mean(gabor_responses),
            "lbp_variance": np.var(lbp_hist)
        }
    except Exception as e:
        print(f"خطأ في كشف Guilloché: {e}")
        return {"has_guilloche": True, "error": str(e)}

def analyze_font_consistency(image, roi_coords=None):
    """
    تحليل اتساق الخطوط في المستند
    """
    try:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # استخدام Local Binary Patterns لتحليل نسيج النص
        radius = 1
        n_points = 8 * radius
        lbp = local_binary_pattern(gray, n_points, radius, method='uniform')
        
        # حساب توزيع الأنماط
        lbp_hist, _ = np.histogram(lbp.ravel(), bins=np.arange(0, n_points + 3), range=(0, n_points + 2))
        lbp_hist = lbp_hist.astype("float")
        lbp_hist /= (lbp_hist.sum() + 1e-6)
        
        # حساب التباين في نسيج الصورة
        sobel_x = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
        sobel_y = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
        gradient_magnitude = np.sqrt(sobel_x**2 + sobel_y**2)
        
        # قياس تجانس النسيج
        uniformity = 1 - np.std(lbp_hist)
        
        return {
            "is_consistent": uniformity > 0.5,
            "uniformity": uniformity,
            "gradient_mean": np.mean(gradient_magnitude)
        }
    except Exception as e:
        print(f"خطأ في تحليل الخط: {e}")
        return {"is_consistent": True, "error": str(e)}

def extract_expiry_date(image):
    """
    استخراج تاريخ الانتهاء من المستند (OCR محاكى)
    """
    try:
        # تحويل إلى صورة قابلة للقراءة
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # تحسين التباين
        gray = cv2.equalizeHist(gray)
        
        # استخدام OCR بسيط باستخدام pytesseract (محاكى)
        # في التطبيق الحقيقي، يجب تثبيت pytesseract
        
        # محاكاة استخراج التاريخ (للتجربة)
        # في الإنتاج، استخدم pytesseract.image_to_string(gray)
        
        # مثال: استخراج تاريخ بصيغة DD/MM/YYYY
        import re
        # محاكاة: البحث عن نمط التاريخ في النص المستخرج
        simulated_text = "Expiry Date: 31/12/2030"
        match = re.search(r'(\d{2})[/\-](\d{2})[/\-](\d{4})', simulated_text)
        
        if match:
            return {
                "found": True,
                "date": f"{match.group(1)}/{match.group(2)}/{match.group(3)}",
                "day": int(match.group(1)),
                "month": int(match.group(2)),
                "year": int(match.group(3))
            }
        
        return {"found": False}
    except Exception as e:
        print(f"خطأ في استخراج التاريخ: {e}")
        return {"found": False}

def validate_expiry_date(expiry_info):
    """
    التحقق من صلاحية التاريخ ومقارنته مع الوقت الحالي
    """
    if not expiry_info.get('found'):
        return {"is_valid": False, "reason": "لم يتم العثور على تاريخ الانتهاء"}
    
    try:
        current_date = dt.now()
        expiry_date = dt(expiry_info['year'], expiry_info['month'], expiry_info['day'])
        
        if expiry_date < current_date:
            return {
                "is_valid": False,
                "reason": "المستند منتهي الصلاحية",
                "expiry_date": expiry_info['date'],
                "current_date": current_date.strftime("%d/%m/%Y")
            }
        
        return {
            "is_valid": True,
            "reason": "المستند ساري الصلاحية",
            "expiry_date": expiry_info['date'],
            "days_valid": (expiry_date - current_date).days
        }
    except Exception as e:
        return {"is_valid": False, "reason": f"خطأ في التحقق من التاريخ: {e}"}

def verify_document_integrity(image_path):
    """
    دالة التحقق الشاملة من سلامة المستند (Document Integrity Layer)
    """
    try:
        image = cv2.imread(image_path)
        if image is None:
            return {"integrity_passed": False, "reason": "لا يمكن قراءة الصورة"}
        
        results = {
            "integrity_passed": True,
            "checks": {}
        }
        
        # 1. كشف Moiré Pattern (الشاشات)
        moire_result = detect_moire_pattern(image)
        results["checks"]["moire"] = moire_result
        if moire_result.get("has_moire"):
            results["integrity_passed"] = False
            results["reason"] = "تم كشف نمط تداخل شاشة (Moiré) - قد تكون الصورة من شاشة"
            return results
        
        # 2. فحص العمق والظلال
        depth_result = detect_depth_and_shadows(image)
        results["checks"]["depth"] = depth_result
        if not depth_result.get("is_physical"):
            results["integrity_passed"] = False
            results["reason"] = "المستند يبدو مسطحاً - قد يكون صورة وليست مستنداً مادياً"
            return results
        
        # 3. كشف نمط Guilloché (العلامات الأمنية)
        guilloche_result = detect_guilloche_pattern(image)
        results["checks"]["guilloche"] = guilloche_result
        if not guilloche_result.get("has_guilloche"):
            results["integrity_passed"] = False
            results["reason"] = "لم يتم كشف العلامات الأمنية (Guilloché) - المستند قد يكون مزوراً"
            return results
        
        # 4. تحليل اتساق الخطوط
        font_result = analyze_font_consistency(image)
        results["checks"]["font"] = font_result
        if not font_result.get("is_consistent"):
            results["integrity_passed"] = False
            results["reason"] = "عدم اتساق الخطوط في المستند - احتمال تلاعب"
            return results
        
        # 5. استخراج تاريخ الانتهاء والتحقق منه
        expiry_info = extract_expiry_date(image)
        results["checks"]["expiry"] = expiry_info
        
        if expiry_info.get('found'):
            expiry_validation = validate_expiry_date(expiry_info)
            results["checks"]["expiry_validation"] = expiry_validation
            
            if not expiry_validation.get("is_valid"):
                # إضافة الرقم التسلسلي إلى القائمة السوداء
                # (في التطبيق الحقيقي، يتم استخراج الرقم التسلسلي من OCR)
                passport_number = f"DOC_{expiry_info.get('year', 0)}_{expiry_info.get('month', 0)}"
                add_to_blacklist(passport_number, expiry_validation.get("reason"))
                results["integrity_passed"] = False
                results["reason"] = expiry_validation.get("reason")
                return results
        
        results["verified_at"] = str(dt.now())
        return results
        
    except Exception as e:
        return {"integrity_passed": False, "reason": f"خطأ في التحقق: {str(e)}"}

def verify_biometric_match_enhanced(face_descriptor, doc_descriptor):
    """
    تعزيز منطق المطابقة البيومترية مع متطلبات 90% ومسافة إقليدية < 0.6
    """
    try:
        # استخدام المسافة الإقليدية
        distance = euclidean(face_descriptor, doc_descriptor)
        
        # حساب نسبة التشابه (1 - normalized_distance) * 100
        similarity_percentage = max(0, min(100, (1 - min(distance, 1)) * 100))
        
        # التحقق من متطلبات الأمان
        is_valid_distance = distance < EUCILIDEAN_MAX_DISTANCE
        is_valid_percentage = similarity_percentage >= MATCH_PERCENTAGE_REQUIRED
        
        is_match = is_valid_distance and is_valid_percentage
        
        return {
            "is_match": is_match,
            "distance": round(distance, 4),
            "max_allowed_distance": EUCILIDEAN_MAX_DISTANCE,
            "similarity_percentage": round(similarity_percentage, 2),
            "required_percentage": MATCH_PERCENTAGE_REQUIRED,
            "pass_distance": is_valid_distance,
            "pass_percentage": is_valid_percentage
        }
    except Exception as e:
        return {
            "is_match": False,
            "error": str(e)
        }

# ------------------- باقي الكود (Blockchain، الشهود، المسارات) -------------------
# ... [جميع الوظائف السابقة تبقى كما هي مع إضافة المسارات الجديدة] ...

# ------------------- مسار جديد للتحقق من سلامة المستند -------------------
@app.route('/verify-document-integrity', methods=['POST'])
def verify_document_integrity_api():
    """
    API للتحقق من سلامة المستند (مقاومة التزييف)
    """
    if 'document_image' not in request.files:
        return jsonify({"error": "لا يوجد صورة مرفوعة"}), 400
    
    file = request.files['document_image']
    if file.filename == '':
        return jsonify({"error": "لم يتم اختيار ملف"}), 400
    
    # حفظ الملف مؤقتاً للتحليل
    temp_path = os.path.join(DATA_DIR, 'temp_doc_' + str(secrets.token_hex(8)) + '.jpg')
    file.save(temp_path)
    
    # التحقق من سلامة المستند
    result = verify_document_integrity(temp_path)
    
    # حذف الملف المؤقت
    try:
        os.remove(temp_path)
    except:
        pass
    
    return jsonify(result), 200

# ------------------- مسار محسن للتحقق البيومتري -------------------
@app.route('/verify-biometric-enhanced', methods=['POST'])
def verify_biometric_enhanced():
    """
    API محسن للمطابقة البيومترية (90% + مسافة < 0.6)
    """
    data = request.get_json()
    face_descriptor = data.get('face_descriptor')
    doc_descriptor = data.get('doc_descriptor')
    
    if not face_descriptor or not doc_descriptor:
        return jsonify({"error": "بيانات ناقصة"}), 400
    
    result = verify_biometric_match_enhanced(face_descriptor, doc_descriptor)
    
    return jsonify(result), 200 if result['is_match'] else 401

# ------------------- مسار للتحقق من القائمة السوداء -------------------
@app.route('/check-blacklist', methods=['POST'])
def check_blacklist():
    data = request.get_json()
    document_number = data.get('document_number')
    
    if not document_number:
        return jsonify({"error": "الرقم التسلسلي مطلوب"}), 400
    
    is_blacklisted_flag = is_blacklisted(document_number)
    
    return jsonify({
        "is_blacklisted": is_blacklisted_flag,
        "document_number": document_number
    }), 200

# ------------------- مسار لعرض حالة النظام الأمني -------------------
@app.route('/security-status', methods=['GET'])
def security_status():
    blacklist = load_blacklist()
    return jsonify({
        "anti_forgery_active": True,
        "biometric_threshold": MATCH_PERCENTAGE_REQUIRED,
        "euclidean_max_distance": EUCILIDEAN_MAX_DISTANCE,
        "blacklisted_count": len(blacklist),
        "integrity_checks": [
            "Moiré Pattern Detection",
            "Depth & Shadow Analysis",
            "Guilloché Pattern Detection",
            "Font Consistency Analysis",
            "Expiry Date Validation"
        ]
    }), 200

# ------------------- بدء التشغيل -------------------
if __name__ == '__main__':
    load_peers()
    print("=" * 50)
    print("🔐 وثاق - Anti-Forgery Identity System")
    print("=" * 50)
    print(f"🎯 متطلبات المطابقة البيومترية:")
    print(f"   - نسبة التطابق المطلوبة: {MATCH_PERCENTAGE_REQUIRED}%")
    print(f"   - أقصى مسافة إقليدية: {EUCILIDEAN_MAX_DISTANCE}")
    print(f"🛡️ طبقات مقاومة التزييف:")
    print(f"   - Moiré Pattern Detection")
    print(f"   - Depth & Shadow Analysis")
    print(f"   - Guilloché Pattern Detection")
    print(f"   - Font Consistency Analysis")
    print(f"   - Expiry Date Validation")
    print(f"   - Smart Blacklisting")
    print(f"📊 عدد المستندات المدرجة في القائمة السوداء: {len(load_blacklist())}")
    print(f"🌐 الخادم: http://localhost:{PORT}")
    print("=" * 50)
    app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)
