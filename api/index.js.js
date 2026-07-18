// server-backend-FINAL-DEFINITIF.js
// SOLUTION DÉFINITIVE - Backend avec CORS correctement configuré
// À remplacer par server.js

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ====================================
// DATABASE SETUP
// ====================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// ====================================
// CORS CONFIGURATION - TRÈS IMPORTANT!
// ====================================

const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://frontend-livraison-cotonou.vercel.app',
    'https://*.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

// ====================================
// LOGGING MIDDLEWARE
// ====================================

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ====================================
// HEALTH CHECK (TRÈS IMPORTANT!)
// ====================================

app.get('/', (req, res) => {
  res.json({
    status: '✅ OK',
    app: 'Livraison Cotonou Backend',
    version: '2.0.0',
    database: 'PostgreSQL',
    cors: 'Enabled',
    message: 'Serveur fonctionne !',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: '✅ OK',
    message: 'Serveur fonctionne !',
    database: 'PostgreSQL',
    timestamp: new Date().toISOString()
  });
});

// ====================================
// ROUTES COLIS
// ====================================

// GET ALL PARCELS
app.get('/parcels', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM colis ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur GET /parcels:', error);
    res.status(500).json({ error: 'Erreur base de données' });
  }
});

// GET ONE PARCEL
app.get('/parcels/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM colis WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Colis non trouvé' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erreur GET /parcels/:id:', error);
    res.status(500).json({ error: 'Erreur base de données' });
  }
});

// CREATE PARCEL (LA ROUTE QUI POSE PROBLÈME!)
app.post('/parcels', async (req, res) => {
  try {
    console.log('POST /parcels reçu:', req.body);

    const { de, a, prix, status = 'En attente' } = req.body;

    // VALIDATION
    if (!de || !a || !prix) {
      console.log('❌ Données manquantes:', { de, a, prix });
      return res.status(400).json({ 
        error: 'Données manquantes (de, a, prix requis)' 
      });
    }

    // CONVERT PRIX TO NUMBER
    const prixNumber = parseInt(prix);
    if (isNaN(prixNumber)) {
      console.log('❌ Prix invalide:', prix);
      return res.status(400).json({ error: 'Prix invalide (doit être un nombre)' });
    }

    // INSERT INTO DATABASE
    const result = await pool.query(
      'INSERT INTO colis (de, a, prix, status, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *',
      [de.trim(), a.trim(), prixNumber, status]
    );

    const newParcel = result.rows[0];
    console.log('✅ Colis créé:', newParcel);

    res.status(201).json({
      success: true,
      message: '✅ Colis créé avec succès !',
      parcel: newParcel
    });
  } catch (error) {
    console.error('❌ Erreur POST /parcels:', error.message);
    res.status(500).json({ 
      error: 'Erreur lors de la création du colis',
      details: error.message 
    });
  }
});

// UPDATE PARCEL
app.put('/parcels/:id', async (req, res) => {
  try {
    const { status, livreur } = req.body;

    const result = await pool.query(
      'UPDATE colis SET status = COALESCE($1, status), livreur = COALESCE($2, livreur), updated_at = NOW() WHERE id = $3 RETURNING *',
      [status, livreur, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Colis non trouvé' });
    }

    res.json({
      success: true,
      message: '✅ Colis mis à jour!',
      parcel: result.rows[0]
    });
  } catch (error) {
    console.error('Erreur PUT /parcels/:id:', error);
    res.status(500).json({ error: 'Erreur base de données' });
  }
});

// DELETE PARCEL
app.delete('/parcels/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM colis WHERE id = $1 RETURNING *', [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Colis non trouvé' });
    }

    res.json({
      success: true,
      message: '✅ Colis supprimé!',
      parcel: result.rows[0]
    });
  } catch (error) {
    console.error('Erreur DELETE /parcels/:id:', error);
    res.status(500).json({ error: 'Erreur base de données' });
  }
});

// ====================================
// ROUTES LIVREURS
// ====================================

// GET ALL DRIVERS
app.get('/livreurs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM livreurs ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur GET /livreurs:', error);
    res.status(500).json({ error: 'Erreur base de données' });
  }
});

// GET ONE DRIVER
app.get('/livreurs/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM livreurs WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Livreur non trouvé' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erreur GET /livreurs/:id:', error);
    res.status(500).json({ error: 'Erreur base de données' });
  }
});

// CREATE DRIVER
app.post('/livreurs', async (req, res) => {
  try {
    console.log('POST /livreurs reçu:', req.body);

    const { nom, phone } = req.body;

    // VALIDATION
    if (!nom || !phone) {
      console.log('❌ Données manquantes:', { nom, phone });
      return res.status(400).json({ 
        error: 'Données manquantes (nom, phone requis)' 
      });
    }

    // INSERT INTO DATABASE
    const result = await pool.query(
      'INSERT INTO livreurs (nom, phone, colis_livres, revenus, rating, created_at) VALUES ($1, $2, 0, 0, 5.0, NOW()) RETURNING *',
      [nom.trim(), phone.trim()]
    );

    const newDriver = result.rows[0];
    console.log('✅ Livreur créé:', newDriver);

    res.status(201).json({
      success: true,
      message: '✅ Livreur créé avec succès !',
      livreur: newDriver
    });
  } catch (error) {
    console.error('❌ Erreur POST /livreurs:', error.message);
    res.status(500).json({ 
      error: 'Erreur lors de la création du livreur',
      details: error.message 
    });
  }
});

// ====================================
// ROUTES STATS
// ====================================

app.get('/stats', async (req, res) => {
  try {
    const parcelsResult = await pool.query('SELECT COUNT(*) FROM colis');
    const driversResult = await pool.query('SELECT COUNT(*) FROM livreurs');
    const revenueResult = await pool.query('SELECT SUM(revenus) as total FROM livreurs');

    res.json({
      total_parcels: parseInt(parcelsResult.rows[0].count),
      total_drivers: parseInt(driversResult.rows[0].count),
      total_revenue: revenueResult.rows[0].total || 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Erreur GET /stats:', error);
    res.status(500).json({ error: 'Erreur base de données' });
  }
});

// ====================================
// ERROR HANDLING
// ====================================

app.use((err, req, res, next) => {
  console.error('Erreur non gérée:', err);
  res.status(500).json({ 
    error: 'Erreur serveur',
    message: err.message 
  });
});

// 404 HANDLER
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route non trouvée',
    path: req.path,
    method: req.method
  });
});

// ====================================
// START SERVER
// ====================================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════╗
║   🚀 SERVEUR DÉMARRÉ AVEC SUCCÈS   ║
╠════════════════════════════════════╣
║ Port: ${PORT}
║ Base de données: ${process.env.DATABASE_URL ? '✅ Connectée' : '❌ Non configurée'}
║ CORS: ✅ Activé
║ Timestamp: ${new Date().toISOString()}
╚════════════════════════════════════╝
  `);
});

module.exports = app;
