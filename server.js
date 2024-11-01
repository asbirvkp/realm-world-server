const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();

// CORS configuration
const corsOptions = {
  origin: ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add before any routes
app.use((req, res, next) => {
  res.header('Content-Type', 'application/json');
  next();
});

// Firebase Admin initialization
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
};

// Initialize Firebase Admin
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase Admin initialized successfully');
} catch (error) {
  console.error('Firebase Admin initialization error:', error);
  process.exit(1);
}

// Add authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    // Verify the Firebase token
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Initialize Google Sheets
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
});

const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = process.env.GOOGLE_SHEET_ID;

// Test endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Server is running!' });
});

// Verify token endpoint
app.get('/api/verify-token', authenticateToken, (req, res) => {
  res.json({ success: true, user: req.user });
});

// Performance data endpoint
app.get('/api/performance-data', authenticateToken, async (req, res) => {
  try {
    console.log('Fetching performance data...');
    const responses = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Trade-History!H2',
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Trade-History!J2',
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Trade-History!L2',
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Trade-History!N2',
      })
    ]);

    console.log('Raw responses:', responses);

    const getValue = (response) => {
      try {
        if (response.data.values && response.data.values[0] && response.data.values[0][0]) {
          const value = parseFloat(response.data.values[0][0]);
          return isNaN(value) ? '0' : value.toFixed(2);
        }
        return '0';
      } catch (error) {
        console.error('Error parsing value:', error);
        return '0';
      }
    };

    const [thisWeek, lastWeek, monthly, yearly] = responses.map(getValue);
    
    const result = {
      thisWeek,
      lastWeek,
      monthly,
      yearly
    };
    
    console.log('Sending performance data:', result);
    return res.json(result);
  } catch (error) {
    console.error('Performance Data Error:', error);
    return res.status(500).json({ error: 'Failed to fetch performance data' });
  }
});

// Trade history endpoint
app.get('/api/trade-history', authenticateToken, async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Trade-History!B2:E',
    });

    if (!response.data.values) {
      return res.json([]);
    }

    const trades = response.data.values
      .map(row => ({
        timestamp: row[0],
        symbol: row[1],
        direction: row[2],
        pnl: parseFloat(row[3] || 0)
      }))
      .filter(trade => trade.timestamp && trade.symbol && trade.direction)
      .reverse();

    console.log('Processed trades:', trades);
    res.json(trades);
  } catch (error) {
    console.error('Trade History Error:', error);
    res.status(500).json({ error: 'Failed to fetch trade history' });
  }
});

// PNL data endpoint
app.get('/api/pnl-data', authenticateToken, async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Trade-History!B2:E',
    });

    if (!response.data.values) {
      return res.json([]);
    }

    const pnlData = response.data.values
      .map(row => ({
        date: row[0],
        pnl: parseFloat(row[3] || 0)
      }))
      .filter(item => item.date && !isNaN(item.pnl))
      .reverse();

    console.log('Processed PNL data:', pnlData);
    res.json(pnlData);
  } catch (error) {
    console.error('PNL Data Error:', error);
    res.status(500).json({ error: 'Failed to fetch PNL data' });
  }
});

// Add this error handling middleware at the end before app.listen
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});