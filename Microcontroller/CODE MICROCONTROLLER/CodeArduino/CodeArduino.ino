#include <Arduino.h>
#include <ZMPT101B.h>
#include <DHT.h>

// ================== Definisi Pin ==================
#define AC_PIN      A0  // ZMPT101B (tegangan AC)
#define DC_PIN      A1  // Voltage divider (tegangan DC)
#define ACS_PIN     A2  // ACS712 DC 20A
#define ACSAC_PIN   A3  // ACS712 AC 20A
#define WIND_PIN    3   // Sensor Angin di pin 3
#define DHTPIN      4   // DHT22 pin data
#define RELAY_PIN   8   // Relay di pin 8

// ================== Objek Library ==================
ZMPT101B voltageSensor(AC_PIN, 50.0);
DHT dht(DHTPIN, DHT22);

// ================== Kalibrasi Tegangan AC ==================
float zeroOffsetAC  = 2.84;
float scaleFactorAC = 1.064;

// ================== Kalibrasi Tegangan DC ==================
#define VREF      5.0
#define ADC_RES   1023.0
float R1 = 30000.0;
float R2 = 7500.0;
const float dcCorrectionFactor = 0.9833;

// ================== Kalibrasi Arus ==================
// DC 20A
// !! PENTING: Lakukan tes tanpa beban, lihat pembacaan arus, lalu masukkan nilainya di sini !!
const float DC_ZERO_POINT_OFFSET = 0.0; // <-- UBAH NILAI INI SESUAI HASIL TES TANPA BEBAN
const float sensitivityDC = 0.100;      // Sesuaikan jika modul Anda bukan 20A (0.185 untuk 5A, 0.066 untuk 30A)
float VoffsetACS_init     = 2.50;
static float Voffset_dyn  = 2.50;

// AC 20A
const float sensitivityAC = 0.100;
float VoffsetAC_current = 2.50;
const int sampleAC = 500;
const float deadZoneAC = 0.1;

// ================== Anemometer ==================
float windFactor = 2.423; // Nilai sudah dikalibrasi
volatile unsigned long pulseCount = 0;
unsigned long lastMeasure = 0;
float windSpeed = 0.0;

// ================== Fungsi Moving Average ==================
// Fungsi untuk menghaluskan data angin
float smoothWind(float newVal) {
  const int N = 10;
  static float buffer[N];
  static int idx = 0;
  static bool filled = false;
  buffer[idx] = newVal;
  idx = (idx + 1) % N;
  if (idx == 0) filled = true;
  float sum = 0;
  int count = filled ? N : idx;
  for (int i = 0; i < count; i++) sum += buffer[i];
  return sum / count;
}

// Fungsi untuk menghaluskan data arus DC
float smoothCurrent(float newVal) {
  const int N = 10;
  static float buffer[N];
  static int idx = 0;
  static bool filled = false;
  buffer[idx] = newVal;
  idx = (idx + 1) % N;
  if (idx == 0) filled = true;
  float sum = 0;
  int count = filled ? N : idx;
  for (int i = 0; i < count; i++) sum += buffer[i];
  return sum / count;
}

// ================== Interrupt Service Routines ==================
void countPulse() {
  pulseCount++;
}

// ================== Setup ==================
void setup() {
  Serial.begin(9600);
  voltageSensor.setSensitivity(500.0f);
  dht.begin();

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);

  // Auto kalibrasi offset ACS712
  // PENTING: Pastikan tidak ada arus yang mengalir saat startup
  Serial.println("Melakukan kalibrasi sensor arus, jangan alirkan arus...");
  long sumDC = 0;
  long sumAC = 0;
  const int N = 1200;
  for (int i = 0; i < N; i++) {
    sumDC += analogRead(ACS_PIN);
    sumAC += analogRead(ACSAC_PIN);
    delay(1);
  }
  VoffsetACS_init = (sumDC / (float)N) * (VREF / ADC_RES);
  Voffset_dyn = VoffsetACS_init;
  VoffsetAC_current = (sumAC / (float)N) * (VREF / ADC_RES);
  Serial.print("Kalibrasi offset DC selesai. Voffset: ");
  Serial.println(Voffset_dyn, 3);

  // Setup Anemometer
  pinMode(WIND_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(WIND_PIN), countPulse, FALLING);

  Serial.println("Sistem monitoring dimulai...");
}

// ================== Fungsi Baca Arus DC ==================
float readDCCurrent() {
  const int N_avg = 180;
  double sumV = 0.0;
  for (int i = 0; i < N_avg; i++) {
    sumV += analogRead(ACS_PIN);
  }
  float Vavg = (sumV / N_avg) * (VREF / ADC_RES);

  float I = (Vavg - Voffset_dyn) / sensitivityDC;

  if (fabs(I) < 0.30) {
    Voffset_dyn += 0.05 * (Vavg - Voffset_dyn);
  }

  if (fabs(I) < 0.05) {
    I = 0.0;
  }
  
  return fabs(I);
}

// ================== Fungsi Baca Arus AC ==================
float readACCurrent() {
  long sumSq = 0;
  int adc_offset_int = VoffsetAC_current * (ADC_RES / VREF);
  for (int i = 0; i < sampleAC; i++) {
    int raw = analogRead(ACSAC_PIN) - adc_offset_int;
    sumSq += (long)raw * raw;
  }
  float Vrms_adc = sqrt((float)sumSq / sampleAC);
  float Vrms_volt = Vrms_adc * (VREF / ADC_RES);
  return Vrms_volt / sensitivityAC;
}

// ================== Fungsi Hitung Kecepatan Angin ==================
void calculatePulseSensors() {
  if (millis() - lastMeasure >= 1000) {
    noInterrupts();
    unsigned long currentPulseCount = pulseCount;
    pulseCount = 0;
    interrupts();

    float rawWindSpeed = (float)currentPulseCount * windFactor;
    windSpeed = smoothWind(rawWindSpeed);

    if (windSpeed < 1.5) {
      windSpeed = 0.0;
    }
    lastMeasure = millis();
  }
}

// ================== Loop Utama ==================
void loop() {
  calculatePulseSensors();

  // 1. Pembacaan Tegangan AC
  float vRawAC   = voltageSensor.getRmsVoltage();
  float vFinalAC = (vRawAC - zeroOffsetAC) * scaleFactorAC;
  if (vFinalAC < 2.0) vFinalAC = 0;

  // 2. Pembacaan Tegangan DC
  int rawDC = analogRead(DC_PIN);
  float vADC = (rawDC / ADC_RES) * VREF;
  float vFinalDC_raw = vADC * (R1 + R2) / R2;
  float vFinalDC = vFinalDC_raw * dcCorrectionFactor;
  if (vFinalDC < 0.3) vFinalDC = 0;

  // 3. Logika Kontrol Relay Proteksi
  if (vFinalDC > 13.5 || windSpeed > 13.0) {
    digitalWrite(RELAY_PIN, HIGH);
  } else {
    digitalWrite(RELAY_PIN, LOW);
  }

  // 4. Pembacaan Arus DC & AC
  float iDC_raw = readDCCurrent();
  float iDC_smoothed = smoothCurrent(iDC_raw);
  
  // ## PERBAIKAN KALIBRASI DI SINI ##
  float iDC = iDC_smoothed - DC_ZERO_POINT_OFFSET; // Terapkan koreksi offset
  if (iDC < 0.1) iDC = 0.0; // Jika hasil negatif atau sangat kecil, jadikan nol

  float iAC = readACCurrent();
  if (iAC < deadZoneAC) iAC = 0.0;

  // 5. Pembacaan Suhu & Kelembaban (DHT22)
  float suhu = dht.readTemperature();
  float hum  = dht.readHumidity();

  // 6. Tampilkan semua data ke Serial Monitor
  Serial.print("AC: "); Serial.print(vFinalAC, 2); Serial.print(" V | ");
  Serial.print("DC: "); Serial.print(vFinalDC, 2); Serial.print(" V | ");
  Serial.print("IDC: "); Serial.print(iDC, 2); Serial.print(" A | ");
  Serial.print("IAC: "); Serial.print(iAC, 2); Serial.print(" A | ");
  Serial.print("Wind: "); Serial.print(windSpeed, 2); Serial.print(" m/s | ");
  Serial.print("Suhu: "); Serial.print(suhu, 1); Serial.print(" C | ");
  Serial.print("Hum: "); Serial.print(hum, 1); Serial.println(" %");
  
  delay(1200);
}