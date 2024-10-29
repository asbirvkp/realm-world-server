const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();

// CORS configuration
app.use(cors({
  origin: ['https://slateblue-hummingbird-423694.hostingersite.com', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  exposedHeaders: ['Authorization']
}));

app.use(express.json());

// Initialize Google Sheets
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
});

const sheets = google.sheets({ version: 'v4', auth });

// Add authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  console.log('Auth Header:', authHeader);
  console.log('Token:', token);

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) {
      console.error('Token verification error:', err);
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Performance data endpoint
app.get('/api/performance-data', authenticateToken, async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: '1epn4JWYAz8o73-KkzbdaKCxxyUNh7hxQuQbyjmQH1Sw',
      range: 'Performance-Overview!B2:E3',
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      return res.status(404).json({ 
        error: 'No data found in spreadsheet'
      });
    }

    const formattedData = [
      { title: 'This Week PNL', value: rows[1][0], change: rows[0][0] },
      { title: 'Last Week PNL', value: rows[1][1], change: rows[0][1] },
      { title: 'Monthly PNL', value: rows[1][2], change: rows[0][2] },
      { title: 'Yearly PNL', value: rows[1][3], change: rows[0][3] }
    ];

    res.json(formattedData);
  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ error: 'Failed to fetch performance data' });
  }
});

// Trade history endpoint
app.get('/api/trade-history', authenticateToken, async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: '1epn4JWYAz8o73-KkzbdaKCxxyUNh7hxQuQbyjmQH1Sw',
      range: 'Trade-History!A2:E',
    });

    if (!response.data.values || response.data.values.length === 0) {
      return res.json([]);
    }

    const tradeHistory = response.data.values.map(row => ({
      date: row[1],
      name: row[2],
      tradeType: row[3],
      pnl: row[4],
    })).reverse();

    res.json(tradeHistory);
  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ error: 'Failed to fetch trade history' });
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
