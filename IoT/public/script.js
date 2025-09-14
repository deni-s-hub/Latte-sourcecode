// === BAGIAN 1: VARIABEL GLOBAL & STATE ===
let dataIntervalId = null;
let notificationIntervalId = null;
let isLoggedIn = false;
let lastShownNotificationId = null;
let notificationDropdown = null;
const UIElements = {};
let aggregatedHourlyData = [];
let powerChartInstance = null;
let analysisChartInstance = null;
let aiSocChartInstance = null;
const analysisOptions = [
    { value: 'plnWattage', text: 'Daya PLN' },
    { value: 'turbineWattage', text: 'Daya Turbin' },
    { value: 'voltageAC', text: 'Tegangan' },
    { value: 'currentAC', text: 'Arus' },
    { value: 'windSpeed', text: 'Kecep. Angin' },
    { value: 'batteryTemperature', text: 'Temperatur Baterai' }
];

// === BAGIAN 2: FUNGSI-FUNGSI UTAMA ===

// --- Fungsi Otentikasi & Navigasi ---
async function fetchDataWithAuth(url, options = {}) {
    const token = localStorage.getItem('token');
    if (!token) { logout(); return Promise.reject(new Error('No token found')); }
    const headers = { ...options.headers, 'Authorization': `Bearer ${token}` };
    try {
        const response = await fetch(url, { ...options, headers });
        if (response.status === 401) { alert('Sesi Anda telah berakhir. Silakan login kembali.'); logout(); return Promise.reject(new Error('Unauthorized')); }
        return response;
    } catch (error) { return Promise.reject(error); }
}
function showApp() {
    isLoggedIn = true;
    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    setupNotifications();
    addAppEventListeners();
    showPage('beranda');
    displayUserInfo();
    startTimers(); 
    loadSocPredictionChart();
}
function showAuth() {
    isLoggedIn = false;
    document.getElementById('app-container').classList.add('hidden');
    document.getElementById('auth-container').classList.remove('hidden');
}
function logout() {
    isLoggedIn = false;
    stopTimers();
    localStorage.removeItem('token');

    // Ganti refresh dengan fungsi untuk menampilkan halaman login
    showAuth();
}
async function loadSocPredictionChart() {
     try {
        const chartData = dummySocPredictionData;
        const labels = chartData.map(item => item.timestamp); // Kirim timestamp lengkap
        const data = chartData.map(item => item.predicted_soc);

        const ctx = document.getElementById('aiSocChart');
        if (!ctx) return;
        if (aiSocChartInstance) aiSocChartInstance.destroy();

        aiSocChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Prediksi SOC (%)',
                    data: data,
                    borderColor: 'rgba(74, 144, 226, 1)',
                    backgroundColor: 'rgba(74, 144, 226, 0.2)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: false,
                        min: 0,   
                        max: 100,
                        title: { display: true, text: 'State of Charge (%)' }
                    },
                    x: {
                        ticks: {
                            callback: function(value, index, ticks) {
                                const label = this.getLabelForValue(value);
                                const date = new Date(label);
                                if (date.getHours() === 12) {
                                    return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
                                }
                                return null;
                            }
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            title: function(context) {
                                return null; // Mengembalikan null untuk menghilangkan baris judul
                            },
                            label: function(context) {
                                const soc = context.raw; 
                                const timestamp = context.label;
                                const date = new Date(timestamp);

                                const year = date.getFullYear();
                                const month = String(date.getMonth() + 1).padStart(2, '0');
                                const day = String(date.getDate()).padStart(2, '0');
                                const hours = String(date.getHours()).padStart(2, '0');
                                const minutes = String(date.getMinutes()).padStart(2, '0');
                                
                                const formattedDateTime = `${year}/${month}/${day}-${hours}:${minutes}`;
                                const formattedTime = `${hours}:${minutes}`;

                                if (soc === 100) {
                                    return `Switch to Battery (${formattedDateTime})`;
                                } else if (soc === 20) {
                                    return `Switch to PLN (${formattedDateTime})`;
                                } else {
                                    return `${formattedTime} - ${soc}%`;
                                }
                            },
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error("Gagal menggambar data prediksi SOC:", error);
    }
}
function displayUserInfo() {
    const token = localStorage.getItem('token');
    if (token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            document.getElementById('akun-username-topbar').textContent = payload.username;
            document.getElementById('settings-username').textContent = payload.username;
        } catch (error) { console.error('Gagal men-decode token:', error); }
    }
}
function showPage(pageId, scrollToId = null) {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const activeLink = document.querySelector(`a[href="#${pageId}"]`);
    const activePage = document.getElementById(pageId);
    if (activeLink) activeLink.classList.add('active');
    if (activePage) activePage.classList.add('active');
    if (pageId === 'notifikasi') loadNotifications();
    if (pageId === 'pengaturan') displayUserInfo();
    if (scrollToId) {
        setTimeout(() => {
            const element = document.getElementById(scrollToId);
            if(element) element.scrollIntoView({ behavior: 'smooth' });
        }, 100);
    }
    if (pageId === 'dashboard') {
        // === TAMPILKAN 24 JAM TERAKHIR SECARA DEFAULT ===
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 1); // Atur tanggalnya ke 1 hari (24 jam) yang lalu

    // Helper untuk format tanggal dan jam ke string yang dibutuhkan input
    const toLocalISOString = (date) => {
        const offset = date.getTimezoneOffset();
        const adjustedDate = new Date(date.getTime() - (offset * 60 * 1000));
        return adjustedDate.toISOString().slice(0, 16);
    };
    
    // Atur nilai default di input filter agar sesuai dengan tampilan
    document.getElementById('filter-date-start').value = startDate.toISOString().split('T')[0];
    document.getElementById('filter-hour-start').value = startDate.getHours().toString().padStart(2, '0');
    document.getElementById('filter-date-end').value = endDate.toISOString().split('T')[0];
    document.getElementById('filter-hour-end').value = endDate.getHours().toString().padStart(2, '0');
    
    // Panggil fungsi untuk memuat grafik dengan rentang waktu 24 jam terakhir
    updateDashboardWithHistory(startDate.toISOString(), endDate.toISOString());
    }
}

// --- Fungsi Data Real-time ---
async function ambilData() {
    if (!isLoggedIn) return;
    try {
        const response = await fetchDataWithAuth('/data');
        const data = await response.json();

        if (data && data.timestamp) {
            const lastDataTime = new Date(data.timestamp).getTime();
            const currentTime = new Date().getTime();
            const isOnline = (currentTime - lastDataTime) < 10000;

            if (isOnline) {
                // === JIKA ONLINE ===
                // 1. Update status ke "Online"
                if (UIElements.statusIndicator) {
                    UIElements.statusIndicator.className = 'status-indicator online';
                    UIElements.statusText.textContent = 'Online';
                    UIElements.statusCard.classList.add('online');
                    UIElements.statusCard.classList.remove('offline');
                }
                
                // 2. Update kartu Baterai (di Beranda & Dashboard)
                if (UIElements.battTempBeranda) UIElements.battTempBeranda.textContent = data.batteryTemperature.toFixed(2) + ' °C';
                if (UIElements.battCapTextBeranda) {
                    UIElements.battCapTextBeranda.textContent = `${data.batteryCapacity}%`;
                    if(UIElements.battCapFillBeranda) UIElements.battCapFillBeranda.style.width = `${data.batteryCapacity}%`;
                }
                if (UIElements.battTempDetail) UIElements.battTempDetail.textContent = data.batteryTemperature.toFixed(2) + ' °C';
                if (UIElements.battCapTextDetail) {
                    UIElements.battCapTextDetail.textContent = `${data.batteryCapacity}%`;
                    if(UIElements.battCapFillDetail) UIElements.battCapFillDetail.style.width = `${data.batteryCapacity}%`;
                }

                // 3. Update kartu Live Monitoring di Dashboard
                const totalPln = data.totalPlnKwh || 0;
                const totalTurbin = data.totalTurbineKwh || 0;
                //if (UIElements.plnEnergyBeranda) UIElements.plnEnergyBeranda.textContent = totalPln.toFixed(2);
                //if (UIElements.turbinEnergyBeranda) UIElements.turbinEnergyBeranda.textContent = totalTurbin.toFixed(2);
                //if (UIElements.rumahEnergyBeranda) UIElements.rumahEnergyBeranda.textContent = (totalPln + totalTurbin).toFixed(2);
                if (UIElements.plnWattDetail) UIElements.plnWattDetail.textContent = data.plnWattage.toFixed(2);
                if (UIElements.plnVoltDetail) UIElements.plnVoltDetail.textContent = data.voltageAC.toFixed(2);
                if (UIElements.plnAmpereDetail) UIElements.plnAmpereDetail.textContent = data.currentAC.toFixed(2);
                if (UIElements.turbinWattDetail) UIElements.turbinWattDetail.textContent = data.turbineWattage.toFixed(2);
                if (UIElements.turbinVoltDetail) UIElements.turbinVoltDetail.textContent = data.voltageDC.toFixed(2);
                if (UIElements.turbinAmpereDetail) UIElements.turbinAmpereDetail.textContent = data.currentDC.toFixed(2);
                if (UIElements.turbinSpeedDetail) UIElements.turbinSpeedDetail.textContent = data.windSpeed.toFixed(2);

            } else {
                // Jika data basi (perangkat offline)
                resetRealtimeCards();
            }
        } else {
            // Jika data tidak valid
            resetRealtimeCards();
        }
    } catch (error) {
        // Jika server mati
        console.error('Gagal mengambil data (server down?):', error);
        resetRealtimeCards();
    }
}
function resetRealtimeCards() {
    // 1. Update kartu status ke "Offline"
    if (UIElements.statusIndicator) {
        UIElements.statusIndicator.className = 'status-indicator offline';
        UIElements.statusText.textContent = 'Offline';
        UIElements.statusCard.classList.add('offline');
        UIElements.statusCard.classList.remove('online');
    }
    
    // 2. Reset semua nilai di kartu Live Monitoring Dashboard
    if (UIElements.plnWattDetail) UIElements.plnWattDetail.textContent = '0.00';
    if (UIElements.plnVoltDetail) UIElements.plnVoltDetail.textContent = '--';
    if (UIElements.plnAmpereDetail) UIElements.plnAmpereDetail.textContent = '--';
    if (UIElements.turbinWattDetail) UIElements.turbinWattDetail.textContent = '0.00';
    if (UIElements.turbinVoltDetail) UIElements.turbinVoltDetail.textContent = '--';
    if (UIElements.turbinAmpereDetail) UIElements.turbinAmpereDetail.textContent = '--';
    if (UIElements.turbinSpeedDetail) UIElements.turbinSpeedDetail.textContent = '--';
    if (UIElements.battTempDetail) UIElements.battTempDetail.textContent = '-- °C';
    if (UIElements.battCapTextDetail) {
        UIElements.battCapTextDetail.textContent = '--%';
        if(UIElements.battCapFillDetail) UIElements.battCapFillDetail.style.width = '0%';
    }

    // 3. Reset Baterai di Beranda
    if (UIElements.battTempBeranda) UIElements.battTempBeranda.textContent = '-- °C';
    if (UIElements.battCapTextBeranda) {
        UIElements.battCapTextBeranda.textContent = '--%';
        if(UIElements.battCapFillBeranda) UIElements.battCapFillBeranda.style.width = '0%';
    }
}

// --- Fungsi Notifikasi ---
async function loadNotificationSummary() {
    if (!isLoggedIn) return;
    const summaryTextElement = document.getElementById('notification-summary-text');
    const notificationCard = summaryTextElement.closest('.data-card'); // Dapatkan elemen kartu induk
    if (!summaryTextElement || !notificationCard) return;

    try {
        const response = await fetchDataWithAuth('/notifications/summary');
        const summaryData = await response.json();

        const summaryKeys = Object.keys(summaryData);

        if (summaryKeys.length === 0) {
            summaryTextElement.innerHTML = '✅ <strong>Sistem Aman.</strong> Tidak ada peringatan baru.';
            notificationCard.classList.remove('alert-active'); // Hapus class jika aman
            return;
        }

        // --- Ada Notifikasi, maka aktifkan style peringatan ---
        notificationCard.classList.add('alert-active'); 

        let summaryMessage = '';
        summaryKeys.forEach(key => {
            const count = summaryData[key];
            let typeText = '';
            let icon = '⚠️';

            if (key === 'OVERHEAT') {
                typeText = `Peringatan Suhu Tinggi`;
                icon = '🔥';
            }
            summaryMessage += `${icon} <strong>${count} ${typeText}</strong> dalam satu jam terakhir. `;
        });

        summaryTextElement.innerHTML = summaryMessage;

    } catch (error) {
        console.error("Gagal memuat ringkasan notifikasi:", error);
        notificationCard.classList.remove('alert-active'); // Pastikan dihapus juga jika error
    }
}
function setupNotifications() {
    // 1. Cek dulu apakah browser ini mendukung Notifikasi
    if (!('Notification' in window)) {
        console.log("Browser ini tidak mendukung notifikasi desktop.");
        return;
    }

    // 2. Cek status izin yang sudah ada
    if (Notification.permission === 'granted') {
        console.log("Izin notifikasi sudah diberikan sebelumnya.");
    } else if (Notification.permission !== 'denied') {
        // 3. Jika izin belum diberikan ('default'), maka kita minta izin
        console.log("Meminta izin notifikasi kepada pengguna...");
        Notification.requestPermission().then(permission => {
            // Jika pengguna mengizinkan
            if (permission === 'granted') {
                console.log("Izin notifikasi berhasil diberikan!");
                // Tampilkan notifikasi percobaan sebagai feedback
                new Notification("Notifikasi LATTE berhasil diaktifkan!", {
                    body: "Anda akan menerima peringatan penting melalui notifikasi ini.",
                    icon: "logo-tim.png" // Opsional: menambahkan ikon
                });
            }
        });
    }
}
async function checkForNewNotifications() {
    if (!isLoggedIn || Notification.permission !== 'granted') return;
    
    console.log('1. Mengecek notifikasi baru...'); // Lacak apakah fungsi berjalan

    try {
        const response = await fetchDataWithAuth('/notifications/latest');
        if (!response.ok) return;
        const latestNotif = await response.json();

        console.log('2. Notifikasi terbaru dari server:', latestNotif);
        console.log('3. ID notif terakhir yang sudah ditampilkan:', lastShownNotificationId);

        if (latestNotif && latestNotif._id !== lastShownNotificationId) {
            console.log('4. Notifikasi BARU ditemukan, mencoba menampilkan...'); // Lacak jika kondisi terpenuhi

            try {
                const notifSound = new Audio('sounds/notification.mp3');
                notifSound.play();
            } catch (err) {
                console.error("Gagal memutar suara notifikasi:", err);
            } 

            new Notification('⚠️ Peringatan Sistem LATTE', {
                body: latestNotif.message,
                icon: 'logo-tim.png',
                tag: 'latte-warning'
            });

            lastShownNotificationId = latestNotif._id;
        }
    } catch (error) {
        console.error("Gagal mengecek notifikasi baru:", error);
    }
}
async function populateNotificationDropdown() {
    const container = document.getElementById('notification-list-dropdown');
    if(!container) return;
    try {
        const response = await fetchDataWithAuth('/notifications');
        const notifications = await response.json();
        container.innerHTML = '';
        if (notifications.length === 0) {
            container.innerHTML = '<div class="notification-placeholder">Tidak ada notifikasi baru.</div>';
            return;
        }
        notifications.slice(0, 4).forEach(notif => {
            const item = document.createElement('a');
            item.className = 'notification-list-item';
            item.href = '#maintenance';
            item.innerHTML = `<div>${notif.message}</div><small>${new Date(notif.timestamp).toLocaleTimeString('id-ID')}</small>`;
            item.addEventListener('click', (e) => {
                e.preventDefault();
                notificationDropdown.classList.add('hidden'); // <-- Tutup dropdown
                document.body.classList.remove('noscroll');   // <-- Buka kunci scroll
                showPage('maintenance', 'corrective-temp-tinggi');
            });
            container.appendChild(item);
        });
    } catch (error) {
        container.innerHTML = '<div class="notification-placeholder">Gagal memuat.</div>';
    }
}
async function clearNotifications() {
    if (!confirm('Apakah Anda yakin ingin menghapus semua riwayat notifikasi? Tindakan ini tidak dapat diurungkan.')) return;
    try {
        await fetchDataWithAuth('/notifications', { method: 'DELETE' });
        loadNotifications();
        populateNotificationDropdown();
    } catch (error) {
        console.error('Gagal membersihkan notifikasi:', error);
        alert('Terjadi kesalahan saat mencoba membersihkan notifikasi.');
    }
}
async function checkUnreadCount() {
    if (!isLoggedIn) return;
    const badge = document.getElementById('notification-badge');
    try {
        const response = await fetchDataWithAuth('/notifications/unread-count');
        const data = await response.json();
        if (data.count > 0) {
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    } catch (error) { console.error('Gagal cek notifikasi:', error); }
}
async function markNotificationsAsRead() {
    try {
        await fetchDataWithAuth('/notifications/mark-as-read', { method: 'POST' });
        checkUnreadCount();
    } catch (error) { console.error('Gagal menandai notifikasi:', error); }
}

// --- Fungsi Analisis Historis (Dashboard) ---
function renderMainChart() {
    const ctx = document.getElementById('powerChart');
    if (!ctx || !aggregatedHourlyData) return;

    if (powerChartInstance) {
        powerChartInstance.destroy();
    }

    const mainChartDatasetConfig = {
        plnWattage: { label: 'Daya PLN (Watt)', borderColor: 'rgba(232, 106, 51, 1)', backgroundColor: 'rgba(232, 106, 51, 0.2)' },
        turbineWattage: { label: 'Daya Turbin (Watt)', borderColor: 'rgba(42, 111, 46, 1)', backgroundColor: 'rgba(42, 111, 46, 0.2)' },
        windSpeed: { label: 'Kecep. Angin (m/s)', borderColor: 'rgba(126, 211, 33, 1)', backgroundColor: 'rgba(126, 211, 33, 0.2)' }
    };

    const dataKeyMap = {
        plnWattage: 'plnSum',
        turbineWattage: 'turbineSum',
        windSpeed: 'windSpeedSum'
    };

    const datasets = [];
    document.querySelectorAll('.main-chart-controls input:checked').forEach(checkbox => {
        const key = checkbox.value;
        const config = mainChartDatasetConfig[key];
        const dataKey = dataKeyMap[key];

        if (config && dataKey) {
            datasets.push({
                label: config.label,
                data: aggregatedHourlyData.map(hourData => (hourData[dataKey] / hourData.count).toFixed(2)),
                borderColor: config.borderColor,
                backgroundColor: config.backgroundColor,
                fill: true,
                tension: 0.3
            });
        }
    });

    const chartLabels = aggregatedHourlyData.map(hourData => new Date(hourData.timestamp).toLocaleTimeString('id-ID', { day: '2-digit', hour: '2-digit', minute: '2-digit' }));

    powerChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true },
                x: { title: { display: true, text: 'Waktu' } }
            }
        }
    });
}
function renderHistoryTable() {
    const tableBody = document.getElementById('history-table-body');
    const tableHead = document.querySelector('.history-table-container thead tr');
    if (!tableBody || !tableHead) return;

    const columnMap = {
        timestamp: "Waktu", energyKwh: "Energi (kWh)", plnWattage: "Daya PLN (W)",
        turbineWattage: "Daya Turbin (W)", voltageAC: "Tegangan (V)", currentAC: "Arus (A)", windSpeed: "Kecep. Angin (m/s)", batteryTemperature: "Suhu Baterai (°C)"
    };

    const visibleColumns = ['timestamp'];
    document.querySelectorAll('.column-filter-controls input:checked').forEach(cb => {
        if (!visibleColumns.includes(cb.value)) {
            visibleColumns.push(cb.value);
        }
    });

    tableHead.innerHTML = '';
    visibleColumns.forEach(key => {
        tableHead.innerHTML += `<th>${columnMap[key] || key}</th>`;
    });

    tableBody.innerHTML = '';
    const sortedDataForTable = [...aggregatedHourlyData].reverse();
    
    sortedDataForTable.forEach(hourData => {
        const group = hourData;
        const count = group.count;
        let rowHTML = '<tr>';
        visibleColumns.forEach(key => {
            let value = '';
            switch (key) {
                case 'timestamp': value = new Date(group.timestamp).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }); break;
                case 'energyKwh': value = ((group.plnKwhSum || 0) + (group.turbineKwhSum || 0)).toFixed(2); break;
                case 'plnWattage': value = (group.plnSum / count).toFixed(2); break;
                case 'turbineWattage': value = (group.turbineSum / count).toFixed(2); break;
                case 'voltageAC': value = (group.voltACSum / count).toFixed(2); break;
                case 'currentAC': value = (group.ampACSum / count).toFixed(2); break;
                case 'windSpeed': value = (group.windSpeedSum / count).toFixed(2); break;
                case 'batteryTemperature': value = (group.tempSum / count).toFixed(2); break;
                default: value = '--'; break;
            }
            rowHTML += `<td>${value}</td>`;
        });
        rowHTML += '</tr>';
        tableBody.innerHTML += rowHTML;
    });
}
async function updateDashboardWithHistory(startDateISO, endDateISO) {
    const loadingOverlay = document.getElementById('historical-loading-overlay');
    const tableBody = document.getElementById('history-table-body');
    const tableHead = document.querySelector('.history-table-container thead tr');
    
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');

    try {
        if (powerChartInstance) {
            powerChartInstance.destroy();
        }
        tableBody.innerHTML = '<tr><td colspan="9">Memuat data...</td></tr>';
        
        const response = await fetchDataWithAuth(`/data/history?startDate=${startDateISO}&endDate=${endDateISO}`);
        const historyData = await response.json();

        if (historyData.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="9">Tidak ada data pada rentang waktu ini.</td></tr>';
            tableHead.innerHTML = '<th>Informasi</th>';
            UIElements.plnEnergyDetail.textContent = '0.00';
            UIElements.turbinEnergyDetail.textContent = '0.00';
            UIElements.rumahEnergyDetail.textContent = '0.00';
            return;
        }

        const hourlyGroups = {};
        const intervalHours = 5 / 3600;
        historyData.forEach(d => {
            const hour = new Date(d.timestamp);
            hour.setMinutes(0, 0, 0);
            const hourKey = hour.toISOString();
            if (!hourlyGroups[hourKey]) {
                hourlyGroups[hourKey] = { plnSum: 0, turbineSum: 0, voltACSum: 0, ampACSum: 0, windSpeedSum: 0, tempSum: 0, plnKwhSum: 0, turbineKwhSum: 0, count: 0 };
            }
            const plnWatt = d.plnWattage || 0;
            const turbineWatt = d.turbineWattage || 0;
            hourlyGroups[hourKey].plnSum += plnWatt;
            hourlyGroups[hourKey].turbineSum += turbineWatt;
            hourlyGroups[hourKey].voltACSum += d.voltageAC || 0;
            hourlyGroups[hourKey].ampACSum += d.currentAC || 0;
            hourlyGroups[hourKey].windSpeedSum += d.windSpeed || 0;
            hourlyGroups[hourKey].tempSum += d.batteryTemperature || 0;
            hourlyGroups[hourKey].plnKwhSum += (plnWatt / 1000) * intervalHours;
            hourlyGroups[hourKey].turbineKwhSum += (turbineWatt / 1000) * intervalHours;
            hourlyGroups[hourKey].count++;
        });

        aggregatedHourlyData = Object.keys(hourlyGroups).sort().map(hourKey => ({ timestamp: hourKey, ...hourlyGroups[hourKey] }));
        
        renderHistoryTable();
        renderMainChart();

        let totalPlnKwhFiltered = 0;
        let totalTurbineKwhFiltered = 0;
        historyData.forEach(dataPoint => {
            totalPlnKwhFiltered += ((dataPoint.plnWattage || 0) / 1000) * intervalHours;
            totalTurbineKwhFiltered += ((dataPoint.turbineWattage || 0) / 1000) * intervalHours;
        });
        UIElements.plnEnergyDetail.textContent = totalPlnKwhFiltered.toFixed(2);
        UIElements.turbinEnergyDetail.textContent = totalTurbineKwhFiltered.toFixed(2);
        UIElements.rumahEnergyDetail.textContent = (totalPlnKwhFiltered + totalTurbineKwhFiltered).toFixed(2);

    } catch (error) {
        console.error("Gagal memproses data historis:", error);
    
        // Tampilkan pesan error di tabel
        tableBody.innerHTML = '<tr><td colspan="8">Koneksi ke server gagal. Tidak bisa memuat data historis.</td></tr>';
        
        // Hancurkan chart lama jika ada
        if (powerChartInstance) {
            powerChartInstance.destroy();
        }

        // BARU: Gambar chart 'kosong' dengan pesan offline
        const ctx = document.getElementById('powerChart');
        if(ctx) {
            powerChartInstance = new Chart(ctx, {
                type: 'line',
                data: { labels: [], datasets: [] }, // Data kosong
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: {
                            display: true,
                            text: 'Koneksi Gagal, Tidak Dapat Memuat Grafik',
                            font: { size: 16 },
                            color: '#7A7A7A'
                        },
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        y: { display: false },
                        x: { display: false }
                    }
                }
            });
        }
    } finally {
        // Sembunyikan loading di akhir, baik prosesnya berhasil maupun gagal
        if(loadingOverlay) loadingOverlay.classList.add('hidden');
    }
}
function drawAnalysisChart() {
    const xKey = document.getElementById('xAxis-select').value;
    const yKey = document.getElementById('yAxis-select').value;

    const keyMap = {
        plnWattage: 'plnSum', turbineWattage: 'turbineSum', voltageAC: 'voltACSum',
        currentAC: 'ampACSum', windSpeed: 'windSpeedSum',
        batteryTemperature: 'tempSum'
    };
    
    const xDataKey = keyMap[xKey];
    const yDataKey = keyMap[yKey];
    const xLabel = analysisOptions.find(o => o.value === xKey).text;
    const yLabel = analysisOptions.find(o => o.value === yKey).text;

    let dataForChart = aggregatedHourlyData.map(hourData => {
        const count = hourData.count;
        return {
            x: (hourData[xDataKey] / count),
            y: (hourData[yDataKey] / count)
        };
    });

    // BARU: Urutkan data berdasarkan nilai sumbu X agar garisnya tidak kacau
    dataForChart.sort((a, b) => a.x - b.x);

    const ctx = document.getElementById('analysisChart');
    if (analysisChartInstance) {
        analysisChartInstance.destroy();
    }
    analysisChartInstance = new Chart(ctx, {
        type: 'scatter', // Kita tetap pakai 'scatter' agar sumbu X bisa berupa angka apa saja
        data: {
            datasets: [{
                label: `${yLabel} vs. ${xLabel}`,
                data: dataForChart,
                backgroundColor: 'rgba(74, 144, 226, 0.6)',
                showLine: true, // BARU: Perintahkan Chart.js untuk menggambar garis
                borderColor: 'rgba(74, 144, 226, 1)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { title: { display: true, text: xLabel } },
                y: { title: { display: true, text: yLabel } }
            }
        }
    });
}

// --- Fungsi Timer ---
function startTimers() {
    stopTimers(); // Hentikan timer lama jika ada
    console.log("Timer dimulai.");

    // Panggil semua fungsi sekali di awal agar data langsung tampil
    ambilData();
    checkUnreadCount();
    checkForNewNotifications(); // Panggil fungsi notifikasi push di awal juga
    loadNotificationSummary();

    // Atur interval (timer) untuk pembaruan data berkala
    dataIntervalId = setInterval(ambilData, 5000);
    
    // Atur interval untuk pengecekan notifikasi
    notificationIntervalId = setInterval(() => {
        checkUnreadCount(); // Ini untuk update angka merah di lonceng
        checkForNewNotifications(); // Ini untuk memicu notifikasi push
        loadNotificationSummary();
    }, 7000); // Cek setiap 7 detik
}
function stopTimers() {
    if (dataIntervalId) clearInterval(dataIntervalId);
    if (notificationIntervalId) clearInterval(notificationIntervalId);
    console.log("Timer dihentikan.");
}

// --- Fungsi Helper ---
function populateHourOptions() {
    const startHourSelect = document.getElementById('filter-hour-start');
    const endHourSelect = document.getElementById('filter-hour-end');
    for (let i = 0; i < 24; i++) {
        const hour = i.toString().padStart(2, '0');
        startHourSelect.innerHTML += `<option value="${hour}">${hour}:00</option>`;
        endHourSelect.innerHTML += `<option value="${hour}">${hour}:00</option>`;
    }
}
function unlockAudioContext() {
    const sound = new Audio('sounds/notification.mp3');
    sound.volume = 0; // Mainkan tanpa suara agar tidak mengganggu
    sound.play().catch(() => {}); // Coba mainkan, abaikan error jika gagal
    
    // Hapus event listener ini setelah berhasil dijalankan sekali
    document.body.removeEventListener('click', unlockAudioContext);
    document.body.removeEventListener('touchstart', unlockAudioContext);
    console.log('Konteks audio sudah dibuka oleh interaksi pengguna.');
}

//=========================
async function loadNotifications() {
    if (!isLoggedIn) return;
    const container = document.getElementById('notification-list-container');
    if (!container) return;
    container.innerHTML = '<p>Memuat notifikasi...</p>';
    try {
        const response = await fetchDataWithAuth('/notifications');
        const notifications = await response.json();
        if (notifications.length === 0) {
            container.innerHTML = '<div class="placeholder-content"><h2>Aman!</h2><p>Tidak ada notifikasi atau peringatan saat ini.</p></div>';
            return;
        }
        container.innerHTML = '';
        notifications.forEach(notif => {
            const card = document.createElement('a');
            card.href = '#maintenance';
            card.className = 'notification-card';
            const time = new Date(notif.timestamp).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
            card.innerHTML = `
                <div class="notification-header">
                    <span class="notification-title">🔥 PERINGATAN TEMPERATUR TINGGI</span>
                    <span class="notification-time">${time}</span>
                </div>
                <div class="notification-body">${notif.message}</div>`;
            
            card.addEventListener('click', (e) => {
                e.preventDefault();
                showPage('maintenance', 'corrective-temp-tinggi');
            });
            container.appendChild(card);
        });
    } catch (error) { console.error('Gagal memuat notifikasi:', error); }
}
function addAppEventListeners() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.overlay');
    const menuToggleTop = document.getElementById('menu-toggle-top');
    const sidebarCloseButton = document.getElementById('sidebar-close-button');
    const notificationBell = document.getElementById('notification-bell');
    notificationDropdown = document.getElementById('notification-dropdown');
    const viewAllLink = document.getElementById('view-all-notifications-link');
    const clearNotifButton = document.getElementById('clear-notifications-button');
    
    menuToggleTop.addEventListener('click', () => { sidebar.classList.toggle('open'); overlay.classList.toggle('active'); });
    sidebarCloseButton.addEventListener('click', () => { sidebar.classList.remove('open'); overlay.classList.remove('active'); });
    overlay.addEventListener('click', () => { 
        sidebar.classList.remove('open'); 
        overlay.classList.remove('active'); 
        notificationDropdown.classList.add('hidden'); 
        document.body.classList.remove('noscroll');
    });
    
    notificationBell.addEventListener('click', (e) => {
        e.stopPropagation();

        // Lakukan toggle seperti biasa untuk menampilkan/menyembunyikan
        notificationDropdown.classList.toggle('hidden');
        
        // Setelah di-toggle, kita cek kondisinya dengan if-else sederhana
        if (!notificationDropdown.classList.contains('hidden')) {
            // JIKA dropdown TERBUKA (tidak punya class 'hidden')
            document.body.classList.add('noscroll'); // Kunci scroll
            populateNotificationDropdown();
            markNotificationsAsRead();
        } else {
            // JIKA dropdown TERTUTUP (punya class 'hidden')
            document.body.classList.remove('noscroll'); // Buka kunci scroll
        }
    });

    viewAllLink.addEventListener('click', (e) => { 
       e.preventDefault(); 
        notificationDropdown.classList.add('hidden'); // <-- Tutup dropdown
        document.body.classList.remove('noscroll');   // <-- Buka kunci scroll
        showPage('notifikasi');  
    });
    if(clearNotifButton) clearNotifButton.addEventListener('click', clearNotifications);

    document.addEventListener('click', (e) => {
        if (notificationDropdown && !notificationDropdown.classList.contains('hidden') && !notificationBell.contains(e.target) && !notificationDropdown.contains(e.target)) {
            notificationDropdown.classList.add('hidden');
            document.body.classList.remove('noscroll'); 
        }
    });

    document.querySelectorAll('.nav-link').forEach(link => { link.addEventListener('click', (e) => { e.preventDefault(); showPage(link.getAttribute('href').substring(1)); sidebar.classList.remove('open'); overlay.classList.remove('active'); }); });
    document.querySelectorAll('.card-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            
            const targetPage = link.dataset.targetPage;
            const href = link.getAttribute('href');
            
            // Cek apakah ada parameter scrollto di link
            if (href.includes('?scrollto=')) {
                const scrollToId = href.split('=')[1];
                showPage(targetPage, scrollToId);
            } else {
                showPage(targetPage);
            }
        });
    });
    document.getElementById('logo-link').addEventListener('click', (e) => { e.preventDefault(); showPage('beranda'); });
    document.getElementById('logout-button').addEventListener('click', (e) => { e.preventDefault(); logout(); });
    const desktopLogoutButton = document.getElementById('logout-button-desktop');
    if (desktopLogoutButton) { desktopLogoutButton.addEventListener('click', (e) => { e.preventDefault(); logout(); }); }
    const statusCard = document.getElementById('device-status-card');
    if (statusCard) { statusCard.addEventListener('click', () => { const statusText = document.getElementById('device-status-text').textContent; if (statusText === 'Offline') { showPage('maintenance', 'troubleshoot-offline'); } else { alert('Perangkat terhubung dengan baik ke sistem.'); } }); }

    const btnToday = document.getElementById('filter-btn-today');
    const btnAllTime = document.getElementById('filter-btn-alltime');
    const btnCustom = document.getElementById('filter-btn-custom');
    const customFilterControls = document.querySelector('.custom-filter-controls');
    
    const allFilterBtns = [btnToday, btnAllTime, btnCustom];

    // Fungsi bantuan untuk mengatur tombol mana yang aktif
    function setActiveButton(activeBtn) {
        allFilterBtns.forEach(btn => {
            if(btn) btn.classList.remove('active');
        });
        if (activeBtn) {
            activeBtn.classList.add('active');
        }
    }

    if (btnToday) {
        btnToday.addEventListener('click', () => {
            setActiveButton(btnToday);
            customFilterControls.classList.add('hidden');
            const start = new Date();
            start.setHours(0, 0, 0, 0);
            const end = new Date();
            updateDashboardWithHistory(start.toISOString(), end.toISOString());
        });
    }

    if (btnAllTime) {
        btnAllTime.addEventListener('click', () => {
            setActiveButton(btnAllTime);
            customFilterControls.classList.add('hidden');
            const start = new Date('2020-01-01'); // Tanggal jauh di masa lalu untuk mengambil semua data
            const end = new Date();
            updateDashboardWithHistory(start.toISOString(), end.toISOString());
        });
    }

    if (btnCustom) {
        btnCustom.addEventListener('click', () => {
            setActiveButton(btnCustom);
            customFilterControls.classList.remove('hidden');
        });
    }

    const mainChartControls = document.querySelector('.main-chart-controls');
    if (mainChartControls) {
        mainChartControls.addEventListener('change', renderMainChart);
    }

    // Otomatis klik tombol "24 Jam Terakhir" saat halaman pertama kali dibuka
    if (localStorage.getItem('token')) {
    // Otomatis klik tombol "24 Jam Terakhir" saat halaman dashboard dimuat
    if(btnToday) 
        btnToday.click();
    }
}
function populateAnalysisOptions() {
    const xSelect = document.getElementById('xAxis-select');
    const ySelect = document.getElementById('yAxis-select');
    analysisOptions.forEach(opt => {
        xSelect.innerHTML += `<option value="${opt.value}">${opt.text}</option>`;
        ySelect.innerHTML += `<option value="${opt.value}">${opt.text}</option>`;
    });
    // Set default value
    xSelect.value = 'windSpeed';
    ySelect.value = 'turbineWattage';
}

// === BAGIAN 3: EVENT LISTENERS ===
document.addEventListener('DOMContentLoaded', () => {
   
    populateHourOptions();
    const applyFilterButton = document.getElementById('apply-filter-button');
    if (applyFilterButton) {
        applyFilterButton.addEventListener('click', () => {
            const startDate = document.getElementById('filter-date-start').value;
            const startHour = document.getElementById('filter-hour-start').value;
            const endDate = document.getElementById('filter-date-end').value;
            const endHour = document.getElementById('filter-hour-end').value;

            if (startDate && startHour && endDate && endHour) {
                const startISO = new Date(`${startDate}T${startHour}:00:00`).toISOString();
                const endISO = new Date(`${endDate}T${endHour}:59:59`).toISOString();
                updateDashboardWithHistory(startISO, endISO);
            } else {
                alert("Silakan lengkapi semua filter tanggal dan jam.");
            }
        });
    }

    UIElements.statusIndicator = document.getElementById('device-status-indicator');
    UIElements.statusText = document.getElementById('device-status-text');
    UIElements.statusCard = document.getElementById('device-status-card');

    // Beranda
    UIElements.plnEnergyBeranda = document.getElementById('pln-energy-beranda');
    UIElements.turbinEnergyBeranda = document.getElementById('turbin-energy-beranda');
    UIElements.rumahEnergyBeranda = document.getElementById('rumah-energy-beranda');
    UIElements.battTempBeranda = document.getElementById('batt-temp-beranda');
    UIElements.battCapFillBeranda = document.getElementById('batt-cap-fill-beranda');
    UIElements.battCapTextBeranda = document.getElementById('batt-cap-text-beranda');
    UIElements.notificationSummaryText = document.getElementById('notification-summary-text'); // Dulu ai-insight-text

    // Dashboard - Live Monitoring
    UIElements.plnWattDetail = document.getElementById('pln-watt-detail');
    UIElements.plnVoltDetail = document.getElementById('pln-volt-detail');
    UIElements.plnAmpereDetail = document.getElementById('pln-ampere-detail');
    UIElements.turbinWattDetail = document.getElementById('turbin-watt-detail');
    UIElements.turbinVoltDetail = document.getElementById('turbin-volt-detail');
    UIElements.turbinAmpereDetail = document.getElementById('turbin-ampere-detail');
    UIElements.turbinSpeedDetail = document.getElementById('turbin-speed-detail');
    UIElements.battTempDetail = document.getElementById('batt-temp-detail');
    UIElements.battCapFillDetail = document.getElementById('batt-cap-fill-detail');
    UIElements.battCapTextDetail = document.getElementById('batt-cap-text-detail');

    // Dashboard - Analisis Historis (kita siapkan sekalian)
    UIElements.plnEnergyDetail = document.getElementById('pln-energy-detail');
    UIElements.turbinEnergyDetail = document.getElementById('turbin-energy-detail');
    UIElements.rumahEnergyDetail = document.getElementById('rumah-energy-detail');

    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const showRegisterLink = document.getElementById('show-register');
    const showLoginLink = document.getElementById('show-login');

    if (showRegisterLink) { showRegisterLink.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('login-card').classList.add('hidden'); document.getElementById('register-card').classList.remove('hidden'); }); }
    if (showLoginLink) { showLoginLink.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('register-card').classList.add('hidden'); document.getElementById('login-card').classList.remove('hidden'); }); }

    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('register-username').value;
            const password = document.getElementById('register-password').value;
            const registrationCode = document.getElementById('register-code').value;
            try {
                const response = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, registrationCode }) });
                const data = await response.json();
                if (!response.ok) throw new Error(data.message);
                alert('Registrasi berhasil! Silakan login.');
                showLoginLink.click();
            } catch (error) { alert(`Error: ${error.message}`); }
        });
    }
    
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('login-username').value;
            const password = document.getElementById('login-password').value;
            try {
                const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
                const data = await response.json();
                if (!response.ok) throw new Error(data.message);
                localStorage.setItem('token', data.token);
                showApp();
            } catch (error) { alert(`Error: ${error.message}`); }
        });
    }

    const token = localStorage.getItem('token');
    if (token) {
        showApp();
    } else {
        isLoggedIn = false;
        showAuth();
    }
    // Panggil fungsi untuk mengisi dropdown analisis
    populateAnalysisOptions(); 

    // Hubungkan tombol "Buat Grafik"
    document.getElementById('generate-analysis-chart').addEventListener('click', drawAnalysisChart);

    //
    const columnFilter = document.querySelector('.column-filter-controls');
    if(columnFilter){
        columnFilter.addEventListener('change', renderHistoryTable);
    }

    // download PDF
    const downloadPdfButton = document.getElementById('download-pdf-button');
    if (downloadPdfButton) {
        downloadPdfButton.addEventListener('click', () => {
            const startDate = document.getElementById('filter-date-start').value;
            const startHour = document.getElementById('filter-hour-start').value;
            const endDate = document.getElementById('filter-date-end').value;
            const endHour = document.getElementById('filter-hour-end').value;

            if (startDate && startHour && endDate && endHour) {
                const startISO = new Date(`${startDate}T${startHour}:00:00`).toISOString();
                const endISO = new Date(`${endDate}T${endHour}:59:59`).toISOString();
                const token = localStorage.getItem('token');
                
                // Ambil kolom yang aktif dari checkbox
                const visibleColumns = [];
                document.querySelectorAll('.column-filter-controls input:checked').forEach(cb => visibleColumns.push(cb.value));

                // Tambahkan kolom ke URL
                const downloadUrl = `/download-pdf?startDate=${startISO}&endDate=${endISO}&token=${token}&columns=${visibleColumns.join(',')}`;

                // Buka URL di tab baru untuk memicu download
                window.open(downloadUrl, '_blank');
            } else {
                alert("Silakan lengkapi filter tanggal dan jam terlebih dahulu.");
            }
        });
    }

    const berandaFilter = document.getElementById('beranda-energy-filter');
    if (berandaFilter) {
        berandaFilter.addEventListener('change', async (e) => {
            const selection = e.target.value;
            let endpoint = selection === 'alltime' ? '/data' : '/data/today-summary';
            try {
                const response = await fetchDataWithAuth(`${endpoint}`);
                const data = await response.json();
                const totalPln = data.totalPlnKwh || 0;
                const totalTurbin = data.totalTurbineKwh || 0;
                if (UIElements.plnEnergyBeranda) UIElements.plnEnergyBeranda.textContent = totalPln.toFixed(2);
                if (UIElements.turbinEnergyBeranda) UIElements.turbinEnergyBeranda.textContent = totalTurbin.toFixed(2);
                if (UIElements.rumahEnergyBeranda) UIElements.rumahEnergyBeranda.textContent = (totalPln + totalTurbin).toFixed(2);
            } catch (error) {
                console.error("Gagal update energi beranda:", error);
            }
        });
        berandaFilter.dispatchEvent(new Event('change'));
    }

    

    // Tambahkan listener untuk interaksi pertama
    document.body.addEventListener('click', unlockAudioContext);
    document.body.addEventListener('touchstart', unlockAudioContext); // Untuk mobile
});
