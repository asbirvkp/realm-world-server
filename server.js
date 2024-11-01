const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS.split(','),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  exposedHeaders: ['Authorization']
}));

app.use(express.json());

// Initialize Google Sheets
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
});

const sheets = google.sheets({ version: 'v4', auth });

// Add error handling for sheets initialization
const spreadsheetId = process.env.GOOGLE_SHEET_ID;

// Add a test endpoint to verify Google Sheets connection
app.get('/api/test-sheets', authenticateToken, async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Trade-History!A1:A1',
    });
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('Google Sheets Test Error:', error);
    res.status(500).json({ error: 'Failed to connect to Google Sheets' });
  }
});

// Initialize Firebase Admin with proper private key handling
const serviceAccount = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY ? 
    process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
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

    // Verify the Firebase token instead of JWT
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Add this route before other routes
app.get('/api/verify-token', authenticateToken, (req, res) => {
  res.json({ success: true, user: req.user });
});

// Performance data endpoint
app.get('/api/performance-data', authenticateToken, async (req, res) => {
  try {
    const [valueResponse, changeResponse] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Trade-History!H1:N1',
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Trade-History!G2:M2',
      })
    ]);
    
    res.json({
      values: valueResponse.data.values[0],
      changes: changeResponse.data.values[0]
    });
  } catch (error) {
    console.error('Performance Data Error:', error);
    res.status(500).json({ error: 'Failed to fetch performance data' });
  }
});

// Trade history endpoint
app.get('/api/trade-history', authenticateToken, async (req, res) => {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    const range = 'Sheet1!A:Z'; // Adjust based on your sheet's range

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const rows = response.data.values || [];
    res.json({ data: rows });
  } catch (error) {
    console.error('Failed to fetch trade history:', error);
    res.status(500).json({ error: 'Failed to load trade history' });
  }
});

// Test users array (for development only)
const users = [
  {
    email: 'asb@gmail.com',
    password: '123'  // Changed to match your test credentials
  }
];

// Login route
app.post('/api/login', (req, res) => {
  try {
    const { email, password } = req.body;
    
    // For testing purposes, hardcode a user
    const validUser = {
      email: 'asb@gmail.com',
      password: '123'
    };
    
    if (email === validUser.email && password === validUser.password) {
      const token = jwt.sign(
        { email: validUser.email },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '24h' }
      );
      
      return res.json({
        success: true,
        token,
        message: 'Login successful'
      });
    }
    
    return res.status(401).json({
      success: false,
      error: 'Invalid credentials'
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'Server is running!' });
});

app.get('/api/pnl-data', authenticateToken, async (req, res) => {
  try {
    const sheetName = req.query.sheet || 'Trade-History';
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: '1epn4JWYAz8o73-KkzbdaKCxxyUNh7hxQuQbyjmQH1Sw',
      range: `${sheetName}!A2:E`,
    });

    if (!response.data.values) {
      return res.json([]);
    }

    const pnlData = response.data.values.map(row => ({
      date: row[1],
      pnl: row[4] ? parseFloat(row[4]) : null
    }));

    res.json(pnlData);
  } catch (error) {
    console.error('Error fetching PNL data:', error);
    res.status(500).json({ 
      error: 'Failed to fetch PNL data', 
      details: error.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Add this route at the end before app.listen
app.get('/test', (req, res) => {
  res.json({ message: 'Server is running and accessible!' });
});

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
