#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <SoftwareSerial.h>

// ================== PENGATURAN PENGGUNA ==================
const char* ssid = "vivo1811";
const char* password = "ljmkipoo";
const char* mqtt_server = "mqtt-dashboard.com";
const int mqtt_port = 1883;
const char* mqtt_topic = "sensor/panel/utama";

// ================== PENGATURAN PIN ==================
// Menggunakan nomor GPIO langsung, kompatibel dengan Generic ESP8266 Module
SoftwareSerial arduinoSerial(14, 12); // RX = GPIO14, TX = GPIO12

// ================== Inisialisasi Objek ==================
WiFiClient espClient;
PubSubClient client(espClient);
String dataFromArduino = "";

// ================== FUNGSI SETUP ==================
void setup() {
  Serial.begin(115200); 
  arduinoSerial.begin(9600); 
  setup_wifi();
  client.setServer(mqtt_server, mqtt_port);
  Serial.println("Setup selesai. ESP siap menerima data.");
}

// ================== FUNGSI KONEKSI WIFI ==================
void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("Menghubungkan ke Wi-Fi: ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWi-Fi terhubung!");
  Serial.print("Alamat IP: ");
  Serial.println(WiFi.localIP());
}

// ================== FUNGSI KONEKSI ULANG MQTT ==================
void reconnect() {
  while (!client.connected()) {
    Serial.print("Mencoba koneksi MQTT...");
    String clientId = "ESP8266Client-";
    clientId += String(random(0xffff), HEX);
    if (client.connect(clientId.c_str())) {
      Serial.println("terhubung!");
    } else {
      Serial.print("gagal, rc=");
      Serial.print(client.state());
      Serial.println(" | Coba lagi dalam 5 detik");
      delay(5000);
    }
  }
}

// ================== LOOP UTAMA ==================
void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  while (arduinoSerial.available() > 0) {
    char receivedChar = arduinoSerial.read();
    if (receivedChar == '\n') {
      dataFromArduino.trim(); 
      if (dataFromArduino.length() > 0) {
        Serial.print("Data diterima: ");
        Serial.println(dataFromArduino);
        client.publish(mqtt_topic, dataFromArduino.c_str());
        Serial.println("-> Data dipublikasikan ke MQTT.");
      }
      dataFromArduino = "";
    } else {
      dataFromArduino += receivedChar;
    }
  }
}