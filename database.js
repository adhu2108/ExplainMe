const fs = require('fs');
const path = require('path');

let dbInstance = null;
let isFallback = false;
let fallbackData = {
  users: [],
  user_social_accounts: [],
  phone_verifications: [],
  email_verifications: [],
  login_history: [],
  user_sessions: [],
  contracts: [],
  contract_clauses: []
};

const FALLBACK_FILE = path.join(__dirname, 'explainme_fallback.json');

// Helper to save JSON database
function saveFallback() {
  try {
    fs.writeFileSync(FALLBACK_FILE, JSON.stringify(fallbackData, null, 2));
  } catch (err) {
    console.error('Failed to write JSON DB fallback:', err);
  }
}

// Helper to load JSON database
function loadFallback() {
  if (fs.existsSync(FALLBACK_FILE)) {
    try {
      const content = fs.readFileSync(FALLBACK_FILE, 'utf8');
      fallbackData = JSON.parse(content);
    } catch (err) {
      console.error('Failed to read JSON DB fallback, starting fresh:', err);
    }
  } else {
    saveFallback();
  }
}

// Check if sqlite3 can be loaded
let sqlite3;
try {
  sqlite3 = require('sqlite3').verbose();
  console.log('Database: SQLite3 driver loaded successfully.');
} catch (err) {
  console.warn('Database: SQLite3 native module failed to load. Falling back to JSON-file database.');
  isFallback = true;
  loadFallback();
}

function initDB() {
  return new Promise((resolve, reject) => {
    if (isFallback) {
      console.log('Database: Initializing JSON fallback database.');
      return resolve(true);
    }

    const dbPath = path.join(__dirname, 'explainme.db');
    dbInstance = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Database: SQLite connection failed. Switching to JSON fallback.', err);
        isFallback = true;
        loadFallback();
        return resolve(true);
      }

      // Enable foreign keys
      dbInstance.run('PRAGMA foreign_keys = ON');

      // Create Tables
      const schema = `
        CREATE TABLE IF NOT EXISTS Users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          phone TEXT UNIQUE,
          password_hash TEXT,
          two_factor_enabled INTEGER DEFAULT 0,
          two_factor_secret TEXT,
          country TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS UserSocialAccounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          provider TEXT NOT NULL,
          provider_user_id TEXT NOT NULL,
          connected_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES Users(id) ON DELETE CASCADE,
          UNIQUE(provider, provider_user_id)
        );

        CREATE TABLE IF NOT EXISTS PhoneVerifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone TEXT NOT NULL,
          code TEXT NOT NULL,
          type TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          attempts INTEGER DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS EmailVerifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL,
          code TEXT NOT NULL,
          type TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          attempts INTEGER DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS LoginHistory (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          ip_address TEXT,
          user_agent TEXT,
          device TEXT,
          browser TEXT,
          os TEXT,
          status TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES Users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS UserSessions (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          token TEXT NOT NULL,
          ip_address TEXT,
          user_agent TEXT,
          device TEXT,
          os TEXT,
          browser TEXT,
          is_active INTEGER DEFAULT 1,
          last_activity TEXT DEFAULT CURRENT_TIMESTAMP,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES Users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS Contracts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          filename TEXT NOT NULL,
          analyzed_at TEXT DEFAULT CURRENT_TIMESTAMP,
          critical_count INTEGER DEFAULT 0,
          warning_count INTEGER DEFAULT 0,
          compliant_count INTEGER DEFAULT 0,
          FOREIGN KEY(user_id) REFERENCES Users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS ContractClauses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contract_id INTEGER NOT NULL,
          clause_title TEXT NOT NULL,
          clause_text TEXT NOT NULL,
          risk_level TEXT NOT NULL,
          analysis TEXT NOT NULL,
          recommendation TEXT NOT NULL,
          FOREIGN KEY(contract_id) REFERENCES Contracts(id) ON DELETE CASCADE
        );
      `;

      // Split the schema commands
      const statements = schema.split(';').map(s => s.trim()).filter(s => s.length > 0);
      
      let completed = 0;
      if (statements.length === 0) return resolve(true);

      statements.forEach((stmt) => {
        dbInstance.run(stmt, (runErr) => {
          if (runErr) {
            console.error('Error executing database schema statement:', stmt, runErr);
            return reject(runErr);
          }
          completed++;
          if (completed === statements.length) {
            console.log('Database: SQLite tables checked/created successfully.');
            resolve(true);
          }
        });
      });
    });
  });
}

// Database helper operations
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (isFallback) {
      // Parse query and perform basic JSON emulation
      try {
        const sqlUpper = sql.trim().toUpperCase();
        if (sqlUpper.startsWith('INSERT INTO')) {
          // Identify table
          const tableName = sql.match(/INSERT\s+INTO\s+(\w+)/i)[1].toLowerCase();
          const columnsMatch = sql.match(/\(([^)]+)\)\s+VALUES/i);
          const cols = columnsMatch ? columnsMatch[1].split(',').map(c => c.trim()) : [];
          
          const record = {};
          if (tableName === 'users') {
            record.id = fallbackData.users.length + 1;
            cols.forEach((col, idx) => { record[col.toLowerCase()] = params[idx]; });
            record.created_at = new Date().toISOString();
            record.two_factor_enabled = record.two_factor_enabled || 0;
            fallbackData.users.push(record);
            saveFallback();
            resolve({ lastID: record.id, changes: 1 });
          } else if (tableName === 'usersocialaccounts') {
            record.id = fallbackData.user_social_accounts.length + 1;
            cols.forEach((col, idx) => { record[col.toLowerCase()] = params[idx]; });
            record.connected_at = new Date().toISOString();
            fallbackData.user_social_accounts.push(record);
            saveFallback();
            resolve({ lastID: record.id, changes: 1 });
          } else if (tableName === 'phoneverifications') {
            record.id = fallbackData.phone_verifications.length + 1;
            cols.forEach((col, idx) => { record[col.toLowerCase()] = params[idx]; });
            record.created_at = new Date().toISOString();
            record.attempts = record.attempts || 0;
            fallbackData.phone_verifications.push(record);
            saveFallback();
            resolve({ lastID: record.id, changes: 1 });
          } else if (tableName === 'emailverifications') {
            record.id = fallbackData.email_verifications.length + 1;
            cols.forEach((col, idx) => { record[col.toLowerCase()] = params[idx]; });
            record.created_at = new Date().toISOString();
            record.attempts = record.attempts || 0;
            fallbackData.email_verifications.push(record);
            saveFallback();
            resolve({ lastID: record.id, changes: 1 });
          } else if (tableName === 'loginhistory') {
            record.id = fallbackData.login_history.length + 1;
            cols.forEach((col, idx) => { record[col.toLowerCase()] = params[idx]; });
            record.created_at = new Date().toISOString();
            fallbackData.login_history.push(record);
            saveFallback();
            resolve({ lastID: record.id, changes: 1 });
          } else if (tableName === 'usersessions') {
            cols.forEach((col, idx) => { record[col.toLowerCase()] = params[idx]; });
            record.is_active = record.is_active || 1;
            record.created_at = new Date().toISOString();
            record.last_activity = new Date().toISOString();
            fallbackData.user_sessions.push(record);
            saveFallback();
            resolve({ lastID: record.id, changes: 1 });
          } else if (tableName === 'contracts') {
            record.id = fallbackData.contracts.length + 1;
            cols.forEach((col, idx) => { record[col.toLowerCase()] = params[idx]; });
            record.analyzed_at = new Date().toISOString();
            record.critical_count = record.critical_count || 0;
            record.warning_count = record.warning_count || 0;
            record.compliant_count = record.compliant_count || 0;
            fallbackData.contracts.push(record);
            saveFallback();
            resolve({ lastID: record.id, changes: 1 });
          } else if (tableName === 'contractclauses') {
            record.id = fallbackData.contract_clauses.length + 1;
            cols.forEach((col, idx) => { record[col.toLowerCase()] = params[idx]; });
            fallbackData.contract_clauses.push(record);
            saveFallback();
            resolve({ lastID: record.id, changes: 1 });
          } else {
            reject(new Error(`Fallback: Unknown table ${tableName}`));
          }
        } else if (sqlUpper.startsWith('UPDATE')) {
          const tableName = sql.match(/UPDATE\s+(\w+)/i)[1].toLowerCase();
          const records = fallbackData[tableName === 'usersocialaccounts' ? 'user_social_accounts' : tableName === 'loginhistory' ? 'login_history' : tableName === 'usersessions' ? 'user_sessions' : tableName];
          
          if (!records) {
            return reject(new Error(`Fallback: Unknown table ${tableName}`));
          }

          // A basic engine for UPDATE Users SET name = ?, email = ? WHERE id = ?
          // We support simple matches
          let changes = 0;
          if (tableName === 'usersessions' && sqlUpper.includes('SET IS_ACTIVE = 0 WHERE ID = ?')) {
            const tokenId = params[0];
            records.forEach(r => {
              if (r.id === tokenId) {
                r.is_active = 0;
                changes++;
              }
            });
          } else if (tableName === 'usersessions' && sqlUpper.includes('SET IS_ACTIVE = 0 WHERE USER_ID = ?')) {
            const userId = params[0];
            records.forEach(r => {
              if (r.user_id == userId) {
                r.is_active = 0;
                changes++;
              }
            });
          } else if (tableName === 'users' && sqlUpper.includes('PASSWORD_HASH = ? WHERE ID = ?')) {
            const pwdHash = params[0];
            const userId = params[1];
            records.forEach(r => {
              if (r.id == userId) {
                r.password_hash = pwdHash;
                changes++;
              }
            });
          } else if (tableName === 'users' && sqlUpper.includes('SET TWO_FACTOR_ENABLED = ? WHERE ID = ?')) {
            const twoFactorVal = params[0];
            const userId = params[1];
            records.forEach(r => {
              if (r.id == userId) {
                r.two_factor_enabled = twoFactorVal;
                changes++;
              }
            });
          } else if (tableName === 'phoneverifications' && sqlUpper.includes('ATTEMPTS = ATTEMPTS + 1')) {
            const phoneVal = params[0];
            const codeVal = params[1];
            records.forEach(r => {
              if (r.phone === phoneVal && r.code === codeVal) {
                r.attempts = (r.attempts || 0) + 1;
                changes++;
              }
            });
          } else {
            // Generic update fallback logic for other updates
            console.log(`Fallback SQL execution (UPDATE): ${sql} with params`, params);
          }
          saveFallback();
          resolve({ changes });
        } else if (sqlUpper.startsWith('DELETE FROM')) {
          const tableName = sql.match(/DELETE\s+FROM\s+(\w+)/i)[1].toLowerCase();
          const records = fallbackData[tableName === 'usersocialaccounts' ? 'user_social_accounts' : tableName === 'loginhistory' ? 'login_history' : tableName === 'usersessions' ? 'user_sessions' : tableName];
          
          if (!records) {
            return reject(new Error(`Fallback: Unknown table ${tableName}`));
          }

          let changes = 0;
          if (tableName === 'contracts' && sqlUpper.includes('WHERE ID = ?')) {
            const contractId = params[0];
            const initialLen = fallbackData.contracts.length;
            fallbackData.contracts = fallbackData.contracts.filter(c => c.id != contractId);
            fallbackData.contract_clauses = fallbackData.contract_clauses.filter(cc => cc.contract_id != contractId);
            changes = initialLen - fallbackData.contracts.length;
          } else if (sqlUpper.includes('WHERE USER_ID = ? AND PROVIDER = ?')) {
            const userId = params[0];
            const provider = params[1];
            const listName = tableName === 'usersocialaccounts' ? 'user_social_accounts' : tableName;
            const initialLen = fallbackData[listName].length;
            fallbackData[listName] = fallbackData[listName].filter(
              r => !(r.user_id == userId && r.provider.toLowerCase() === provider.toLowerCase())
            );
            changes = initialLen - fallbackData[listName].length;
          } else if (sqlUpper.includes('WHERE ID = ?')) {
            const recordId = params[0];
            const listName = tableName === 'usersessions' ? 'user_sessions' : tableName;
            const initialLen = fallbackData[listName].length;
            fallbackData[listName] = fallbackData[listName].filter(r => r.id !== recordId);
            changes = initialLen - fallbackData[listName].length;
          }
          saveFallback();
          resolve({ changes });
        } else {
          reject(new Error(`Fallback: Unsupported DB mutation query ${sql}`));
        }
      } catch (e) {
        reject(e);
      }
      return;
    }

    dbInstance.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (isFallback) {
      try {
        const sqlUpper = sql.trim().toUpperCase();
        // Emulate SELECT statements
        if (sqlUpper.startsWith('SELECT')) {
          if (sqlUpper.includes('COUNT(*) AS TOTAL_USERS FROM USERS')) {
            return resolve({ total_users: fallbackData.users.length });
          }
          if (sqlUpper.includes('COUNT(*) AS TOTAL_CONTRACTS FROM CONTRACTS')) {
            return resolve({ total_contracts: fallbackData.contracts.length });
          }
          if (sqlUpper.includes('SUM(CRITICAL_COUNT) AS TOTAL_CRITICAL')) {
            let critical = 0, warning = 0, compliant = 0;
            fallbackData.contracts.forEach(c => {
              critical += (c.critical_count || 0);
              warning += (c.warning_count || 0);
              compliant += (c.compliant_count || 0);
            });
            return resolve({ total_critical: critical, total_warning: warning, total_compliant: compliant });
          }
          if (sqlUpper.includes('FROM USERS WHERE EMAIL = ?')) {
            const email = params[0].toLowerCase();
            const user = fallbackData.users.find(u => u.email.toLowerCase() === email);
            return resolve(user || null);
          }
          if (sqlUpper.includes('FROM USERS WHERE PHONE = ?')) {
            const phone = params[0];
            const user = fallbackData.users.find(u => u.phone === phone);
            return resolve(user || null);
          }
          if (sqlUpper.includes('FROM USERS WHERE ID = ?')) {
            const id = params[0];
            const user = fallbackData.users.find(u => u.id == id);
            return resolve(user || null);
          }
          if (sqlUpper.includes('FROM USERSOCIALACCOUNTS WHERE PROVIDER = ? AND PROVIDER_USER_ID = ?')) {
            const provider = params[0];
            const provUserId = params[1];
            const sa = fallbackData.user_social_accounts.find(
              s => s.provider.toLowerCase() === provider.toLowerCase() && s.provider_user_id === provUserId
            );
            return resolve(sa || null);
          }
          if (sqlUpper.includes('FROM USERSESSIONS WHERE ID = ? AND IS_ACTIVE = 1')) {
            const sessId = params[0];
            const sess = fallbackData.user_sessions.find(s => s.id === sessId && s.is_active == 1);
            return resolve(sess || null);
          }
          if (sqlUpper.includes('FROM CONTRACTS WHERE ID = ?')) {
            const id = params[0];
            const contract = fallbackData.contracts.find(c => c.id == id);
            return resolve(contract || null);
          }
          if (sqlUpper.includes('FROM PHONEVERIFICATIONS WHERE PHONE = ? AND TYPE = ?')) {
            const phone = params[0];
            const type = params[1];
            // Get latest verification
            const verifications = fallbackData.phone_verifications.filter(v => v.phone === phone && v.type === type);
            if (verifications.length === 0) return resolve(null);
            verifications.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            return resolve(verifications[0]);
          }
          if (sqlUpper.includes('FROM EMAILVERIFICATIONS WHERE EMAIL = ? AND TYPE = ?')) {
            const email = params[0].toLowerCase();
            const type = params[1];
            const verifications = fallbackData.email_verifications.filter(v => v.email.toLowerCase() === email && v.type === type);
            if (verifications.length === 0) return resolve(null);
            verifications.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            return resolve(verifications[0]);
          }
        }
        console.log(`Fallback SQL execution (GET): ${sql} with params`, params);
        resolve(null);
      } catch (e) {
        reject(e);
      }
      return;
    }

    dbInstance.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (isFallback) {
      try {
        const sqlUpper = sql.trim().toUpperCase();
        if (sqlUpper.includes('FROM USERS') && !sqlUpper.includes('WHERE')) {
          const users = fallbackData.users.map(u => ({
            id: u.id,
            name: u.name,
            email: u.email,
            phone: u.phone,
            country: u.country,
            created_at: u.created_at
          }));
          users.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          return resolve(users);
        }
        if (sqlUpper.includes('FROM CONTRACTS') && (sqlUpper.includes('JOIN USERS') || !sqlUpper.includes('WHERE'))) {
          const list = fallbackData.contracts.map(c => {
            const user = fallbackData.users.find(u => u.id == c.user_id) || {};
            return {
              ...c,
              owner_name: user.name || 'Unknown',
              owner_email: user.email || 'Unknown'
            };
          });
          list.sort((a, b) => new Date(b.analyzed_at) - new Date(a.analyzed_at));
          return resolve(list);
        }
        if (sqlUpper.includes('FROM LOGINHISTORY') && (sqlUpper.includes('LEFT JOIN USERS') || !sqlUpper.includes('WHERE'))) {
          const list = fallbackData.login_history.map(h => {
            const user = fallbackData.users.find(u => u.id == h.user_id) || {};
            return {
              ...h,
              user_email: user.email || 'Guest'
            };
          });
          list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          return resolve(list.slice(0, 100));
        }
        if (sqlUpper.includes('FROM USERSOCIALACCOUNTS WHERE USER_ID = ?')) {
          const userId = params[0];
          const list = fallbackData.user_social_accounts.filter(s => s.user_id == userId);
          return resolve(list);
        }
        if (sqlUpper.includes('FROM LOGINHISTORY WHERE USER_ID = ?')) {
          const userId = params[0];
          const list = fallbackData.login_history.filter(h => h.user_id == userId);
          list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          return resolve(list);
        }
        if (sqlUpper.includes('FROM USERSESSIONS WHERE USER_ID = ?')) {
          const userId = params[0];
          const list = fallbackData.user_sessions.filter(s => s.user_id == userId);
          list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          return resolve(list);
        }
        if (sqlUpper.includes('FROM CONTRACTS WHERE USER_ID = ?')) {
          const userId = params[0];
          const list = fallbackData.contracts.filter(c => c.user_id == userId);
          list.sort((a, b) => new Date(b.analyzed_at) - new Date(a.analyzed_at));
          return resolve(list);
        }
        if (sqlUpper.includes('FROM CONTRACTCLAUSES WHERE CONTRACT_ID = ?')) {
          const contractId = params[0];
          const list = fallbackData.contract_clauses.filter(cc => cc.contract_id == contractId);
          return resolve(list);
        }
        console.log(`Fallback SQL execution (ALL): ${sql} with params`, params);
        resolve([]);
      } catch (e) {
        reject(e);
      }
      return;
    }

    dbInstance.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

module.exports = {
  initDB,
  run,
  get,
  all,
  isFallback: () => isFallback
};
