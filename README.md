# WhatsApp API Backend

Backend API WhatsApp menggunakan Node.js dan Baileys dengan dukungan multiple session, webhook, dan berbagai fitur lengkap.

## 🌟 Fitur Utama

### 📱 Koneksi & Autentikasi
- ✅ Multiple session WhatsApp
- ✅ Login dengan QR Code
- ✅ Login dengan Pairing Code
- ✅ Auto reconnect dengan retry mechanism
- ✅ Session management yang robust
- ✅ Status monitoring (connected, disconnected, banned)

### 💬 Messaging
- ✅ Kirim pesan teks
- ✅ Kirim media (gambar, video, audio, dokumen)
- ✅ Kirim lokasi
- ✅ Kirim kontak
- ✅ Kirim reaction
- ✅ Forward pesan
- ✅ Edit pesan
- ✅ Hapus pesan
- ✅ Download media
- ✅ Poll messages
- ✅ List messages (interactive)
- ✅ Button messages

### 👥 Group Management
- ✅ Buat group
- ✅ Tambah/hapus anggota
- ✅ Promote/demote admin
- ✅ Update nama group
- ✅ Update deskripsi group
- ✅ Keluar dari group
- ✅ Get invite code
- ✅ Revoke invite code

### 👤 Contact & Profile
- ✅ Daftar kontak
- ✅ Info profil kontak
- ✅ Block/unblock kontak
- ✅ Update nama profil
- ✅ Update status profil
- ✅ Update foto profil
- ✅ Privacy settings

### 🔧 Konfigurasi Fleksibel
- ✅ Country code default
- ✅ Webhook URL dengan retry
- ✅ Delay kustomisasi (typing, pesan, webhook)
- ✅ Auto read messages
- ✅ Show typing indicator
- ✅ Check nomor sebelum kirim
- ✅ Rate limiting

### 🎯 Webhook Integration
- ✅ Real-time webhook notifications
- ✅ Retry mechanism untuk webhook
- ✅ Webhook statistics
- ✅ Custom webhook events
- ✅ Batch webhook sending

## 🚀 Instalasi

### Prerequisites
- Node.js >= 18.0.0
- NPM atau Yarn

### Clone Repository
```bash
git clone https://github.com/yourusername/wa-api-backend.git
cd wa-api-backend
```

### Install Dependencies
```bash
npm install
```

### Setup Environment
```bash
cp .env.example .env
```

Edit file `.env` sesuai konfigurasi Anda:
```env
# Server Configuration
PORT=3000
NODE_ENV=development
API_KEY=your_secure_api_key_here

# Default WhatsApp Configuration
DEFAULT_COUNTRY_CODE=62
DEFAULT_WEBHOOK_URL=http://localhost:3001/webhook
DEFAULT_WEBHOOK_DELAY=1000
DEFAULT_MESSAGE_DELAY=2000
DEFAULT_AUTO_READ=false
DEFAULT_SHOW_TYPING=true
```

### Jalankan Server
```bash
# Development
npm run dev

# Production
npm start
```

Server akan berjalan di `http://localhost:3000`

## 📚 API Documentation

### Authentication Headers
Semua request memerlukan API key:
```http
x-api-key: your_api_key_here
# atau
Authorization: Bearer your_api_key_here
```

### Endpoints Utama

#### 🔐 Authentication
- `POST /api/auth/create-session` - Buat session baru
- `POST /api/auth/connect` - Hubungkan ke WhatsApp  
- `GET /api/auth/qr/:sessionId` - Dapatkan QR code
- `GET /api/auth/status/:sessionId` - Status session
- `POST /api/auth/disconnect` - Putuskan koneksi
- `POST /api/auth/logout` - Logout session

#### 💬 Messages
- `POST /api/message/send-text` - Kirim pesan teks
- `POST /api/message/send-media` - Kirim media
- `POST /api/message/send-location` - Kirim lokasi
- `POST /api/message/send-contact` - Kirim kontak
- `POST /api/message/send-reaction` - Kirim reaction
- `POST /api/message/forward` - Forward pesan
- `POST /api/message/delete` - Hapus pesan
- `POST /api/message/edit` - Edit pesan

#### 👥 Groups
- `POST /api/group/create` - Buat group
- `POST /api/group/add-participant` - Tambah anggota
- `POST /api/group/remove-participant` - Hapus anggota
- `POST /api/group/update-subject` - Update nama group
- `GET /api/group/info/:sessionId/:groupId` - Info group

#### 👤 Contacts
- `GET /api/contact/list/:sessionId` - Daftar kontak
- `POST /api/contact/block` - Block kontak
- `POST /api/contact/unblock` - Unblock kontak
- `GET /api/contact/profile/:sessionId/:jid` - Profil kontak

#### 📊 Status & Profile
- `POST /api/status/update-presence` - Update presence
- `POST /api/status/update-profile-name` - Update nama
- `POST /api/status/update-profile-picture` - Update foto profil

#### 🎯 Webhooks
- `POST /api/webhook/test` - Test webhook
- `GET /api/webhook/stats/:sessionId` - Statistik webhook
- `POST /api/webhook/clear-pending` - Clear pending webhook

## 🔧 Contoh Penggunaan

### 1. Buat Session Baru
```javascript
const response = await fetch('http://localhost:3000/api/auth/create-session', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'your_api_key'
  },
  body: JSON.stringify({
    sessionId: 'my_session',
    config: {
      countryCode: '62',
      webhookUrl: 'https://yourwebsite.com/webhook',
      autoRead: true,
      showTyping: true,
      messageDelay: 2000
    }
  })
});

const result = await response.json();
console.log(result);
```

### 2. Hubungkan ke WhatsApp
```javascript
const response = await fetch('http://localhost:3000/api/auth/connect', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'your_api_key'
  },
  body: JSON.stringify({
    sessionId: 'my_session'
  })
});
```

### 3. Dapatkan QR Code
```javascript
const response = await fetch('http://localhost:3000/api/auth/qr/my_session', {
  headers: {
    'x-api-key': 'your_api_key'
  }
});

const result = await response.json();
// result.data.qr berisi base64 QR code
```

### 4. Kirim Pesan Teks
```javascript
const response = await fetch('http://localhost:3000/api/message/send-text', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'your_api_key'
  },
  body: JSON.stringify({
    sessionId: 'my_session',
    to: '628123456789', // atau ['628123456789', '628987654321'] untuk multiple
    text: 'Hello World! 👋'
  })
});

const result = await response.json();
console.log(result);
```

### 5. Kirim Media
```javascript
const formData = new FormData();
formData.append('sessionId', 'my_session');
formData.append('to', '628123456789');
formData.append('type', 'image');
formData.append('caption', 'Foto keren nih!');
formData.append('media', fileInput.files[0]);

const response = await fetch('http://localhost:3000/api/message/send-media', {
  method: 'POST',
  headers: {
    'x-api-key': 'your_api_key'
  },
  body: formData
});
```

### 6. Webhook Handler
Buat endpoint untuk menerima webhook:
```javascript
app.post('/webhook', (req, res) => {
  const { sessionId, event, data } = req.body;
  
  console.log(`Event ${event} dari session ${sessionId}:`, data);
  
  switch(event) {
    case 'message_received':
      // Handle pesan masuk
      break;
    case 'qr_generated':
      // Handle QR code baru
      break;
    case 'connected':
      // Handle koneksi berhasil
      break;
    // ... handle events lainnya
  }
  
  res.json({ success: true });
});
```

## 🎨 Format Nomor Telepon

API mendukung berbagai format nomor:
- `08123456789` → otomatis jadi `628123456789`
- `628123456789` → tetap `628123456789`
- `+628123456789` → jadi `628123456789`

Multiple nomor (pisahkan dengan koma):
- `08123456789,08987654321`
- `["628123456789", "628987654321"]`

## 🔄 Webhook Events

### Connection Events
- `qr_generated` - QR code dibuat
- `connected` - Berhasil terhubung
- `connection_closed` - Koneksi terputus

### Message Events
- `message_received` - Pesan diterima
- `message_updated` - Status pesan berubah
- `message_sent` - Pesan terkirim
- `message_deleted` - Pesan dihapus
- `message_edited` - Pesan diedit

### Group Events
- `group_updated` - Info group berubah
- `group_participants_update` - Anggota berubah

### Contact Events
- `contacts_update` - Kontak berubah
- `presence_update` - Status online berubah

## 🛠️ Konfigurasi Session

Setiap session dapat dikonfigurasi secara terpisah:

```javascript
{
  "countryCode": "62",              // Kode negara default
  "webhookUrl": "https://...",      // URL webhook
  "webhookDelay": 1000,             // Delay webhook (ms)
  "messageDelay": 2000,             // Delay antar pesan (ms)
  "typingDelay": 1500,              // Durasi typing (ms)
  "pauseDelay": 500,                // Jeda setelah typing (ms)
  "readMessageDelay": 3000,         // Delay baca pesan (ms)
  "showTyping": true,               // Tampilkan typing
  "autoRead": false,                // Auto baca pesan
  "checkNumber": true               // Cek nomor sebelum kirim
}
```

## 📊 Monitoring & Logs

### Health Check
```bash
GET http://localhost:3000/health
```

### Session Status
```bash
GET http://localhost:3000/api/auth/status/my_session
```

### Webhook Statistics
```bash
GET http://localhost:3000/api/webhook/stats/my_session
```

### Logs
Logs tersimpan di folder `logs/`:
- `app.log` - Log aplikasi umum
- `error.log` - Log error
- `webhook.log` - Log webhook
- `whatsapp.log` - Log WhatsApp events

## 🔒 Security

### API Key
Pastikan menggunakan API key yang kuat:
```env
API_KEY=your_very_secure_random_api_key_here
```

### Rate Limiting
- Global: 100 requests per 15 menit
- Per session: 30 requests per menit
- Upload: 10 files per menit

### CORS
CORS dikonfigurasi untuk menerima request dari semua origin dalam development. Untuk production, pastikan mengatur origin yang spesifik.

## 🐳 Docker Deployment

### Dockerfile
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### Docker Compose
```yaml
version: '3.8'
services:
  wa-api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - API_KEY=your_secure_api_key
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    restart: unless-stopped
```

## 🔧 Troubleshooting

### Session Tidak Terhubung
1. Pastikan QR code discan dalam 60 detik
2. Periksa koneksi internet
3. Cek logs untuk error details
4. Restart session jika perlu

### Webhook Tidak Terkirim
1. Test webhook URL dengan `/api/webhook/test`
2. Periksa firewall dan network
3. Cek webhook statistics
4. Clear pending webhooks jika terlalu banyak

### Memory Usage Tinggi
1. Monitor dengan `/health` endpoint
2. Cleanup session tidak aktif
3. Restart service secara berkala
4. Periksa file logs yang terlalu besar

## 📈 Performance Tips

1. **Batch Messages**: Gunakan array untuk multiple recipients
2. **Webhook Optimization**: Set delay yang optimal untuk webhook
3. **Session Cleanup**: Hapus session yang tidak digunakan
4. **Media Compression**: Kompres media sebelum upload
5. **Rate Limiting**: Respect WhatsApp rate limits

## 🤝 Contributing

1. Fork repository
2. Buat feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push ke branch (`git push origin feature/amazing-feature`)
5. Buat Pull Request

## 📝 License

MIT License - lihat file [LICENSE](LICENSE) untuk details.

## 🙏 Acknowledgments

- [Baileys](https://github.com/WhiskeySockets/Baileys) - WhatsApp Web API library
- [Express](https://expressjs.com/) - Web framework
- [Winston](https://github.com/winstonjs/winston) - Logging library

## 📞 Support

- 📧 Email: your.email@example.com
- 💬 WhatsApp: +628123456789
- 🐛 Issues: [GitHub Issues](https://github.com/yourusername/wa-api-backend/issues)

---

**⚠️ Disclaimer**: Penggunaan API ini harus mematuhi [Terms of Service WhatsApp](https://www.whatsapp.com/legal/terms-of-service). Penggunaan untuk spam atau aktivitas ilegal lainnya dilarang keras.