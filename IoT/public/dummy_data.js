function generateRealisticSocForecast() {
    console.log("Membuat data prediksi SOC dinamis...");
    const forecastData = [];
    const now = new Date();

    // Mulai dari jam terdekat
    let currentTimestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());

    // Asumsi SOC awal adalah 100%
    let currentSoc = 100.0;
    // Status awal: baterai harus turun dari 100%
    let chargingStatus = 'discharging';

    // Buat data untuk 7 hari ke depan (7 * 24 jam)
    for (let i = 0; i < 7 * 24; i++) {
        let socChange = 0;

        // --- LOGIKA BARU TANPA PENGATURAN JAM ---
        
        // Jika statusnya 'discharging', selalu buat perubahan negatif (turun).
        if (chargingStatus === 'discharging') {
            socChange = -Math.random() * 13; // Turun secara acak 0 - 2.5% per jam
        } 
        // Jika statusnya 'charging', selalu buat perubahan positif (naik).
        else { // chargingStatus === 'charging'
            socChange = Math.random() * 7; // Naik secara acak 0 - 2.5% per jam
        }

        // Terapkan perubahan SOC
        currentSoc += socChange;

        // Cek Batas dan Ubah Arah
        // Jika SOC menyentuh atau melewati batas bawah (20%), atur ke 20 dan mulai mengisi.
        if (currentSoc <= 20) {
            currentSoc = 20;
            chargingStatus = 'charging'; // Balikkan arah menjadi NAIK
        } 
        // Jika SOC menyentuh atau melewati batas atas (100%), atur ke 100 dan mulai mengosongkan.
        else if (currentSoc >= 100) {
            currentSoc = 100;
            chargingStatus = 'discharging'; // Balikkan arah menjadi TURUN
        }

        // Tambahkan data ke array
        forecastData.push({
            timestamp: currentTimestamp.toISOString(),
            predicted_soc: parseFloat(currentSoc.toFixed(2))
        });

        // Maju ke jam berikutnya
        currentTimestamp.setHours(currentTimestamp.getHours() + 1);
    }

    return forecastData;
}

// Jalankan fungsi untuk membuat data saat script dimuat
const dummySocPredictionData = generateRealisticSocForecast();

// Untuk melihat hasilnya di konsol (opsional)
console.log(dummySocPredictionData);