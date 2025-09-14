# Proyek LATTE - Dasbor Monitoring IoT Turbin Angin

Ini adalah proyek aplikasi web untuk monitoring sistem energi hibrida (turbin angin & PLN) secara real-time.

---

## 💻 Link Aplikasi & Akses asesor

Untuk mencoba aplikasi, silakan kunjungi link di bawah ini dan gunakan akun yang telah disediakan.

* **URL Aplikasi:** [https://latte-iot-dashboard.onrender.com](https://latte-iot-dashboard.onrender.com)
* ---
* **AKUN UNTUK asesor:**
    * **Username:** `asesor`
    * **Password:** `latteno1`
* ---
* **Kode Registrasi Produk (jika asesor ingin mencoba membuat akun sendiri):** `LATTEJUARASFT`

---

## ✨ Fitur Utama

* **Login & Registrasi Pengguna:** Sistem autentikasi aman menggunakan JWT.
* **Dasbor Real-time:** Menampilkan data sensor terkini dari turbin dan PLN yang dikirim melalui protokol MQTT.
* **Analisis Historis:** Menyajikan data historis dalam bentuk grafik dan tabel dengan filter rentang waktu (hari ini, semua waktu, kustom).
* **Visualisasi Data:** Grafik interaktif untuk memantau tren daya, tegangan, kecepatan angin, dll.
* **Sistem Notifikasi:** Peringatan akan muncul jika ada anomali data (contoh: temperatur baterai terlalu tinggi).
* **Unduh Laporan PDF:** Pengguna dapat mengunduh ringkasan data historis dalam format PDF.

---

## 🛠️ Teknologi yang Digunakan

* **Backend:** Node.js, Express.js, MongoDB, Mongoose, MQTT, Socket.IO
* **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6+), Chart.js
* **Deployment:** Render
* **Simulator:** Python

---

## 🚀 Cara Mengaktifkan Data Real-time (Opsional)

Aplikasi ini menerima data dari sebuah simulator. Jika asesor ingin melihat data bergerak secara live, server di Render harus menerima data dari simulator tersebut.

Caranya adalah dengan menjalankan file `simulator.py` yang ada di dalam repositori ini.

```bash
# Diperlukan Python 3
pip install paho-mqtt
py simulator.py
