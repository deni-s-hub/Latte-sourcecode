// File: server.js (Versi Final, Kembali Menerima Format CSV)
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const mqtt = require('mqtt');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

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

app.use(express.static('public'));

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
    
    // --- KEMBALI MENGGUNAKAN PARSING CSV ---
    const dataString = message.toString().trim();
    const values = dataString.split(',');

    if (values.length < 7) {
        console.error(`Data CSV tidak lengkap, diharapkan 7 nilai, diterima ${values.length}`);
        return;
    }

    const rawData = {
      voltageAC: parseFloat(values[0]),
      voltageDC: parseFloat(values[1]),
      currentDC: parseFloat(values[2]),
      currentAC: parseFloat(values[3]),
      windSpeed: parseFloat(values[4]),
      batteryTemperature: parseFloat(values[5]),
      humidity: parseFloat(values[6])
    };
    // --- AKHIR PERUBAHAN ---
    
    for (const key in rawData) { if (isNaN(rawData[key])) { console.error(`Data tidak valid (NaN) untuk ${key}`); return; } }

    const turbinePower = rawData.voltageDC * rawData.currentDC;
    const intervalSeconds = 5;
    const energyChangeWh = (turbinePower * intervalSeconds) / 3600;
    currentBatteryWh += energyChangeWh;

    if (currentBatteryWh > TOTAL_BATTERY_WH) currentBatteryWh = TOTAL_BATTERY_WH;
    if (currentBatteryWh < 0) currentBatteryWh = 0;

    const batterySoc = (currentBatteryWh / TOTAL_BATTERY_WH) * 100;

    const fullData = {
      ...rawData,
      windTurbineStatus: rawData.currentDC > 0.1 ? "ON" : "OFF",
      plnWattage: rawData.voltageAC * rawData.currentAC,
      turbineWattage: turbinePower,
      batteryCapacity: batterySoc
    };
    
    const newData = new SensorData(fullData);
    await newData.save();
    console.log(`💾 Data CSV disimpan. SOC Baterai: ${batterySoc.toFixed(2)}%`);

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

  } catch (error) { console.error('Gagal memproses pesan CSV:', error); }
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

app.get('/download-pdf', protect, async (req, res) => {
    const logoPath = path.join(__dirname, 'public', 'logo-tim.png'); 
    if (!fs.existsSync(logoPath)) {
        return res.status(500).send("Gagal membuat PDF: File logo tidak ditemukan.");
    }

    try {
        const { startDate, endDate, columns } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'Harap sediakan parameter.' });
        }

        const historyData = await SensorData.find({
            timestamp: { $gte: new Date(startDate), $lte: new Date(endDate) }
        }).sort({ timestamp: -1 });

        if (historyData.length === 0) {
            return res.status(404).send("Tidak ada data untuk dibuat laporan.");
        }

        // --- AGREGRASI DATA PER JAM ---
        const hourlyGroups = {};
        const intervalHours = 5 / 3600;
        historyData.forEach(d => {
            const hour = new Date(d.timestamp); hour.setMinutes(0, 0, 0); const hourKey = hour.toISOString();
            if (!hourlyGroups[hourKey]) {
                hourlyGroups[hourKey] = { plnSum: 0, turbineSum: 0, voltACSum: 0, ampACSum: 0, rpmSum: 0, windSpeedSum: 0, tempSum: 0, plnKwhSum: 0, turbineKwhSum: 0, count: 0 };
            }
            const plnWatt = d.plnWattage || 0; const turbineWatt = d.turbineWattage || 0;
            hourlyGroups[hourKey].plnSum += plnWatt; hourlyGroups[hourKey].turbineSum += turbineWatt;
            hourlyGroups[hourKey].voltACSum += d.voltageAC || 0; hourlyGroups[hourKey].ampACSum += d.currentAC || 0;
            hourlyGroups[hourKey].rpmSum += d.rpm || 0; hourlyGroups[hourKey].windSpeedSum += d.windSpeed || 0;
            hourlyGroups[hourKey].tempSum += d.batteryTemperature || 0;
            hourlyGroups[hourKey].plnKwhSum += (plnWatt / 1000) * intervalHours;
            hourlyGroups[hourKey].turbineKwhSum += (turbineWatt / 1000) * intervalHours;
            hourlyGroups[hourKey].count++;
        });

        const aggregatedData = Object.keys(hourlyGroups).sort().map(key => ({ timestamp: new Date(key), ...hourlyGroups[key] }));
        
        let totalPlnKwh = 0, totalTurbineKwh = 0;
        aggregatedData.forEach(group => { totalPlnKwh += group.plnKwhSum; totalTurbineKwh += group.turbineKwhSum; });

        // --- PEMBUATAN PDF ---
        const pageLayout = (columns ? columns.split(',').length : 8) > 5 ? 'landscape' : 'portrait';
        const doc = new PDFDocument({ margin: 40, size: 'A4', layout: pageLayout });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="laporan-energi-${Date.now()}.pdf"`);
        doc.pipe(res);

        // --- KONTEN PDF ---
        doc.image(logoPath, 40, 40, { width: 60 })
           .fillColor('#1C1C1C').fontSize(22).font('Helvetica-Bold').text('LATTE WIND TURBINE', 110, 50)
           .fontSize(14).font('Helvetica').text('Laporan Data Historis', 110, 75)
           .fontSize(10).text(`Periode: ${new Date(startDate).toLocaleDateString('id-ID')} - ${new Date(endDate).toLocaleDateString('id-ID')}`, 200, 95, { align: 'right' });
        doc.moveTo(40, 125).lineTo(doc.page.width - 40, 125).strokeColor('#CCCCCC').stroke();
        doc.moveDown(3);

        // --- TABEL DATA ---
        doc.fontSize(12).font('Helvetica-Bold').text('Rincian Data per Jam');
        doc.moveDown();

        // --- TABEL DATA DENGAN LOGIKA PERBAIKAN ---
        const tableTop = doc.y;
        const columnMap = { 
            timestamp: "Waktu", energyKwh: "Energi (kWh)", plnWattage: "Daya PLN (W)",
            turbineWattage: "Daya Turbin (W)", voltageAC: "Tegangan (V)", currentAC: "Arus (A)",
            rpm: "RPM", windSpeed: "Kec. Angin (m/s)", batteryTemperature: "Suhu Baterai (°C)" 
        };
        const activeColumns = columns ? columns.split(',') : defaultColumns;
        const allHeaders = ['timestamp', ...activeColumns];

        function generateTableRow(y, items, isHeader = false) { 
            let x = 40;
            const pageWidth = doc.page.width - 80; // Lebar halaman dikurangi margin
            const colWidth = pageWidth / items.length; // Lebar kolom dibagi rata

            doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
            items.forEach(item => {
                doc.text(item.toString(), x + 5, y + 5, { width: colWidth - 10, align: 'left' });
                x += colWidth;
            });
            doc.moveTo(40, y + 20).lineTo(doc.page.width - 40, y + 20).stroke(); // Garis bawah 
        }
        
        generateTableRow(tableTop, allHeaders.map(key => columnMap[key] || key), true);
        
        aggregatedData.reverse().forEach(group => {
            const rowY = doc.y;
            const count = group.count;
            const rowItems = [];
            
            allHeaders.forEach(key => {
                let value = '--'; // Default value
                
                // ▼▼▼ LOGIKA PERBAIKAN UTAMA ADA DI SINI ▼▼▼
                switch (key) {
                    case 'timestamp':
                        value = group.timestamp.toLocaleString('id-ID', {day: '2-digit', month: 'numeric', year:'2-digit', hour: '2-digit', minute:'2-digit'});
                        break;
                    case 'energyKwh':
                        const energy = (group.plnKwhSum || 0) + (group.turbineKwhSum || 0);
                        value = isNaN(energy) ? '0.00' : energy.toFixed(2);
                        break;
                    case 'plnWattage':
                        const plnAvg = group.plnSum / count;
                        value = isNaN(plnAvg) ? '0.00' : plnAvg.toFixed(2);
                        break;
                    case 'turbineWattage':
                        const turbineAvg = group.turbineSum / count;
                        value = isNaN(turbineAvg) ? '0.00' : turbineAvg.toFixed(2);
                        break;
                    case 'voltageAC':
                        const voltAvg = group.voltACSum / count;
                        value = isNaN(voltAvg) ? '--' : voltAvg.toFixed(2);
                        break;
                    case 'currentAC':
                        const ampAvg = group.ampACSum / count;
                        value = isNaN(ampAvg) ? '--' : ampAvg.toFixed(2);
                        break;
                    case 'rpm':
                        const rpmAvg = group.rpmSum / count;
                        value = isNaN(rpmAvg) ? '--' : Math.round(rpmAvg);
                        break;
                    case 'windSpeed':
                        const windAvg = group.windSpeedSum / count;
                        value = isNaN(windAvg) ? '--' : windAvg.toFixed(2);
                        break;
                    case 'batteryTemperature':
                        const tempAvg = group.tempSum / count;
                        value = isNaN(tempAvg) ? '--' : tempAvg.toFixed(2);
                        break;
                }
                rowItems.push(value);
            });
            generateTableRow(rowY, rowItems);
        });
        
        doc.fontSize(8).text(`Laporan ini dibuat secara otomatis oleh Sistem LATTE pada ${new Date().toLocaleString('id-ID')}`, 40, doc.page.height - 50, { align: 'center', width: doc.page.width - 80 });
        doc.end();

    } catch (error) {
        console.error("Gagal membuat PDF:", error);
        if (!res.headersSent) {
            res.status(500).send("Gagal membuat laporan PDF.");
        }
    }
});

// --- Jalankan server ---
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server berjalan di port ${PORT}`);
});
