require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const useragent = require('useragent');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const Tesseract = require('tesseract.js');
const nodemailer = require('nodemailer');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'explainme-secret-token-key-2026';
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT || '86400', 10);

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static Files
app.use(express.static(path.join(__dirname, 'public')));

// Helper: Parse client device info
function getDeviceInfo(req) {
  const uaString = req.headers['user-agent'] || '';
  const agent = useragent.parse(uaString);
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  
  let deviceType = 'Desktop';
  if (/mobile/i.test(uaString)) deviceType = 'Mobile';
  else if (/ipad|tablet/i.test(uaString)) deviceType = 'Tablet';

  return {
    ip_address: ip,
    user_agent: uaString,
    device: deviceType,
    browser: agent.toAgent(),
    os: agent.os.toString()
  };
}

// Middleware: Authenticate Token
function authenticateToken(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Access denied. Please log in.' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid token.' });
  }
}

// AUTH ROUTES

// 1. Manual User Registration (Name, Email, Password)
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  const deviceInfo = getDeviceInfo(req);

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Full name, email address, and password are required.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  try {
    const existingUser = await db.get('SELECT id FROM Users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existingUser) {
      return res.status(400).json({ error: 'An account with this email address already exists. Please sign in.' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const result = await db.run(
      `INSERT INTO Users (name, email, password_hash) VALUES (?, ?, ?)`,
      [name.trim(), email.toLowerCase().trim(), password_hash]
    );

    const user = await db.get('SELECT * FROM Users WHERE id = ?', [result.lastID]);

    // Create session
    const sessionId = 'sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const token = jwt.sign(
      { id: user.id, userId: user.id, email: user.email, name: user.name, sessionId },
      JWT_SECRET,
      { expiresIn: SESSION_TIMEOUT }
    );

    await db.run(
      `INSERT INTO UserSessions (id, user_id, token, ip_address, user_agent, device, os, browser) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, user.id, token, deviceInfo.ip_address, deviceInfo.user_agent, deviceInfo.device, deviceInfo.os, deviceInfo.browser]
    );

    // Set HTTP-only cookie
    res.cookie('token', token, {
      httpOnly: true,
      maxAge: SESSION_TIMEOUT * 1000,
      secure: false,
      sameSite: 'lax'
    });

    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to create user account.' });
  }
});

// 2. Manual User Login (Email, Password)
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const deviceInfo = getDeviceInfo(req);

  if (!email || !password) {
    return res.status(400).json({ error: 'Email address and password are required.' });
  }

  try {
    const user = await db.get('SELECT * FROM Users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!user) {
      return res.status(400).json({ error: 'Invalid email address or password.' });
    }

    if (!user.password_hash) {
      return res.status(400).json({ error: 'This account was created via Google Sign-In. Please click "Continue with Google".' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      await db.run(
        `INSERT INTO LoginHistory (user_id, ip_address, user_agent, device, browser, os, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [user.id, deviceInfo.ip_address, deviceInfo.user_agent, deviceInfo.device, deviceInfo.browser, deviceInfo.os, 'failed_password']
      );
      return res.status(400).json({ error: 'Invalid email address or password.' });
    }

    await db.run(
      `INSERT INTO LoginHistory (user_id, ip_address, user_agent, device, browser, os, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user.id, deviceInfo.ip_address, deviceInfo.user_agent, deviceInfo.device, deviceInfo.browser, deviceInfo.os, 'success']
    );

    const sessionId = 'sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const token = jwt.sign(
      { id: user.id, userId: user.id, email: user.email, name: user.name, sessionId },
      JWT_SECRET,
      { expiresIn: SESSION_TIMEOUT }
    );

    await db.run(
      `INSERT INTO UserSessions (id, user_id, token, ip_address, user_agent, device, os, browser) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, user.id, token, deviceInfo.ip_address, deviceInfo.user_agent, deviceInfo.device, deviceInfo.os, deviceInfo.browser]
    );

    res.cookie('token', token, {
      httpOnly: true,
      maxAge: SESSION_TIMEOUT * 1000,
      secure: false,
      sameSite: 'lax'
    });

    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to complete login.' });
  }
});

// 5. Social Logins Sandbox / Real OAuth
// Google OAuth callbacks
app.get('/api/auth/social/:provider', (req, res) => {
  const { provider } = req.params;
  const { action, userId } = req.query; // action: 'connect' (link account) or 'login'

  if (provider !== 'google') {
    return res.status(400).json({ error: 'Unsupported authentication provider.' });
  }

  // If client ID is defined in .env, standard OAuth flow would proceed here.
  // Otherwise, we redirect to our Sandbox OAuth UI page for mock demonstration.
  if (provider === 'google' && process.env.GOOGLE_CLIENT_ID) {
    const redirectUri = `${req.protocol}://${req.headers.host}/api/auth/social/google/callback`;
    const stateObj = { action: action || 'login', userId: userId || '' };
    const state = Buffer.from(JSON.stringify(stateObj)).toString('base64');
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${process.env.GOOGLE_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `response_type=code&` +
      `state=${state}`;
    return res.redirect(authUrl);
  }

  res.redirect(`/social-sandbox.html?provider=${provider}&action=${action || 'login'}&userId=${userId || ''}`);
});


// Callback for real Google OAuth flow
app.get('/api/auth/social/google/callback', async (req, res) => {
  const { code, state } = req.query;
  const deviceInfo = getDeviceInfo(req);

  if (!code) {
    return res.redirect(`/login.html?error=${encodeURIComponent('No authorization code provided from Google.')}`);
  }

  // Parse state
  let action = 'login';
  let userId = '';
  if (state) {
    try {
      const decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
      action = decodedState.action || 'login';
      userId = decodedState.userId || '';
    } catch (err) {
      console.error('Error parsing OAuth state:', err);
    }
  }

  try {
    const redirectUri = `${req.protocol}://${req.headers.host}/api/auth/social/google/callback`;

    // Exchange authorization code for token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error('Google token exchange error:', errText);
      if (action === 'connect') {
        return res.redirect(`/account-security.html?error=${encodeURIComponent('Failed to exchange authorization code.')}`);
      }
      return res.redirect(`/login.html?error=${encodeURIComponent('Failed to exchange authorization code.')}`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Fetch user info using the access token
    const userinfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!userinfoResponse.ok) {
      console.error('Failed to fetch userinfo from Google');
      if (action === 'connect') {
        return res.redirect(`/account-security.html?error=${encodeURIComponent('Failed to fetch Google profile.')}`);
      }
      return res.redirect(`/login.html?error=${encodeURIComponent('Failed to fetch Google profile.')}`);
    }

    const googleUser = await userinfoResponse.json();
    const providerUserId = googleUser.sub;
    const email = googleUser.email;
    const name = googleUser.name || 'Google User';

    if (action === 'connect') {
      if (!userId) {
        return res.redirect(`/account-security.html?error=${encodeURIComponent('User ID is missing for account link.')}`);
      }

      // Check if this google account is already linked to someone else
      const existingLink = await db.get(
        'SELECT id FROM UserSocialAccounts WHERE provider = ? AND provider_user_id = ?',
        ['google', providerUserId]
      );

      if (existingLink) {
        return res.redirect(`/account-security.html?error=${encodeURIComponent('This Google account is already linked to another user.')}`);
      }

      await db.run(
        `INSERT INTO UserSocialAccounts (user_id, provider, provider_user_id) VALUES (?, ?, ?)`,
        [userId, 'google', providerUserId]
      );

      return res.redirect(`/account-security.html?message=${encodeURIComponent('Google account linked successfully.')}`);
    } else {
      // Social Login Flow
      // Check if social account is already registered
      let linkedAccount = await db.get(
        'SELECT user_id FROM UserSocialAccounts WHERE provider = ? AND provider_user_id = ?',
        ['google', providerUserId]
      );

      let user = null;
      if (linkedAccount) {
        user = await db.get('SELECT * FROM Users WHERE id = ?', [linkedAccount.user_id]);
      } else {
        // First time logging in with this social account.
        // Check if a user with this email already exists
        user = await db.get('SELECT * FROM Users WHERE email = ?', [email.toLowerCase()]);
        
        if (!user) {
          // Auto-register user
          const result = await db.run(
            `INSERT INTO Users (name, email, country) VALUES (?, ?, ?)`,
            [name, email.toLowerCase(), 'United States']
          );
          user = await db.get('SELECT * FROM Users WHERE id = ?', [result.lastID]);
        }

        // Link account
        await db.run(
          `INSERT INTO UserSocialAccounts (user_id, provider, provider_user_id) VALUES (?, ?, ?)`,
          [user.id, 'google', providerUserId]
        );
      }

      // Log success login
      await db.run(
        `INSERT INTO LoginHistory (user_id, ip_address, user_agent, device, browser, os, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [user.id, deviceInfo.ip_address, deviceInfo.user_agent, deviceInfo.device, deviceInfo.browser, deviceInfo.os, 'success']
      );

      // Create session
      const sessionId = 'sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const token = jwt.sign(
        { id: user.id, userId: user.id, email: user.email, sessionId }, 
        JWT_SECRET, 
        { expiresIn: SESSION_TIMEOUT }
      );

      await db.run(
        `INSERT INTO UserSessions (id, user_id, token, ip_address, user_agent, device, os, browser) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, user.id, token, deviceInfo.ip_address, deviceInfo.user_agent, deviceInfo.device, deviceInfo.os, deviceInfo.browser]
      );

      // Set cookie
      res.cookie('token', token, {
        httpOnly: true,
        maxAge: SESSION_TIMEOUT * 1000,
        secure: false,
        sameSite: 'lax'
      });

      return res.redirect('/dashboard.html');
    }
  } catch (err) {
    console.error('Google OAuth flow callback error:', err);
    if (action === 'connect') {
      return res.redirect(`/account-security.html?error=${encodeURIComponent('Internal server error during Google link.')}`);
    }
    return res.redirect(`/login.html?error=${encodeURIComponent('Internal server error during Google login.')}`);
  }
});


// Callback from our Social Sandbox (replaces the standard OAuth callback handler)
app.post('/api/auth/social-callback', async (req, res) => {
  const { provider, providerUserId, email, name, action, userId } = req.body;
  
  if (provider !== 'google') {
    return res.status(400).json({ error: 'Unsupported social provider.' });
  }

  const deviceInfo = getDeviceInfo(req);

  try {
    if (action === 'connect') {
      // Link social account to existing user
      if (!userId) {
        return res.status(400).json({ error: 'User ID is required to link social account.' });
      }

      // Check if this social account is already linked to someone else
      const existingLink = await db.get(
        'SELECT id FROM UserSocialAccounts WHERE provider = ? AND provider_user_id = ?',
        [provider, providerUserId]
      );
      if (existingLink) {
        return res.status(400).json({ error: `This ${provider} account is already linked to another user.` });
      }

      await db.run(
        `INSERT INTO UserSocialAccounts (user_id, provider, provider_user_id) VALUES (?, ?, ?)`,
        [userId, provider, providerUserId]
      );

      return res.json({ success: true, message: `${provider} account linked successfully.` });
    } else {
      // Social Login Flow
      // Check if social account is already registered
      let linkedAccount = await db.get(
        'SELECT user_id FROM UserSocialAccounts WHERE provider = ? AND provider_user_id = ?',
        [provider, providerUserId]
      );

      let user = null;
      if (linkedAccount) {
        user = await db.get('SELECT * FROM Users WHERE id = ?', [linkedAccount.user_id]);
      } else {
        // First time logging in with this social account.
        // Check if a user with this email already exists
        user = await db.get('SELECT * FROM Users WHERE email = ?', [email.toLowerCase()]);
        
        if (!user) {
          // Auto-register user
          const result = await db.run(
            `INSERT INTO Users (name, email, country) VALUES (?, ?, ?)`,
            [name, email.toLowerCase(), 'United States']
          );
          user = await db.get('SELECT * FROM Users WHERE id = ?', [result.lastID]);
        }

        // Link account
        await db.run(
          `INSERT INTO UserSocialAccounts (user_id, provider, provider_user_id) VALUES (?, ?, ?)`,
          [user.id, provider, providerUserId]
        );
      }

      // Log success login
      await db.run(
        `INSERT INTO LoginHistory (user_id, ip_address, user_agent, device, browser, os, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [user.id, deviceInfo.ip_address, deviceInfo.user_agent, deviceInfo.device, deviceInfo.browser, deviceInfo.os, 'success']
      );

      // Create session
      const sessionId = 'sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const token = jwt.sign(
        { id: user.id, userId: user.id, email: user.email, sessionId }, 
        JWT_SECRET, 
        { expiresIn: SESSION_TIMEOUT }
      );

      await db.run(
        `INSERT INTO UserSessions (id, user_id, token, ip_address, user_agent, device, os, browser) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, user.id, token, deviceInfo.ip_address, deviceInfo.user_agent, deviceInfo.device, deviceInfo.os, deviceInfo.browser]
      );

      // Set cookie
      res.cookie('token', token, {
        httpOnly: true,
        maxAge: SESSION_TIMEOUT * 1000,
        secure: false,
        sameSite: 'lax'
      });

      res.json({
        success: true,
        message: 'Social login successful.',
        user: { id: user.id, name: user.name, email: user.email, phone: user.phone },
        token
      });
    }
  } catch (err) {
    console.error('Social callback error:', err);
    res.status(500).json({ error: 'Failed to process social authentication.' });
  }
});

// 8. Social Disconnect
app.post('/api/auth/social-disconnect', authenticateToken, async (req, res) => {
  const { provider } = req.body;
  const userId = req.user.id;

  if (!provider) {
    return res.status(400).json({ error: 'Provider is required.' });
  }

  try {
    // Delete connection
    const result = await db.run(
      'DELETE FROM UserSocialAccounts WHERE user_id = ? AND provider = ?',
      [userId, provider.toLowerCase()]
    );

    if (result.changes === 0) {
      return res.status(400).json({ error: `Account not connected to ${provider}.` });
    }

    res.json({ success: true, message: `Disconnected from ${provider} account.` });
  } catch (err) {
    console.error('Social disconnect error:', err);
    res.status(500).json({ error: 'Failed to unlink account.' });
  }
});

// 9. Two-Factor Authentication (2FA) Status Toggle
app.post('/api/auth/2fa/toggle', authenticateToken, async (req, res) => {
  const { enabled } = req.body;

  try {
    await db.run(
      'UPDATE Users SET two_factor_enabled = ? WHERE id = ?',
      [enabled ? 1 : 0, req.user.id]
    );

    res.json({ 
      success: true, 
      message: `2FA has been ${enabled ? 'enabled' : 'disabled'}.`
    });
  } catch (err) {
    console.error('2FA toggle error:', err);
    res.status(500).json({ error: 'Failed to update 2FA status.' });
  }
});

// 10. User Profile details (Includes Login History, Active Sessions, and Connected Accounts)
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const user = await db.get('SELECT id, name, email, phone, country, two_factor_enabled FROM Users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Get social accounts
    const socials = await db.all('SELECT provider FROM UserSocialAccounts WHERE user_id = ?', [req.user.id]);
    const connectedProviders = socials.map(s => s.provider.toLowerCase());

    const connectedAccounts = {
      google: connectedProviders.includes('google'),
      facebook: connectedProviders.includes('facebook'),
      twitter: connectedProviders.includes('twitter')
    };

    // Get login history
    const history = await db.all('SELECT id, ip_address, device, browser, os, status, created_at FROM LoginHistory WHERE user_id = ? ORDER BY id DESC LIMIT 10', [req.user.id]);

    // Get active sessions
    const sessions = await db.all('SELECT id, ip_address, device, browser, os, last_activity, created_at FROM UserSessions WHERE user_id = ? AND is_active = 1 ORDER BY last_activity DESC', [req.user.id]);

    res.json({
      success: true,
      user,
      connectedAccounts,
      loginHistory: history,
      activeSessions: sessions.map(s => ({
        id: s.id,
        ip_address: s.ip_address,
        device: s.device,
        browser: s.browser,
        os: s.os,
        last_activity: s.last_activity,
        created_at: s.created_at,
        isCurrent: s.id === req.user.sessionId
      }))
    });
  } catch (err) {
    console.error('Profile fetch error:', err);
    res.status(500).json({ error: 'Failed to retrieve profile data.' });
  }
});

// 11. Revoke Session
app.post('/api/user/revoke-session', authenticateToken, async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required.' });
  }

  try {
    const session = await db.get('SELECT user_id FROM UserSessions WHERE id = ?', [sessionId]);
    if (!session || session.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You do not have permission to revoke this session.' });
    }

    await db.run('UPDATE UserSessions SET is_active = 0 WHERE id = ?', [sessionId]);

    res.json({ success: true, message: 'Session revoked successfully.' });
  } catch (err) {
    console.error('Revoke session error:', err);
    res.status(500).json({ error: 'Failed to revoke session.' });
  }
});

// 12. Log Out Session
app.post('/api/auth/logout', authenticateToken, async (req, res) => {
  try {
    await db.run('UPDATE UserSessions SET is_active = 0 WHERE id = ?', [req.user.sessionId]);
    res.clearCookie('token');
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Failed to complete logout.' });
  }
});

// Multer setup for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB limit
});

// Rule-based Legal Clause Compliance Scanner
function analyzeContractText(text) {
  const lines = text.split(/\r?\n/);
  const paragraphs = [];
  let currentParagraph = "";
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (currentParagraph !== "") {
        paragraphs.push(currentParagraph);
        currentParagraph = "";
      }
    } else {
      if (currentParagraph !== "") {
        currentParagraph += " " + trimmed;
      } else {
        currentParagraph = trimmed;
      }
    }
  }
  if (currentParagraph !== "") {
    paragraphs.push(currentParagraph);
  }

  const categories = [
    {
      title: "Limitation of Liability",
      keywords: ["limitation of liability", "liability limit", "maximum liability", "capped at", "indirect damages", "consequential damages", "shall not exceed"],
      defaultRisk: "warning",
      defaultAnalysis: "Determines the maximum financial exposure. Uncapped or unbalanced liability structures present major risks.",
      defaultRecommendation: "Ensure liability is capped at a reasonable value (e.g., 12 months fees) and mutual carve-outs are added for indemnity.",
      evaluate: (para) => {
        const lower = para.toLowerCase();
        if (lower.includes("unlimited liability") || lower.includes("no limit") || lower.includes("un-capped") || (lower.includes("liability") && lower.includes("no cap"))) {
          return {
            risk: "critical",
            analysis: "The clause contains language indicating unlimited or uncapped liability. This poses an extreme financial risk to your organization.",
            recommendation: "Negotiate a standard commercial liability cap, ideally limited to the fees paid under the agreement in the preceding 12 months."
          };
        }
        if (lower.includes("consequential") || lower.includes("indirect") || lower.includes("incidental")) {
          return {
            risk: "compliant",
            analysis: "The clause standardly excludes indirect, incidental, and consequential damages, protecting you from unpredictable losses.",
            recommendation: "Ensure this exclusion remains mutual and applies evenly to both parties."
          };
        }
        return null;
      }
    },
    {
      title: "Exclusivity & Non-Solicit",
      keywords: ["exclusivity", "non-solicit", "non-solicitation", "exclusive partner", "exclusive rights", "shall not solicit", "not recruit"],
      defaultRisk: "warning",
      defaultAnalysis: "Restricts business activities or hiring practices, potentially locking your company out of target markets or talent pools.",
      defaultRecommendation: "Review the duration and geographic scope. Ensure non-solicitation only applies to key personnel directly involved in the project.",
      evaluate: (para) => {
        const lower = para.toLowerCase();
        if (lower.includes("exclusive partner") || lower.includes("exclusive rights") || lower.includes("sole provider")) {
          return {
            risk: "critical",
            analysis: "A strict exclusivity restriction was detected. This limits your ability to work with other vendors or clients in similar industries.",
            recommendation: "Limit the exclusivity to a narrow sub-sector or convert it to a first-right-of-refusal to maintain business flexibility."
          };
        }
        if (lower.includes("non-solicit") || lower.includes("shall not solicit")) {
          return {
            risk: "warning",
            analysis: "A non-solicitation restriction is active. This restricts your ability to hire or recruit employees from the counterparty.",
            recommendation: "Ensure the non-solicitation clause is mutual, is restricted only to active recruitments, and includes a carve-out for general public job postings."
          };
        }
        return null;
      }
    },
    {
      title: "Indemnification",
      keywords: ["indemnify", "indemnification", "hold harmless", "defend and hold", "liable for third-party"],
      defaultRisk: "warning",
      defaultAnalysis: "Requires one party to pay for legal costs and damages incurred by the other, usually regarding third-party IP claims.",
      defaultRecommendation: "Ensure indemnification obligations are mutual and capped, and include standard procedural carve-outs (prompt notice, control of defense).",
      evaluate: (para) => {
        const lower = para.toLowerCase();
        if (lower.includes("indemnify") && (lower.includes("solely") || lower.includes("all claims") || lower.includes("unconditional"))) {
          return {
            risk: "critical",
            analysis: "Broad or unilateral indemnification clause detected. You are taking on significant responsibility for claims outside of your direct control.",
            recommendation: "Make the indemnification mutual. Ensure intellectual property indemnity has standard carve-outs for customer modifications or combination claims."
          };
        }
        return null;
      }
    },
    {
      title: "Governing Law",
      keywords: ["governing law", "jurisdiction", "choice of law", "arbitration", "courts of", "governed by"],
      defaultRisk: "compliant",
      defaultAnalysis: "Establishes which region's laws apply and where disputes will be resolved.",
      defaultRecommendation: "Confirm the chosen jurisdiction is neutral or local to your operations to minimize potential travel and legal fees in case of conflict.",
      evaluate: (para) => {
        const lower = para.toLowerCase();
        if (lower.includes("governing law") || lower.includes("governed by")) {
          const foreignJus = ["england", "london", "china", "swiss", "switzerland", "singapore", "cayman", "delaware"];
          for (const fj of foreignJus) {
            if (lower.includes(fj)) {
              return {
                risk: "warning",
                analysis: `Governing law is set to ${fj.charAt(0).toUpperCase() + fj.slice(1)}. If disputes arise, litigation will take place under unfamiliar laws.`,
                recommendation: "Attempt to change the governing law to your local jurisdiction or a mutually acceptable neutral standard (e.g. New York or Delaware)."
              };
            }
          }
          return {
            risk: "compliant",
            analysis: "Standard governing law and jurisdiction clause detected.",
            recommendation: "No immediate action required, provided the venue specified is acceptable to your operational entity."
          };
        }
        return null;
      }
    },
    {
      title: "Confidentiality",
      keywords: ["confidentiality", "non-disclosure", "confidential information", "disclosure of", "trade secrets", "keep confidential"],
      defaultRisk: "compliant",
      defaultAnalysis: "Protects proprietary information shared during the business relationship.",
      defaultRecommendation: "Verify that the confidentiality period is sufficient (typically 3-5 years post-termination) and that standard exceptions (public info, legally compelled) are included.",
      evaluate: (para) => {
        const lower = para.toLowerCase();
        if (lower.includes("confidential") && (lower.includes("unilateral") || lower.includes("disclosing party only"))) {
          return {
            risk: "warning",
            analysis: "Unilateral confidentiality clause detected where only one party is obligated to protect information.",
            recommendation: "Request that the confidentiality obligation be made fully mutual to safeguard your own shared information and trade secrets."
          };
        }
        return {
          risk: "compliant",
          analysis: "Mutual confidentiality clause detected, providing standard protection for both signing parties.",
          recommendation: "Review the definition of confidential information to ensure it covers all digital assets and proprietary codebase secrets."
        };
      }
    }
  ];

  const detectedClauses = [];
  let criticalCount = 0;
  let warningCount = 0;
  let compliantCount = 0;

  for (const para of paragraphs) {
    if (para.length < 30) continue;
    
    for (const cat of categories) {
      const hasKeyword = cat.keywords.some(kw => para.toLowerCase().includes(kw));
      if (hasKeyword) {
        let evaluation = null;
        if (cat.evaluate) {
          evaluation = cat.evaluate(para);
        }
        
        const risk = evaluation ? evaluation.risk : cat.defaultRisk;
        const analysis = evaluation ? evaluation.analysis : cat.defaultAnalysis;
        const rec = evaluation ? evaluation.recommendation : cat.defaultRecommendation;

        if (risk === "critical") criticalCount++;
        else if (risk === "warning") warningCount++;
        else if (risk === "compliant") compliantCount++;

        detectedClauses.push({
          clause_title: cat.title,
          clause_text: para,
          risk_level: risk,
          analysis: analysis,
          recommendation: rec
        });
        break;
      }
    }
  }

  if (detectedClauses.length === 0) {
    detectedClauses.push({
      clause_title: "General Assessment",
      clause_text: text.substring(0, 500) + (text.length > 500 ? "..." : ""),
      risk_level: "warning",
      analysis: "No standard structured legal clauses (Liability, Exclusivity, Indemnity, etc.) were explicitly identified in the parsed document. This might be due to document formatting or the text scope.",
      recommendation: "Review the full contract manually to verify if standard terms or liabilities have been omitted entirely."
    });
    warningCount = 1;
  }

  return {
    clauses: detectedClauses,
    criticalCount,
    warningCount,
    compliantCount
  };
}

// AI-powered Contract Analysis using Google Gemini with fallback
async function analyzeContractWithAI(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    console.log('[LEGAL AI ENGINE] GEMINI_API_KEY not set. Using built-in heuristic rule scanner.');
    return analyzeContractText(text);
  }

  const candidateModels = ['gemini-3.8-flash', 'gemma-4-26b-a4b-it', 'gemini-flash-latest', 'gemini-1.5-flash'];

  for (const model of candidateModels) {
    try {
      console.log(`[LEGAL AI ENGINE] Analyzing contract using Google AI (${model})...`);
      const prompt = `You are an expert legal tech attorney. Analyze the following contract text. Identify key legal clauses (e.g. Limitation of Liability, Indemnification, Exclusivity, Confidentiality, Governing Law, Termination).
For each clause, determine the risk_level ("critical", "warning", or "compliant"), provide an executive legal analysis, and a practical recommendation.

Return ONLY a valid JSON object with no extra prose, formatted as:
{
  "criticalCount": 1,
  "warningCount": 1,
  "compliantCount": 1,
  "clauses": [
    {
      "clause_title": "Limitation of Liability",
      "clause_text": "sample text from contract",
      "risk_level": "warning",
      "analysis": "sample analysis",
      "recommendation": "sample recommendation"
    }
  ]
}

Contract text to analyze:
${text.substring(0, 12000)}`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[LEGAL AI ENGINE] Model ${model} returned ${response.status}: ${errText.substring(0, 150)}`);
        continue;
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawText) {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed && Array.isArray(parsed.clauses)) {
            console.log(`[LEGAL AI ENGINE] AI contract analysis completed successfully via ${model} (${parsed.clauses.length} clauses detected).`);
            return parsed;
          }
        }
      }
    } catch (err) {
      console.error(`[LEGAL AI ENGINE] Error with model ${model}:`, err.message);
    }
  }

  console.warn('[LEGAL AI ENGINE] Fallback to heuristic rule scanner.');
  return analyzeContractText(text);
}

// POST /api/contract/upload - Handle real file upload and scanning
app.post('/api/contract/upload', authenticateToken, upload.single('contract'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No contract file uploaded.' });
  }

  try {
    let text = "";
    const ext = path.extname(req.file.originalname).toLowerCase();
    const mimetype = req.file.mimetype;

    if (mimetype === 'text/plain' || ext === '.txt') {
      text = req.file.buffer.toString('utf8');
    } else if (mimetype === 'application/pdf' || ext === '.pdf') {
      const parsedPdf = await pdfParse(req.file.buffer);
      text = parsedPdf.text;
    } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === '.docx') {
      const docxResult = await mammoth.extractRawText({ buffer: req.file.buffer });
      text = docxResult.value;
    } else if (mimetype.startsWith('image/') || ['.png', '.jpg', '.jpeg'].includes(ext)) {
      const ocrResult = await Tesseract.recognize(req.file.buffer, 'eng');
      text = ocrResult.data.text;
    } else {
      return res.status(400).json({ error: 'Unsupported file format. Please upload a PDF, TXT, DOCX, PNG, JPG, or JPEG.' });
    }

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Could not extract any text from the uploaded document.' });
    }

    // Run AI or rule scanner
    const analysisResults = await analyzeContractWithAI(text);

    // Save Contract Metadata
    const contractResult = await db.run(
      `INSERT INTO Contracts (user_id, filename, critical_count, warning_count, compliant_count) VALUES (?, ?, ?, ?, ?)`,
      [req.user.userId, req.file.originalname, analysisResults.criticalCount, analysisResults.warningCount, analysisResults.compliantCount]
    );
    const contractId = contractResult.lastID;

    // Save Clauses
    for (const clause of analysisResults.clauses) {
      await db.run(
        `INSERT INTO ContractClauses (contract_id, clause_title, clause_text, risk_level, analysis, recommendation) VALUES (?, ?, ?, ?, ?, ?)`,
        [contractId, clause.clause_title, clause.clause_text, clause.risk_level, clause.analysis, clause.recommendation]
      );
    }

    res.json({
      success: true,
      message: 'Contract uploaded and analyzed successfully.',
      contractId
    });
  } catch (err) {
    console.error('Contract upload & analysis error:', err);
    res.status(500).json({ error: 'Failed to process contract upload and analysis.' });
  }
});

// GET /api/contract/reports - Retrieve all scanned reports for logged in user
app.get('/api/contract/reports', authenticateToken, async (req, res) => {
  try {
    const reports = await db.all(
      `SELECT * FROM Contracts WHERE user_id = ? ORDER BY analyzed_at DESC`,
      [req.user.userId]
    );
    res.json({ success: true, reports });
  } catch (err) {
    console.error('Fetch reports error:', err);
    res.status(500).json({ error: 'Failed to retrieve scanned contract reports.' });
  }
});

// GET /api/contract/report/:id - Retrieve detailed compliance report
app.get('/api/contract/report/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const contract = await db.get(
      `SELECT * FROM Contracts WHERE id = ? AND user_id = ?`,
      [id, req.user.userId]
    );

    if (!contract) {
      return res.status(404).json({ error: 'Compliance report not found or access denied.' });
    }

    const clauses = await db.all(
      `SELECT * FROM ContractClauses WHERE contract_id = ?`,
      [id]
    );

    res.json({
      success: true,
      contract,
      clauses
    });
  } catch (err) {
    console.error('Fetch report details error:', err);
    res.status(500).json({ error: 'Failed to retrieve detailed compliance report.' });
  }
});

// ==========================================
// ADMIN DASHBOARD API ENDPOINTS
// ==========================================

// GET /api/admin/stats - Retrieve global statistics
app.get('/api/admin/stats', authenticateToken, async (req, res) => {
  try {
    const userCount = await db.get('SELECT COUNT(*) AS total_users FROM Users');
    const contractCount = await db.get('SELECT COUNT(*) AS total_contracts FROM Contracts');
    const riskSums = await db.get('SELECT SUM(critical_count) AS total_critical, SUM(warning_count) AS total_warning, SUM(compliant_count) AS total_compliant FROM Contracts');

    res.json({
      success: true,
      stats: {
        totalUsers: userCount?.total_users || 0,
        totalContracts: contractCount?.total_contracts || 0,
        totalCritical: riskSums?.total_critical || 0,
        totalWarning: riskSums?.total_warning || 0,
        totalCompliant: riskSums?.total_compliant || 0
      }
    });
  } catch (err) {
    console.error('Fetch admin stats error:', err);
    res.status(500).json({ error: 'Failed to retrieve global system statistics.' });
  }
});

// GET /api/admin/users - Retrieve all registered user accounts
app.get('/api/admin/users', authenticateToken, async (req, res) => {
  try {
    const users = await db.all('SELECT id, name, email, phone, country, created_at FROM Users ORDER BY created_at DESC');
    res.json({ success: true, users });
  } catch (err) {
    console.error('Fetch admin users error:', err);
    res.status(500).json({ error: 'Failed to retrieve registered user accounts.' });
  }
});

// GET /api/admin/contracts - Retrieve all uploaded contracts globally
app.get('/api/admin/contracts', authenticateToken, async (req, res) => {
  try {
    const contracts = await db.all(
      `SELECT Contracts.*, Users.name AS owner_name, Users.email AS owner_email 
       FROM Contracts 
       JOIN Users ON Contracts.user_id = Users.id 
       ORDER BY Contracts.analyzed_at DESC`
    );
    res.json({ success: true, contracts });
  } catch (err) {
    console.error('Fetch admin contracts error:', err);
    res.status(500).json({ error: 'Failed to retrieve uploaded contracts.' });
  }
});

// GET /api/admin/audit-logs - Retrieve global audit and authentication trails
app.get('/api/admin/audit-logs', authenticateToken, async (req, res) => {
  try {
    const logs = await db.all(
      `SELECT LoginHistory.*, Users.email AS user_email 
       FROM LoginHistory 
       LEFT JOIN Users ON LoginHistory.user_id = Users.id 
       ORDER BY LoginHistory.created_at DESC 
       LIMIT 100`
    );
    res.json({ success: true, logs });
  } catch (err) {
    console.error('Fetch admin audit logs error:', err);
    res.status(500).json({ error: 'Failed to retrieve audit log history.' });
  }
});

// GET /api/admin/report/:id - Retrieve detailed compliance report for any contract (admin view)
app.get('/api/admin/report/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const contract = await db.get('SELECT * FROM Contracts WHERE id = ?', [id]);
    if (!contract) {
      return res.status(404).json({ error: 'Compliance report not found.' });
    }
    const clauses = await db.all('SELECT * FROM ContractClauses WHERE contract_id = ?', [id]);
    res.json({
      success: true,
      contract,
      clauses
    });
  } catch (err) {
    console.error('Fetch admin report details error:', err);
    res.status(500).json({ error: 'Failed to retrieve detailed compliance report.' });
  }
});

// DELETE /api/admin/contracts/:id - Admin action to delete a contract
app.delete('/api/admin/contracts/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.run('DELETE FROM Contracts WHERE id = ?', [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Contract not found or already deleted.' });
    }
    res.json({ success: true, message: 'Contract and related clauses deleted successfully.' });
  } catch (err) {
    console.error('Admin delete contract error:', err);
    res.status(500).json({ error: 'Failed to delete contract.' });
  }
});

// Initialize DB and start server
db.initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server: ExplainMe Auth running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Database migration failed. Server not started.', err);
  });
