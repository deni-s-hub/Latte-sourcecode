// File: server.js (Versi Lengkap, Final, Menerima Format JSON)
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const mqtt = require('mqtt');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const PDFDocument = require('pdfkit');
const fs = require('fs');

const { createServer } = require('http');
const { Server } = require("socket.io");

// --- Variabel State Baterai ---
const TOTAL_BATTERY_WH = 12 * 20; // 240 Watt-hour
let currentBatteryWh = TOTAL_BATTERY_WH * 0.5;

// --- Konfigurasi dari .env ---
const mongoURI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const REGISTRATION_CODE = process.env.REGISTRATION_CODE;

// Koneksi ke MongoDB
mongoose.connect(mongoURI)
  .then(() => console.log('✅ Berhasil terhubung ke MongoDB Atlas'))
  .catch(err => console.error('❌ Gagal terhubung ke MongoDB:', err));

// --- Skema Data Sensor ---
const SensorDataSchema = new mongoose.Schema({
  voltageAC: Number,
  voltageDC: Number,
  currentDC: Number,
  currentAC: Number,
  windSpeed: Number,
  batteryTemperature: Number,
  humidity: Number,
  windTurbineStatus: String,
  plnWattage: Number,
  turbineWattage: Number,
  batteryCapacity: Number,
  timestamp: { type: Date, default: Date.now }
});
const SensorData = mongoose.model('SensorData', SensorDataSchema);

// --- Skema User & Notifikasi ---
const UserSchema = new mongoose.Schema({ username: { type: String, required: true, unique: true }, password: { type: String, required: true } });
const User = mongoose.model('User', UserSchema);
const NotificationSchema = new mongoose.Schema({ type: String, message: String, advice: String, value: Number, isRead: { type: Boolean, default: false }, timestamp: { type: Date, default: Date.now } });
const Notification = mongoose.model('Notification', NotificationSchema);

// --- Konfigurasi API & Socket.IO ---
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});
app.use(cors());
app.use(express.json());

// --- Konfigurasi MQTT ---
const mqttBroker = 'mqtt://broker.hivemq.com';
const mqttTopic = 'sensor/panel/utama';
const client = mqtt.connect(mqttBroker);

client.on('connect', () => {
    console.log('✅ Berhasil terhubung ke MQTT Broker');
    client.subscribe(mqttTopic);
});

client.on('message', async (topic, message) => {
  try {
    
    // --- PERUBAHAN UTAMA: Parsing data JSON dari Mikrokontroler ---
    const dataString = message.toString();
    const jsonData = JSON.parse(dataString);

    // Mapping dari key JSON ke nama variabel di dalam sistem kita
    const rawData = {
      voltageAC: jsonData.tegangan_ac,
      voltageDC: jsonData.tegangan_dc,
      currentDC: jsonData.arus_dc,
      currentAC: jsonData.arus_ac,
      windSpeed: jsonData.angin,
      batteryTemperature: jsonData.suhu,
      humidity: jsonData.kelembaban
    };
    // --- AKHIR PERUBAHAN UTAMA ---
    
    for (const key in rawData) { if (isNaN(rawData[key])) { console.error(`Data tidak valid (NaN) untuk ${key}`); return; } }

    // --- LOGIKA PERHITUNGAN BATERAI (tetap sama) ---
    const turbinePower = rawData.voltageDC * rawData.currentDC;
    const intervalSeconds = 5;
    const energyChangeWh = (turbinePower * intervalSeconds) / 3600;
    currentBatteryWh += energyChangeWh;

    if (currentBatteryWh > TOTAL_BATTERY_WH) currentBatteryWh = TOTAL_BATTERY_WH;
    if (currentBatteryWh < 0) currentBatteryWh = 0;

    const batterySoc = (currentBatteryWh / TOTAL_BATTERY_WH) * 100;
    // --- AKHIR LOGIKA BATERAI ---

    const fullData = {
      ...rawData,
      windTurbineStatus: rawData.currentDC > 0.1 ? "ON" : "OFF",
      plnWattage: rawData.voltageAC * rawData.currentAC,
      turbineWattage: turbinePower,
      batteryCapacity: batterySoc
    };
    
    const newData = new SensorData(fullData);
    await newData.save();
    console.log(`💾 Data JSON disimpan. SOC Baterai: ${batterySoc.toFixed(2)}%`);

    io.emit('newData', fullData);
    
    const SUHU_BATAS_ATAS = 50.0;
    if (fullData.batteryTemperature >= SUHU_BATAS_ATAS) {
      const newNotif = new Notification({
        type: 'OVERHEAT',
        message: `Temperatur baterai ${fullData.batteryTemperature}°C!`,
        advice: 'Segera periksa sistem pendingin.',
        value: fullData.batteryTemperature
      });
      await newNotif.save();
      io.emit('newNotification', newNotif);
    }

  } catch (error) { console.error('Gagal memproses pesan JSON:', error); }
});

// --- Middleware Autentikasi ---
const protect = (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    } else if (req.query.token) {
        token = req.query.token;
    }
    if (!token) return res.status(401).json({ message: 'Akses ditolak, token tidak ada.' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({ message: 'Token tidak valid.' });
    }
};

// --- Rute Login & Register ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, registrationCode } = req.body;
    if (registrationCode !== REGISTRATION_CODE) return res.status(401).json({ message: 'Kode registrasi tidak valid.' });
    if (await User.findOne({ username })) return res.status(400).json({ message: 'Username sudah digunakan.' });
    const hashedPassword = await bcrypt.hash(password, 10);
    await new User({ username, password: hashedPassword }).save();
    res.status(201).json({ message: 'Registrasi berhasil!' });
  } catch(e) {
    res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ message: 'Username atau password salah.' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Username atau password salah.' });
    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '1d' });
    res.json({ message: 'Login berhasil!', token });
  } catch(e) {
    res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
  }
});

// --- Rute Data ---
app.get('/data', protect, async (req, res) => {
    try {
        const latestData = await SensorData.findOne().sort({ timestamp: -1 });
        const energyTotals = await SensorData.aggregate([
            { $group: { _id: null, totalPlnWattageSum: { $sum: '$plnWattage' }, totalTurbineWattageSum: { $sum: '$turbineWattage' } } }
        ]);
        const intervalHours = 5 / 3600;
        let totalPlnKwh = 0;
        let totalTurbineKwh = 0;
        if (energyTotals.length > 0) {
            const totals = energyTotals[0];
            totalPlnKwh = ((totals.totalPlnWattageSum || 0) / 1000) * intervalHours;
            totalTurbineKwh = ((totals.totalTurbineWattageSum || 0) / 1000) * intervalHours;
        }
        res.json({ ...(latestData ? latestData.toObject() : {}), totalPlnKwh, totalTurbineKwh });
    } catch (error) {
        res.status(500).json({ message: "Gagal mengambil data." });
    }
});

app.get('/data/history', protect, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) return res.status(400).json({ message: 'Harap sediakan parameter startDate dan endDate.' });
        const historyData = await SensorData.find({ timestamp: { $gte: new Date(startDate), $lte: new Date(endDate) } }).sort({ timestamp: 1 });
        res.json(historyData);
    } catch (error) {
        res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
    }
});

app.get('/data/today-summary', protect, async (req, res) => {
    try {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const dataToday = await SensorData.find({ timestamp: { $gte: startOfToday } });
        let totalPlnKwh = 0, totalTurbineKwh = 0;
        const intervalHours = 5 / 3600;
        dataToday.forEach(d => {
            totalPlnKwh += (d.plnWattage / 1000) * intervalHours;
            totalTurbineKwh += (d.turbineWattage / 1000) * intervalHours;
        });
        res.json({ totalPlnKwh, totalTurbineKwh });
    } catch (error) {
        res.status(500).json({ message: "Gagal mengambil ringkasan hari ini." });
    }
});

// --- Rute Notifikasi ---
app.get('/notifications', protect, async (req, res) => {
  const notifications = await Notification.find().sort({ timestamp: -1 }).limit(20);
  res.json(notifications);
});

app.get('/notifications/latest', protect, async (req, res) => {
    const latestNotification = await Notification.findOne().sort({ timestamp: -1 });
    res.json(latestNotification);
});

app.get('/notifications/unread-count', protect, async (req, res) => {
  try {
    const count = await Notification.countDocuments({ isRead: false });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: 'Gagal menghitung notifikasi.' });
  }
});

app.post('/notifications/mark-as-read', protect, async (req, res) => {
  try {
    await Notification.updateMany({ isRead: false }, { $set: { isRead: true } });
    res.json({ message: 'Semua notifikasi ditandai telah dibaca.' });
  } catch (error) {
    res.status(500).json({ message: 'Gagal memperbarui notifikasi.' });
  }
});

app.get('/notifications/summary', protect, async (req, res) => {
    try {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const summary = await Notification.aggregate([
            { $match: { timestamp: { $gte: oneHourAgo } } },
            { $group: { _id: '$type', count: { $sum: 1 } } }
        ]);
        const summaryObject = summary.reduce((acc, item) => {
            acc[item._id] = item.count;
            return acc;
        }, {});
        res.json(summaryObject);
    } catch (error) {
        res.status(500).json({ message: "Gagal mengambil ringkasan notifikasi." });
    }
});

app.delete('/notifications', protect, async (req, res) => {
  await Notification.deleteMany({});
  res.json({ message: 'Semua notifikasi berhasil dibersihkan.' });
});

// --- Jalankan server ---
const port = 3000;
httpServer.listen(port, '127.0.0.1', () => {
  console.log(`🚀 Server API & Socket.IO berjalan di http://127.0.0.1:${port}`);
});