const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const DB_FILE = path.join(DATA_DIR, 'training-database.json');

// Ensure storage directories exist
[DATA_DIR, UPLOADS_DIR, BACKUPS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Default initial database state
const getInitialState = () => ({
  records: [],
  positions: [],
  calendar: [],
  cqs: [],
  tests: [],
  teams: [],
  teamSettings: { co: '', date: '', eff: '', pre: 'APT', by: '', byPos: '' },
  ncs: [],
  docControl: null,
  accounts: [],
  customTypes: [],
  lastUpdated: new Date().toISOString()
});

// Load database from file with fallback
function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const data = JSON.parse(raw);
      return {
        records: Array.isArray(data.records) ? data.records : [],
        positions: Array.isArray(data.positions) ? data.positions : [],
        calendar: Array.isArray(data.calendar) ? data.calendar : [],
        cqs: Array.isArray(data.cqs) ? data.cqs : [],
        tests: Array.isArray(data.tests) ? data.tests : [],
        teams: Array.isArray(data.teams) ? data.teams : [],
        teamSettings: (data.teamSettings && typeof data.teamSettings === 'object') ? data.teamSettings : { co: '', date: '', eff: '', pre: 'APT', by: '', byPos: '' },
        ncs: Array.isArray(data.ncs) ? data.ncs : [],
        docControl: data.docControl || null,
        accounts: Array.isArray(data.accounts) ? data.accounts : [],
        customTypes: Array.isArray(data.customTypes) ? data.customTypes : [],
        lastUpdated: data.lastUpdated || new Date().toISOString()
      };
    }
  } catch (err) {
    console.error('[MHC Server] Error reading DB file:', err.message);
  }
  const init = getInitialState();
  saveDatabase(init);
  return init;
}

// Atomic save database to disk
function saveDatabase(data) {
  try {
    data.lastUpdated = new Date().toISOString();
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempFile, DB_FILE);
    return true;
  } catch (err) {
    console.error('[MHC Server] Atomic rename failed:', err.message);
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('[MHC Server] Direct write failed:', e.message);
      return false;
    }
  }
}

// Snapshot backup creator (throttled to once an hour or on explicit backup)
let lastBackupTime = 0;
function createBackupSnapshot(data, force = false) {
  const now = Date.now();
  if (!force && now - lastBackupTime < 3600000) return; // 1 hour throttle
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUPS_DIR, `snapshot-${timestamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(data, null, 2), 'utf8');
    lastBackupTime = now;

    // Keep only last 15 backups to conserve disk
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
      .sort();
    while (files.length > 15) {
      const old = files.shift();
      try { fs.unlinkSync(path.join(BACKUPS_DIR, old)); } catch (e) {}
    }
  } catch (err) {
    console.warn('[MHC Server] Backup snapshot warning:', err.message);
  }
}

// Generic entity merger by identifier
function mergeCollection(serverItems, incomingItems, idKey = 'id') {
  if (!Array.isArray(incomingItems)) return serverItems;
  const map = new Map();

  serverItems.forEach(item => {
    if (item) {
      const key = item[idKey] || (item.name ? item.name : JSON.stringify(item));
      map.set(key, { ...item });
    }
  });

  incomingItems.forEach(item => {
    if (!item) return;
    const key = item[idKey] || (item.name ? item.name : JSON.stringify(item));
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...item });
    } else {
      map.set(key, { ...existing, ...item });
    }
  });

  return Array.from(map.values());
}

// Full database merger
function mergeDatabase(currentDB, incoming) {
  const updated = { ...currentDB };

  if (Array.isArray(incoming.records)) {
    updated.records = mergeCollection(updated.records, incoming.records, 'id');
  }
  if (Array.isArray(incoming.positions)) {
    updated.positions = mergeCollection(updated.positions, incoming.positions, 'name');
  }
  if (Array.isArray(incoming.calendar)) {
    updated.calendar = mergeCollection(updated.calendar, incoming.calendar, 'id');
  }
  if (Array.isArray(incoming.cqs)) {
    updated.cqs = mergeCollection(updated.cqs, incoming.cqs, 'id');
  }
  if (Array.isArray(incoming.tests)) {
    updated.tests = mergeCollection(updated.tests, incoming.tests, 'id');
  }
  if (Array.isArray(incoming.teams)) {
    updated.teams = mergeCollection(updated.teams, incoming.teams, 'name');
  }
  if (incoming.teamSettings && typeof incoming.teamSettings === 'object') {
    updated.teamSettings = { ...updated.teamSettings, ...incoming.teamSettings };
  }
  if (Array.isArray(incoming.ncs)) {
    updated.ncs = mergeCollection(updated.ncs, incoming.ncs, 'no');
  }
  if (incoming.docControl && typeof incoming.docControl === 'object') {
    updated.docControl = { ...updated.docControl, ...incoming.docControl };
  }
  if (Array.isArray(incoming.accounts)) {
    updated.accounts = mergeCollection(updated.accounts, incoming.accounts, 'u');
  }
  if (Array.isArray(incoming.customTypes)) {
    const set = new Set([...(updated.customTypes || []), ...incoming.customTypes]);
    updated.customTypes = Array.from(set);
  }

  return updated;
}

// MIME types map
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  // Global CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = parsedUrl.pathname;

  // JSON API Helper
  const sendJSON = (statusCode, data) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };

  // Helper to read JSON request body
  const readJSONBody = (callback) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 50 * 1024 * 1024) { // 50MB limit
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        callback(null, parsed);
      } catch (err) {
        callback(err, null);
      }
    });
  };

  // API ROUTING

  // 1. Healthcheck
  if (pathname === '/api/health') {
    return sendJSON(200, {
      status: 'ok',
      service: 'MHC Employee Training & Competency System',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  }

  // 2. Full Sync (GET: fetch cloud data, POST: push and merge)
  if (pathname === '/api/sync' || pathname === '/api/data') {
    if (req.method === 'GET') {
      const db = loadDatabase();
      return sendJSON(200, {
        ok: true,
        data: db,
        timestamp: db.lastUpdated
      });
    }

    if (req.method === 'POST') {
      readJSONBody((err, incoming) => {
        if (err) return sendJSON(400, { ok: false, error: 'Invalid JSON body' });

        const currentDB = loadDatabase();
        const mergedDB = mergeDatabase(currentDB, incoming);
        const success = saveDatabase(mergedDB);
        createBackupSnapshot(mergedDB);

        if (!success) {
          return sendJSON(500, { ok: false, error: 'Failed to write to persistent database' });
        }

        return sendJSON(200, {
          ok: true,
          message: 'Cloud sync successful',
          lastUpdated: mergedDB.lastUpdated,
          counts: {
            records: mergedDB.records.length,
            positions: mergedDB.positions.length,
            calendar: mergedDB.calendar.length,
            cqs: mergedDB.cqs.length,
            tests: mergedDB.tests.length,
            teams: mergedDB.teams.length,
            ncs: mergedDB.ncs.length
          }
        });
      });
      return;
    }
  }

  // 3. Upload Certificate / Attachment (Base64 handler)
  if (pathname === '/api/upload' && req.method === 'POST') {
    readJSONBody((err, payload) => {
      if (err || !payload.data) {
        return sendJSON(400, { ok: false, error: 'Missing base64 data' });
      }

      try {
        const matches = payload.data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        let ext = '.png';
        let buffer;

        if (matches && matches.length === 3) {
          const mime = matches[1];
          if (mime === 'image/jpeg') ext = '.jpg';
          else if (mime === 'image/svg+xml') ext = '.svg';
          else if (mime === 'application/pdf') ext = '.pdf';
          buffer = Buffer.from(matches[2], 'base64');
        } else {
          buffer = Buffer.from(payload.data, 'base64');
        }

        const filename = `cert-${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`;
        const filePath = path.join(UPLOADS_DIR, filename);
        fs.writeFileSync(filePath, buffer);

        return sendJSON(200, {
          ok: true,
          filename: filename,
          url: `/uploads/${filename}`
        });
      } catch (uploadErr) {
        return sendJSON(500, { ok: false, error: uploadErr.message });
      }
    });
    return;
  }

  // 4. Download Backup JSON
  if (pathname === '/api/backup' && req.method === 'GET') {
    const db = loadDatabase();
    const dateStr = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="MHC-Training-Competency-Backup-${dateStr}.json"`
    });
    res.end(JSON.stringify(db, null, 2));
    return;
  }

  // 5. Restore Backup JSON
  if (pathname === '/api/backup/restore' && req.method === 'POST') {
    readJSONBody((err, payload) => {
      if (err || !payload) return sendJSON(400, { ok: false, error: 'Invalid backup file' });
      const success = saveDatabase(payload);
      if (success) {
        createBackupSnapshot(payload, true);
        return sendJSON(200, { ok: true, message: 'Database successfully restored from backup' });
      }
      return sendJSON(500, { ok: false, error: 'Could not restore backup' });
    });
    return;
  }

  // STATIC FILE SERVING
  let safePath = pathname;
  if (safePath === '/' || safePath === '/index.html' || safePath === '') {
    safePath = '/index.html';
  }

  // Handle uploaded files
  let filePath;
  if (safePath.startsWith('/uploads/')) {
    filePath = path.join(UPLOADS_DIR, path.basename(safePath));
  } else {
    filePath = path.join(ROOT_DIR, safePath);
  }

  // Fallback to Employee_Training_and_Competency.html if index.html is requested but doesn't exist yet
  if (!fs.existsSync(filePath) && safePath === '/index.html') {
    filePath = path.join(ROOT_DIR, 'Employee_Training_and_Competency.html');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // 404 handler
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found - May Harvest Corporation');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': ext === '.html' ? 'no-cache, no-store, must-revalidate' : 'public, max-age=86400'
    });

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  May Harvest Corporation - Employee Training System   `);
  console.log(`  Server running on http://localhost:${PORT}          `);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Cloud Sync & API ready                               `);
  console.log(`=======================================================`);
});
