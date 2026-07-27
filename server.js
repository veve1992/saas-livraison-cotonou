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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;

    // Total colis
    const countResult = await pool.query('SELECT COUNT(*) FROM colis');
    const total = parseInt(countResult.rows[0].count);

    // Colis de cette page
    const result = await pool.query(
  `SELECT c.*, l.nom as livreur_nom, l.phone as livreur_phone 
   FROM colis c
   LEFT JOIN livreurs l ON c.livreur = l.id
   ORDER BY c.id DESC LIMIT $1 OFFSET $2`,
  [limit, offset]
);

    res.json({
      data: result.rows,
      page: page,
      limit: limit,
      total: total,
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// GET ONE
app.get('/parcels/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, l.nom as livreur_nom, l.phone as livreur_phone 
       FROM colis c
       LEFT JOIN livreurs l ON c.livreur = l.id
       WHERE c.id = $1`,
      [req.params.id]
    );
    res.json(result.rows[0] || { error: 'Not found' });
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

// CREATE
app.post('/parcels', async (req, res) => {
  try {
    const { 
      de, 
      a, 
      prix, 
      nom_receptionnaire,
      prenom_receptionnaire,
      contact_receptionnaire,
      adresse_livraison,
      description_colis,
      photo_colis,
      status 
    } = req.body;

     const query = `
      INSERT INTO colis 
      (de, a, prix, nom_receptionnaire, prenom_receptionnaire, contact_receptionnaire, 
       adresse_livraison, description_colis, photo_colis, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING *
    `;
    const values = [
      de,
      a,
      prix,
      nom_receptionnaire || '',
      prenom_receptionnaire || '',
      contact_receptionnaire || '',
      adresse_livraison || '',
      description_colis || '',
      photo_colis || '',
      status || 'En attente'
    ];

    const result = await pool.query(query, values);

    res.json({
      success: true,
      colis: result.rows[0]
    });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: error.message });
  }
});
// UPDATE PARCEL STATUS
app.put('/parcels/:id', async (req, res) => {
  try {
    const colis_id = req.params.id;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status manquant' });
    }

    const result = await pool.query(
      `UPDATE colis 
       SET status = $1, updated_at = NOW(), date_livraison = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, colis_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Colis non trouvé' });
    }

    res.json({
      success: true,
      message: '✅ Statut mis à jour',
      colis: result.rows[0]
    });
  } catch (error) {
    console.error('Erreur UPDATE:', error);
    res.status(500).json({ error: error.message });
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