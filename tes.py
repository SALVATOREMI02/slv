from mfrc522 import SimpleMFRC522
import RPi.GPIO as GPIO
import time
from datetime import datetime, date
import os
import cv2
import torch
import numpy as np
from ultralytics import YOLO
import threading
import subprocess
import pygame
import json

# =============================
# KONFIGURASI SISTEM
# =============================
CONFIG = {
    'model_path': "runs/detect/train/weights/best.pt",
    'confidence_threshold': 0.35,
    'required_objects': ['NAME TAG', 'PIN CITA CITA', 'ID CARD'],
    'detection_duration': 6,  # 6 detik proses deteksi
    'servo_pin': 18,
    'default_angle': 50,
    'min_confidence': 0.5,  # Minimal confidence untuk dianggap terdeteksi
    'audio_files': {
        'no_card': "Tanpa Kartu aku~.mp3",
        'all_attributes': "semua atribut lengkap.mp3", 
        'violation': "pelanggaran.mp3",
        'already_tapped': "sudah_tap_hari_ini.mp3"  # Audio baru untuk sudah tap
    },
    'video_files': {
        'normal': "normal.mp4",
        'happy': "senang.mp4", 
        'ledek': "ledek.mp4",
        'already_tapped': "sudah_tap_hari_ini.mp4"  # Video baru untuk sudah tap
    }
}

# Inisialisasi pembaca RFID
reader = SimpleMFRC522()

# Global variables
camera = None
model = None
current_card_data = {}
rfid_detected = False
rfid_data = None
video_playing = False
system_active = True

# Initialize pygame for audio
pygame.mixer.init()

# =============================
# DETECTION MANAGER SEDERHANA
# =============================

class SimpleDetectionManager:
    def __init__(self):
        self.detected_objects = set()
        self.highest_confidence = {}
        
    def update_detections(self, detections):
        """Update deteksi objek"""
        for detection in detections:
            class_name = detection['class_name']
            confidence = detection['confidence']
            
            if confidence >= CONFIG['min_confidence']:
                self.detected_objects.add(class_name)
                
                # Simpan confidence tertinggi
                if class_name not in self.highest_confidence or confidence > self.highest_confidence[class_name]:
                    self.highest_confidence[class_name] = confidence
    
    def get_results(self):
        """Hasil akhir deteksi"""
        return {
            'detected_objects': list(self.detected_objects),
            'missing_objects': [obj for obj in CONFIG['required_objects'] if obj not in self.detected_objects],
            'confidence_scores': self.highest_confidence,
            'success': len(self.detected_objects) == len(CONFIG['required_objects']),
            'detected_count': len(self.detected_objects),
            'total_required': len(CONFIG['required_objects'])
        }
    
    def reset(self):
        """Reset untuk deteksi baru"""
        self.detected_objects = set()
        self.highest_confidence = {}

# Initialize detection manager
detection_manager = SimpleDetectionManager()

# =============================
# FUNGSI UTILITY - DITAMBAH FITUR TAP SEHARI SEKALI
# =============================

JSON_FILE = "presensi.json"

def load_presensi_data():
    """Memuat data presensi dari file JSON"""
    try:
        if os.path.exists(JSON_FILE):
            with open(JSON_FILE, 'r') as f:
                return json.load(f)
        return []
    except Exception as e:
        print(f"❌ Error loading presensi data: {e}")
        return []

def save_presensi_data(data):
    """Menyimpan data presensi ke file JSON"""
    try:
        existing_data = load_presensi_data()
        existing_data.append(data)
        
        with open(JSON_FILE, 'w') as f:
            json.dump(existing_data, f, indent=4)
        
        print(f"✅ Data presensi berhasil disimpan ke {JSON_FILE}")
        return True
    except Exception as e:
        print(f"❌ Error saving presensi data: {e}")
        return False

def check_already_tapped_today(card_id):
    """Cek apakah kartu sudah di-tap hari ini"""
    try:
        today = date.today().isoformat()
        presensi_data = load_presensi_data()
        
        for record in presensi_data:
            if (record.get('card_id') == card_id and 
                record.get('tanggal') == today):
                return True, record
        return False, None
    except Exception as e:
        print(f"❌ Error checking tap history: {e}")
        return False, None

def safe_camera_read():
    """Membaca frame kamera dengan error handling"""
    global camera
    try:
        ret, frame = camera.read()
        if ret:
            frame = cv2.resize(frame, (640, 480))
            return True, frame
        return False, None
    except Exception as e:
        return False, None

# =============================
# FUNGSI FULLSCREEN WINDOW
# =============================

def create_fullscreen_window(window_name):
    """Membuat window fullscreen tanpa status bar"""
    try:
        cv2.namedWindow(window_name, cv2.WND_PROP_FULLSCREEN)
        cv2.setWindowProperty(window_name, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)
        print(f"✅ Fullscreen window created: {window_name}")
    except Exception as e:
        print(f"❌ Error creating fullscreen window: {e}")
        # Fallback ke window normal
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(window_name, 640, 480)

def create_normal_window(window_name):
    """Membuat window normal"""
    try:
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(window_name, 640, 480)
    except:
        pass

# =============================
# FUNGSI AUDIO & VIDEO - DITAMBAH FITUR SUDAH TAP
# =============================

def play_audio(audio_file):
    """Memutar file audio"""
    try:
        if os.path.exists(audio_file):
            print(f"🔊 Playing audio: {audio_file}")
            pygame.mixer.music.load(audio_file)
            pygame.mixer.music.play()
        else:
            print(f"❌ Audio file not found: {audio_file}")
    except Exception as e:
        print(f"❌ Error playing audio: {e}")

def stop_audio():
    """Menghentikan audio yang sedang diputar"""
    try:
        pygame.mixer.music.stop()
    except:
        pass

def play_already_tapped_video():
    """Memutar video untuk kartu yang sudah tap hari ini - FULLSCREEN"""
    video_path = CONFIG['video_files'].get('already_tapped', CONFIG['video_files']['ledek'])
    
    if not os.path.exists(video_path):
        print(f"❌ Video file {video_path} tidak ditemukan")
        show_already_tapped_static_screen()
        return
    
    print("🎬 Memutar video sudah_tap_hari_ini.mp4...")
    
    # Putar audio
    audio_thread = threading.Thread(target=play_audio, args=(CONFIG['audio_files']['already_tapped'],))
    audio_thread.daemon = True
    audio_thread.start()
    
    cap = cv2.VideoCapture(video_path)
    
    # GUNAKAN FULLSCREEN
    create_fullscreen_window("Sudah Tap Hari Ini")
    
    start_time = time.time()
    max_play_time = 5
    
    while time.time() - start_time < max_play_time and system_active:
        ret, frame = cap.read()
        
        if not ret:
            break
        
        frame = cv2.resize(frame, (640, 480))
        
        cv2.imshow("Sudah Tap Hari Ini", frame)
        
        if cv2.waitKey(30) & 0xFF in [ord('q'), 27]:  # 27 = ESC key
            stop_audio()
            break
    
    cap.release()
    cv2.destroyWindow("Sudah Tap Hari Ini")
    stop_audio()

def show_already_tapped_static_screen():
    """Fallback static screen untuk sudah tap - FULLSCREEN"""
    create_fullscreen_window("Sudah Tap Hari Ini")
    
    audio_thread = threading.Thread(target=play_audio, args=(CONFIG['audio_files']['already_tapped'],))
    audio_thread.daemon = True
    audio_thread.start()
    
    start_time = time.time()
    max_play_time = 5
    
    while time.time() - start_time < max_play_time and system_active:
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        
        cv2.putText(frame, "SUDAH PRESENSI HARI INI", (120, 150), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 3)
        cv2.putText(frame, "Kartu sudah digunakan hari ini", (150, 200), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cv2.putText(frame, "Silakan kembali besok", (200, 250), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        
        remaining = int(max_play_time - (time.time() - start_time))
        cv2.putText(frame, f"Kembali dalam: {remaining} detik", (200, 350), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2)
        
        cv2.imshow("Sudah Tap Hari Ini", frame)
        
        if cv2.waitKey(100) & 0xFF in [ord('q'), 27]:  # 27 = ESC key
            stop_audio()
            break
    
    cv2.destroyWindow("Sudah Tap Hari Ini")
    stop_audio()

def play_video_with_rfid_waiting():
    """Memutar video normal.mp4 sambil menunggu RFID - FULLSCREEN"""
    global video_playing, rfid_detected, rfid_data, system_active
    
    video_path = CONFIG['video_files']['normal']
    
    if not os.path.exists(video_path):
        print(f"❌ Video file {video_path} tidak ditemukan")
        show_static_waiting_screen()
        return None
    
    print("🎬 Memutar video normal.mp4 sambil menunggu RFID...")
    
    # Putar audio
    audio_thread = threading.Thread(target=play_audio, args=(CONFIG['audio_files']['no_card'],))
    audio_thread.daemon = True
    audio_thread.start()
    
    video_playing = True
    rfid_detected = False
    rfid_data = None
    
    cap = cv2.VideoCapture(video_path)
    
    rfid_thread = threading.Thread(target=rfid_listener)
    rfid_thread.daemon = True
    rfid_thread.start()
    
    # GUNAKAN FULLSCREEN
    create_fullscreen_window("Sistem Presensi")
    
    while video_playing and system_active:
        ret, frame = cap.read()
        
        if not ret:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue
        
        frame = cv2.resize(frame, (640, 480))
        
        # Tambahkan overlay teks
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 400), (640, 480), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.6, frame, 0.4, 0, frame)
        
        cv2.putText(frame, "Tempelkan Kartu RFID Anda", (120, 430), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        cv2.putText(frame, "Status: Menunggu Kartu...", (200, 460), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
        
        cv2.imshow("Sistem Presensi", frame)
        
        key = cv2.waitKey(50) & 0xFF
        if key == ord('q') or key == 27:  # 27 = ESC key
            video_playing = False
            stop_audio()
            break
        
        if rfid_detected:
            print("🎯 RFID terdeteksi, menghentikan video...")
            video_playing = False
            stop_audio()
            break
    
    cap.release()
    video_playing = False
    if rfid_thread.is_alive():
        rfid_thread.join(timeout=1.0)
    
    return rfid_data

def play_happy_video():
    """Memutar video senang.mp4 - FULLSCREEN"""
    video_path = CONFIG['video_files']['happy']
    
    if not os.path.exists(video_path):
        print(f"❌ Video file {video_path} tidak ditemukan")
        show_happy_static_screen()
        return
    
    print("🎬 Memutar video senang.mp4...")
    
    # Putar audio
    audio_thread = threading.Thread(target=play_audio, args=(CONFIG['audio_files']['all_attributes'],))
    audio_thread.daemon = True
    audio_thread.start()
    
    cap = cv2.VideoCapture(video_path)
    
    # GUNAKAN FULLSCREEN
    create_fullscreen_window("Selamat - Atribut Lengkap")
    
    start_time = time.time()
    max_play_time = 5
    
    while time.time() - start_time < max_play_time and system_active:
        ret, frame = cap.read()
        
        if not ret:
            break
        
        frame = cv2.resize(frame, (640, 480))
        
        cv2.imshow("Selamat - Atribut Lengkap", frame)
        
        if cv2.waitKey(30) & 0xFF in [ord('q'), 27]:  # 27 = ESC key
            stop_audio()
            break
    
    cap.release()
    cv2.destroyWindow("Selamat - Atribut Lengkap")
    stop_audio()

def play_ledek_video():
    """Memutar video ledek.mp4 - FULLSCREEN"""
    video_path = CONFIG['video_files']['ledek']
    
    if not os.path.exists(video_path):
        print(f"❌ Video file {video_path} tidak ditemukan")
        show_ledek_static_screen()
        return
    
    print("🎬 Memutar video ledek.mp4...")
    
    audio_thread = threading.Thread(target=play_audio, args=(CONFIG['audio_files']['violation'],))
    audio_thread.daemon = True
    audio_thread.start()
    
    cap = cv2.VideoCapture(video_path)
    
    # GUNAKAN FULLSCREEN
    create_fullscreen_window("Atribut Tidak Lengkap")
    
    start_time = time.time()
    max_play_time = 5
    
    while time.time() - start_time < max_play_time and system_active:
        ret, frame = cap.read()
        
        if not ret:
            break
        
        frame = cv2.resize(frame, (640, 480))
        
        cv2.imshow("Atribut Tidak Lengkap", frame)
        
        if cv2.waitKey(30) & 0xFF in [ord('q'), 27]:  # 27 = ESC key
            stop_audio()
            break
    
    cap.release()
    cv2.destroyWindow("Atribut Tidak Lengkap")
    stop_audio()

def show_static_waiting_screen():
    """Fallback static screen jika video tidak ada - FULLSCREEN"""
    global video_playing, rfid_detected, rfid_data, system_active
    
    audio_thread = threading.Thread(target=play_audio, args=(CONFIG['audio_files']['no_card'],))
    audio_thread.daemon = True
    audio_thread.start()
    
    # GUNAKAN FULLSCREEN
    create_fullscreen_window("Sistem Presensi")
    video_playing = True
    rfid_detected = False
    rfid_data = None
    
    rfid_thread = threading.Thread(target=rfid_listener)
    rfid_thread.daemon = True
    rfid_thread.start()
    
    while video_playing and not rfid_detected and system_active:
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        
        cv2.putText(frame, "SISTEM PRESENSI", (120, 100), 
                   cv2.FONT_HERSHEY_SIMPLEX, 1.5, (255, 255, 255), 3)
        cv2.putText(frame, "Tempelkan Kartu RFID Anda", (150, 250), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        cv2.putText(frame, "Status: Menunggu Kartu RFID...", (180, 350), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
        
        cv2.imshow("Sistem Presensi", frame)
        
        key = cv2.waitKey(100) & 0xFF
        if key == ord('q') or key == 27:  # 27 = ESC key
            video_playing = False
            stop_audio()
            break
        
        if rfid_detected:
            video_playing = False
            stop_audio()
            break
    
    if rfid_thread.is_alive():
        rfid_thread.join(timeout=1.0)
    return rfid_data

def show_happy_static_screen():
    """Fallback static screen untuk keberhasilan - FULLSCREEN"""
    create_fullscreen_window("Selamat - Atribut Lengkap")
    
    audio_thread = threading.Thread(target=play_audio, args=(CONFIG['audio_files']['all_attributes'],))
    audio_thread.daemon = True
    audio_thread.start()
    
    start_time = time.time()
    max_play_time = 5
    
    while time.time() - start_time < max_play_time and system_active:
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        
        cv2.putText(frame, "SELAMAT!", (220, 150), 
                   cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 255, 0), 3)
        cv2.putText(frame, "Semua atribut lengkap", (160, 200), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        
        remaining = int(max_play_time - (time.time() - start_time))
        cv2.putText(frame, f"Kembali dalam: {remaining} detik", (200, 350), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2)
        
        cv2.imshow("Selamat - Atribut Lengkap", frame)
        
        if cv2.waitKey(100) & 0xFF in [ord('q'), 27]:  # 27 = ESC key
            stop_audio()
            break
    
    cv2.destroyWindow("Selamat - Atribut Lengkap")
    stop_audio()

def show_ledek_static_screen():
    """Fallback static screen untuk ledek - FULLSCREEN"""
    create_fullscreen_window("Atribut Tidak Lengkap")
    
    audio_thread = threading.Thread(target=play_audio, args=(CONFIG['audio_files']['violation'],))
    audio_thread.daemon = True
    audio_thread.start()
    
    start_time = time.time()
    max_play_time = 5
    
    while time.time() - start_time < max_play_time and system_active:
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        
        cv2.putText(frame, "ATRIBUT TIDAK LENGKAP", (120, 150), 
                   cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 3)
        cv2.putText(frame, "Lengkapi semua atribut", (180, 200), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        
        remaining = int(max_play_time - (time.time() - start_time))
        cv2.putText(frame, f"Kembali dalam: {remaining} detik", (200, 350), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2)
        
        cv2.imshow("Atribut Tidak Lengkap", frame)
        
        if cv2.waitKey(100) & 0xFF in [ord('q'), 27]:  # 27 = ESC key
            stop_audio()
            break
    
    cv2.destroyWindow("Atribut Tidak Lengkap")
    stop_audio()

# =============================
# FUNGSI RFID
# =============================

def rfid_listener():
    """Thread untuk mendengarkan RFID di background"""
    global rfid_detected, rfid_data, video_playing, system_active
    
    print("🎧 RFID listener started...")
    
    while video_playing and not rfid_detected and system_active:
        try:
            id, text = reader.read()
            if id:
                card_id = str(id)
                print(f"✅ RFID Card detected: {card_id}")
                rfid_detected = True
                rfid_data = (id, text)
                video_playing = False
                break
        except Exception as e:
            time.sleep(0.5)
            continue

# =============================
# FUNGSI SERVO & CAMERA
# =============================

def setup_servo():
    """Setup servo motor"""
    try:
        GPIO.setmode(GPIO.BCM)
        GPIO.setup(CONFIG['servo_pin'], GPIO.OUT)
        
        pwm = GPIO.PWM(CONFIG['servo_pin'], 50)
        pwm.start(0)
        print("✅ Servo motor initialized")
        return pwm
    except Exception as e:
        print(f"❌ Error setting up servo: {e}")
        return None

def set_servo_angle(pwm, angle):
    """Set servo angle"""
    try:
        angle = max(20, min(80, angle))
        duty = angle / 18 + 2
        pwm.ChangeDutyCycle(duty)
        time.sleep(0.5)
        pwm.ChangeDutyCycle(0)
        print(f"📐 Servo moved to {angle}°")
    except Exception as e:
        print(f"❌ Error moving servo: {e}")

def auto_adjust_camera():
    """Auto-adjust camera height"""
    print("🤖 Starting auto-adjust camera...")
    
    servo_pwm = setup_servo()
    if servo_pwm is None:
        print("❌ Servo not available, skipping adjustment")
        return
    
    try:
        set_servo_angle(servo_pwm, CONFIG['default_angle'])
        time.sleep(1)
        print("✅ Camera adjustment completed")
        
    except Exception as e:
        print(f"❌ Error in auto-adjust: {e}")
    finally:
        set_servo_angle(servo_pwm, CONFIG['default_angle'])
        servo_pwm.stop()

def initialize_camera_direct():
    """Inisialisasi kamera"""
    print("🎥 Initializing camera...")
    
    try:
        cam = cv2.VideoCapture(0)
        
        if not cam.isOpened():
            print("❌ Cannot open camera with index 0")
            return None
        
        cam.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cam.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        cam.set(cv2.CAP_PROP_FPS, 25)
        
        time.sleep(2)
        
        success_count = 0
        for i in range(3):
            ret, frame = cam.read()
            if ret and frame is not None:
                success_count += 1
        
        if success_count >= 2:
            print("✅ Camera initialized successfully!")
            return cam
        else:
            cam.release()
            print("❌ Camera test failed")
            return None
            
    except Exception as e:
        print(f"❌ Error initializing camera: {e}")
        return None

# =============================
# FUNGSI MODEL YOLO
# =============================

def load_yolov11_model():
    """Load model YOLOv11"""
    global model
    try:
        model = YOLO(CONFIG['model_path'])
        print(f"✅ Model YOLO loaded: {CONFIG['model_path']}")
        
        print(f"📦 Model classes: {model.names}")
        
        available_classes = list(model.names.values())
        print(f"🎯 Required objects: {CONFIG['required_objects']}")
        
        for req_obj in CONFIG['required_objects']:
            if req_obj not in available_classes:
                print(f"⚠️  Warning: '{req_obj}' not found in model classes")
        
        return model
    except Exception as e:
        print(f"❌ Error loading YOLO model: {e}")
        return None

# =============================
# FUNGSI DETECTION SEDERHANA - 6 DETIK
# =============================

def simple_6s_detection():
    """Deteksi sederhana selama 6 detik - FULLSCREEN"""
    global detection_manager
    
    print("🔍 SIMPLE 6 SECOND DETECTION STARTED")
    print("⏱️  Proses deteksi: 6 detik")
    
    # Reset detection manager
    detection_manager.reset()
    
    # Auto-adjust camera
    auto_adjust_camera()
    
    start_time = time.time()
    frame_count = 0
    
    # GUNAKAN FULLSCREEN
    create_fullscreen_window("Deteksi Atribut - 6 Detik")
    
    print("📊 Memulai proses deteksi...")
    
    while time.time() - start_time < CONFIG['detection_duration'] and system_active:
        
        ret, frame = safe_camera_read()
        if not ret:
            continue
            
        frame_count += 1
        current_time = time.time() - start_time
        remaining_time = CONFIG['detection_duration'] - current_time
        
        # Lakukan deteksi
        current_detections = []
        display_frame = frame.copy()
        
        try:
            results = model(frame, 
                          conf=CONFIG['confidence_threshold'],
                          verbose=False,
                          imgsz=640)
            
            if results and len(results) > 0:
                boxes = results[0].boxes
                
                if boxes is not None:
                    for box in boxes:
                        confidence = box.conf.item()
                        class_id = int(box.cls.item())
                        class_name = model.names[class_id]
                        
                        if class_name in CONFIG['required_objects']:
                            x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int)
                            
                            current_detections.append({
                                'class_name': class_name,
                                'confidence': confidence
                            })
                            
                            # Draw bounding box
                            colors = {'NAME TAG': (0, 255, 0), 'PIN CITA CITA': (255, 255, 0), 'ID CARD': (0, 255, 255)}
                            color = colors.get(class_name, (255, 0, 0))
                            cv2.rectangle(display_frame, (x1, y1), (x2, y2), color, 2)
                            cv2.putText(display_frame, f"{class_name} {confidence:.2f}", 
                                       (x1, y1-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
            
            # Update detections
            detection_manager.update_detections(current_detections)
            
            # Display informasi sederhana
            cv2.putText(display_frame, f"Waktu: {current_time:.1f}s / {CONFIG['detection_duration']}s", 
                       (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
            
            # Tampilkan status objek
            y_pos = 60
            for obj_name in CONFIG['required_objects']:
                if obj_name in detection_manager.detected_objects:
                    status = "✅ TERDETEKSI"
                    color = (0, 255, 0)
                else:
                    status = "❌ BELUM"
                    color = (0, 0, 255)
                
                cv2.putText(display_frame, f"{obj_name}: {status}", 
                           (20, y_pos), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
                y_pos += 25
            
            # Progress bar
            progress = min(100, (current_time / CONFIG['detection_duration']) * 100)
            cv2.rectangle(display_frame, (10, 450), (630, 470), (100, 100, 100), -1)
            cv2.rectangle(display_frame, (10, 450), (10 + int(6.2 * progress), 470), (0, 165, 255), -1)
            
            cv2.imshow("Deteksi Atribut - 6 Detik", display_frame)
                
        except Exception as e:
            print(f"⚠️ Detection error: {e}")
            continue
        
        key = cv2.waitKey(1) & 0xFF
        if key == ord('q') or key == 27:  # 27 = ESC key
            break
    
    try:
        cv2.destroyWindow("Deteksi Atribut - 6 Detik")
    except:
        pass
    
    # Hasil akhir
    detection_results = detection_manager.get_results()
    
    print(f"\n📊 DETECTION COMPLETED")
    print(f"📈 Frames processed: {frame_count}")
    print(f"✅ Objek terdeteksi: {detection_results['detected_objects']}")
    print(f"❌ Objek tidak terdeteksi: {detection_results['missing_objects']}")
    print(f"🎯 Status: {'BERHASIL' if detection_results['success'] else 'GAGAL'}")
    
    return detection_results

# =============================
# FUNGSI TAMPILAN SEDERHANA
# =============================

def show_card_detected_screen(card_data):
    """Menampilkan layar kartu terdeteksi - FULLSCREEN"""
    create_fullscreen_window("Sistem Presensi")
    
    card_frame = np.zeros((480, 640, 3), dtype=np.uint8)
    
    cv2.putText(card_frame, "KARTU TERDETEKSI", (180, 80), 
               cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 3)
    cv2.putText(card_frame, f"Nama: {card_data['nama']}", (50, 150), 
               cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
    cv2.putText(card_frame, f"Jurusan: {card_data['jurusan']}", (50, 190), 
               cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
    cv2.putText(card_frame, "Memulai deteksi atribut...", (50, 280), 
               cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2)
    
    cv2.imshow("Sistem Presensi", card_frame)
    cv2.waitKey(1000)
    
    return True

def show_final_result_screen(card_data, detection_results):
    """Menampilkan hasil akhir - FULLSCREEN"""
    create_fullscreen_window("Sistem Presensi")
    
    result_frame = np.zeros((480, 640, 3), dtype=np.uint8)
    
    if detection_results['success']:
        title = "BERHASIL!"
        color = (0, 255, 0)
        status_text = "Semua atribut lengkap"
    else:
        title = "GAGAL!"
        color = (0, 0, 255)
        status_text = "Atribut tidak lengkap"
    
    cv2.putText(result_frame, title, (250, 80), 
               cv2.FONT_HERSHEY_SIMPLEX, 1.2, color, 3)
    cv2.putText(result_frame, status_text, (200, 120), 
               cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
    
    cv2.putText(result_frame, f"Nama: {card_data['nama']}", (50, 180), 
               cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
    
    y_pos = 220
    for obj in CONFIG['required_objects']:
        if obj in detection_results['detected_objects']:
            status = "✅"
            text_color = (0, 255, 0)
        else:
            status = "❌"
            text_color = (0, 0, 255)
        
        cv2.putText(result_frame, f"{status} {obj}", (70, y_pos), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, text_color, 1)
        y_pos += 30
    
    cv2.putText(result_frame, f"Hasil: {detection_results['detected_count']}/3 atribut", (50, 350), 
               cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)
    cv2.putText(result_frame, "Kembali ke mode tunggu...", (200, 430), 
               cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
    
    cv2.imshow("Sistem Presensi", result_frame)
    cv2.waitKey(2000)
    
    return True

def save_attendance_data(card_data, detection_results):
    """Menyimpan data presensi"""
    try:
        attendance_data = {
            "card_id": card_data['card_id'],
            "nama": card_data['nama'],
            "jurusan": card_data['jurusan'],
            "angkatan": card_data['angkatan'],
            "waktu_presensi": card_data['time'],
            "status": "BERHASIL" if detection_results['success'] else "GAGAL",
            "atribut_terdeteksi": detection_results['detected_objects'],
            "atribut_tidak_terdeteksi": detection_results['missing_objects'],
            "confidence_scores": detection_results['confidence_scores'],
            "timestamp": datetime.now().isoformat(),
            "tanggal": date.today().isoformat()
        }
        
        if save_presensi_data(attendance_data):
            print(f"📝 Data presensi disimpan: {card_data['nama']}")
            return True
        else:
            print("❌ Gagal menyimpan data presensi")
            return False
            
    except Exception as e:
        print(f"❌ Error saving attendance data: {e}")
        return False

# =============================
# FUNGSI UTAMA - DITAMBAH CEK TAP SEHARI SEKALI
# =============================

def main():
    global camera, model, current_card_data, system_active
    
    print("🔄 Loading YOLO model...")
    model = load_yolov11_model()
    if model is None:
        print("❌ Gagal load model YOLO. Program dihentikan.")
        return
    
    print("\n🎥 Initializing camera...")
    camera = initialize_camera_direct()
    
    if camera is None:
        print("❌ Gagal initialize camera. Program dihentikan.")
        return
    
    print("✅ Camera initialized successfully!")
    
    session_count = 0
    
    try:
        while system_active:
            session_count += 1
            print("\n" + "="*50)
            print(f"🔄 SESSION #{session_count}")
            print("🎯 Target: NAME TAG, PIN CITA CITA, ID CARD")
            print("⏱️  Proses: 6 detik deteksi")
            print("="*50)
            
            # STEP 1: Menunggu RFID
            print("\n1️⃣ MENUNGGU KARTU RFID...")
            rfid_result = play_video_with_rfid_waiting()
            
            if rfid_result is None:
                print("❌ Tidak ada data RFID")
                continue
                
            id, text = rfid_result
            
            # STEP 2: Process RFID data dan CEK SUDAH TAP HARI INI
            print("\n2️⃣ MEMBACA DATA KARTU DAN CEK PRESENSI...")
            
            data = text.strip().split(',')
            if len(data) == 3:
                nama, jurusan, angkatan = data
                current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                card_id = str(id)
                
                # CEK APAKAH SUDAH TAP HARI INI
                already_tapped, previous_record = check_already_tapped_today(card_id)
                if already_tapped:
                    print(f"⚠️ Kartu sudah digunakan hari ini oleh: {nama}")
                    print(f"📅 Terakhir tap: {previous_record.get('waktu_presensi', 'Unknown')}")
                    
                    # Tampilkan pesan sudah tap
                    play_already_tapped_video()
                    continue  # Langsung kembali ke mode tunggu
                
                current_card_data = {
                    'card_id': card_id,
                    'nama': nama,
                    'jurusan': jurusan,
                    'angkatan': angkatan,
                    'time': current_time
                }
                
                print(f"📋 Kartu: {nama}, {jurusan}, {angkatan}")
                print("✅ Kartu belum digunakan hari ini, lanjut deteksi...")
                
                show_card_detected_screen(current_card_data)
                
                # STEP 3: Deteksi 6 detik
                print("\n3️⃣ DETEKSI ATRIBUT (6 DETIK)...")
                detection_results = simple_6s_detection()
                
                # STEP 4: Hasil dan simpan
                print("\n4️⃣ HASIL DAN SIMPAN DATA...")
                
                save_attendance_data(current_card_data, detection_results)
                
                if detection_results['success']:
                    print("🎉 BERHASIL: Semua atribut lengkap!")
                    play_happy_video()
                else:
                    print("❌ GAGAL: Atribut tidak lengkap!")
                    play_ledek_video()
                
                show_final_result_screen(current_card_data, detection_results)
                print("🔄 Kembali ke mode tunggu...")
                
            else:
                print(f"❌ Data kartu tidak lengkap: {text}")

    except KeyboardInterrupt:
        print("\n=== PROGRAM DIHENTIKAN ===")

    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        print("🔄 Restarting system...")
        time.sleep(3)
        main()

def cleanup():
    """Cleanup resources"""
    global video_playing, system_active
    system_active = False
    video_playing = False
    stop_audio()
    if camera:
        camera.release()
    cv2.destroyAllWindows()
    try:
        GPIO.cleanup()
    except:
        pass
    pygame.mixer.quit()
    print("✅ Resources cleaned up")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"💥 Critical error: {e}")
    finally:
        cleanup()