const fs = require('fs');
const path = require('path');

// Folder root, jangan buat ulang
const BASE_DIR = '.';

const structure = {
    'config': ['database.js', 'default.js', 'validation.js'],
    'controllers': [
        'authController.js',
        'messageController.js',
        'groupController.js',
        'contactController.js',
        'statusController.js',
        'webhookController.js'
    ],
    'middleware': ['auth.js', 'validation.js', 'rateLimit.js', 'error.js'],
    'models': ['Session.js', 'Message.js', 'Contact.js', 'Webhook.js'],
    'routes': [
        'index.js',
        'auth.js',
        'message.js',
        'group.js',
        'contact.js',
        'status.js',
        'webhook.js'
    ],
    'services': [
        'whatsappService.js',
        'sessionManager.js',
        'messageService.js',
        'webhookService.js',
        'utilityService.js',
        'mediaService.js'
    ],
    'utils': ['logger.js', 'helper.js', 'phoneFormatter.js', 'qrGenerator.js'],
    'data': {
        'sessions': {
            'session1': null,
            'session2': null
        },
        'uploads': null
    },
    'logs': ['app.log', 'error.log', 'webhook.log'],
    '.gitignore': '',
    '.env': '',
    'package.json': '',
    'server.js': '',
    'README.md': ''
};

// ✅ fix: periksa array dulu, baru object
function createStructure(base, obj) {
    for (const name in obj) {
        const fullPath = path.join(base, name);
        if (Array.isArray(obj[name])) {
            if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath);
            obj[name].forEach(file => {
                const filePath = path.join(fullPath, file);
                fs.writeFileSync(filePath, `// ${file}`);
            });
        } else if (typeof obj[name] === 'object' && obj[name] !== null) {
            if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
            createStructure(fullPath, obj[name]);
        } else {
            fs.writeFileSync(path.join(base, name), `// ${name}`);
        }
    }
}

createStructure(BASE_DIR, structure);
console.log('✅ Struktur folder & file di dalam wa-api-backend berhasil dibuat!');
