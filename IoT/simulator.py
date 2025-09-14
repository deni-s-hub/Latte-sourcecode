# simulator.py (Versi Final Tanpa RPM)
import paho.mqtt.client as mqtt
import time
import random
from datetime import datetime

# Konfigurasi MQTT
broker_address = "broker.hivemq.com"
topic = "sensor/panel/utama"

# Inisialisasi MQTT Client
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, "PythonSimulatorNoRPM")
client.connect(broker_address)

# --- STATE AWAL SENSOR ---
voltage_ac = 220.0
voltage_dc = 13.5
current_dc = 5.0
current_ac = 1.5
wind_speed = 5.0
temperature = 30.0
humidity = 70.0

print("🚀 Simulasi Realistis (Format CSV Tanpa RPM) dimulai...")
try:
    while True:
        jam_sekarang = datetime.now().hour

        # Logika untuk pola angin harian
        if 5 <= jam_sekarang < 12:
            target_wind_speed = random.uniform(3.0, 8.0)
        elif 12 <= jam_sekarang < 18:
            target_wind_speed = random.uniform(10.0, 25.0)
        else:
            target_wind_speed = random.uniform(6.0, 15.0)

        wind_speed += (target_wind_speed - wind_speed) * 0.1

        # Simulasi perubahan kecil
        voltage_ac = 220.0 + random.uniform(-1.5, 1.5)
        # Tegangan & Arus DC sekarang hanya dipengaruhi sedikit oleh kecepatan angin
        voltage_dc = 12.0 + (wind_speed / 10) 
        current_dc = 1.0 + (wind_speed / 5)
        current_ac = 1.5 + random.uniform(-0.2, 0.2)
        temperature += random.uniform(-0.2, 0.2)

        if random.random() < 0.05:
            temperature = round(random.uniform(50.1, 60.0), 1)

        # Batas aman data
        if not 210.0 < voltage_ac < 240.0: voltage_ac = 225.0
        if not 12.0 < voltage_dc < 14.8: voltage_dc = 13.5
        if not 0.0 < current_dc < 15.0: current_dc = 5.0
        if not 0.5 < current_ac < 4.0: current_ac = 1.5
        if not 0.0 < wind_speed < 40.0: wind_speed = 10.0
        if not 25 < temperature < 48.0 and temperature < 50: temperature = 30.0
        if not 50 < humidity < 95: humidity = 75.0

        # Susun data CSV 
        data_csv = (
            f"{voltage_ac:.2f},{voltage_dc:.2f},{current_dc:.2f},{current_ac:.2f},"
            f"{wind_speed:.2f},{temperature:.1f},{70.0:.1f}" # Hanya 7 nilai
        )

        client.publish(topic, data_csv)

        if temperature > 50:
            print(f"🔥 Data Terkirim (SUHU TINGGI): {data_csv}")
        else:
            print(f"✔️  Data Terkirim: {data_csv}")

        time.sleep(5)

except KeyboardInterrupt:
    print("\n⏹️  Simulasi dihentikan.")
    client.disconnect()