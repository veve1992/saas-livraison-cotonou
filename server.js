const trackingRoutes = require('./tracking-routes');
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Middleware
app.use(cors());
app.use(express.json());

// ============================================
// HEALTH CHECK
// ============================================

app.get('/', (req, res) => {
  res.json({ 
    status: '✅ OK',
    message: 'Serveur fonctionne !'
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: '✅ OK',
    message: 'Serveur fonctionne !'
  });
});

// ============================================
// COLIS ROUTES
// ============================================

// GET ALL
app.get('/parcels', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM colis ORDER BY id DESC');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET ONE
app.get('/parcels/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM colis WHERE id = $1', [req.params.id]);
    res.json(result.rows[0] || { error: 'Not found' });
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

// CREATE
app.post('/parcels', async (req, res) => {
  try {
    const { de, a, prix } = req.body;
    
    if (!de || !a || !prix) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const result = await pool.query(
      'INSERT INTO colis (de, a, prix, status, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *',
      [de, a, parseInt(prix), 'En attente']
    );

    res.status(201).json({
      success: true,
      message: '✅ Colis créé avec succès !',
      parcel: result.rows[0]
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Creation failed' });
  }
});

// ============================================
// LIVREURS ROUTES
// ============================================

// GET ALL
app.get('/livreurs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM livreurs ORDER BY id DESC');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

// CREATE
app.post('/livreurs', async (req, res) => {
  try {
    const { nom, phone } = req.body;
    
    if (!nom || !phone) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const result = await pool.query(
      'INSERT INTO livreurs (nom, phone, colis_livres, revenus, rating, created_at) VALUES ($1, $2, 0, 0, 5.0, NOW()) RETURNING *',
      [nom, phone]
    );

    res.status(201).json({
      success: true,
      message: '✅ Livreur créé avec succès !',
      livreur: result.rows[0]
    });
  } catch (e) {
    res.status(500).json({ error: 'Creation failed' });
  }
});

// ============================================
// EXPORT
// ============================================

module.exports = app;
// Écouter sur un port
const PORT = process.env.PORT || 3000;
app.use('/', trackingRoutes);
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});