const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

// --- API Key Auth ---
const API_KEY = 'Gxyenn969';

function authMiddleware(req, res, next) {
  const key = req.query.apikey || req.headers['x-api-key'];
  if (!key) {
    return res.status(401).json({
      status: false,
      code: 401,
      message: 'Lu siapa? Mau akses tanpa key? Mimpi kali. Beli dulu key-nya.',
      creator: 'Gxyenn'
    });
  }
  if (key !== API_KEY) {
    return res.status(403).json({
      status: false,
      code: 403,
      message: 'Key lu salah bos. Jangan coba-coba. Mau akses? Beli yang bener.',
      creator: 'Gxyenn'
    });
  }
  next();
}

// --- CORS ---
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'X-API-Key, Content-Type');
  next();
});

// Serve docs
app.use(express.static(path.join(__dirname, 'public')));

// Apply auth to all /api routes
app.use('/api', authMiddleware);

// --- Import route modules ---
const samehadakuRoutes = require('./routes/samehadaku');
const anichinRoutes = require('./routes/anichin');
const donghuaRoutes = require('./routes/donghua');

app.use('/api/samehadaku', samehadakuRoutes);
app.use('/api/anichin', anichinRoutes);
app.use('/api/donghua', donghuaRoutes);

// Root redirect to docs
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404
app.use((req, res) => {
  res.status(404).json({ status: false, message: 'Endpoint not found', creator: 'Gxyenn' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ status: false, message: 'Internal server error', creator: 'Gxyenn' });
});

app.listen(PORT, () => {
  console.log(`VelyDocs API running on port ${PORT}`);
});
