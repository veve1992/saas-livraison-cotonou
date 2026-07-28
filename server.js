const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Test connexion
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erreur connexion PostgreSQL:', err);
  } else {
    console.log('✅ Connecté à PostgreSQL !');
    release();
  }
});

// ============================================
// PARCELS ROUTES
// ============================================

app.get('/parcels', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;

    const countResult = await pool.query('SELECT COUNT(*) FROM colis');
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      'SELECT * FROM colis ORDER BY id DESC LIMIT $1 OFFSET $2',
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

app.post('/parcels', async (req, res) => {
  try {
    const { de, a, prix, nom_receptionnaire, prenom_receptionnaire,
      contact_receptionnaire, adresse_livraison, description_colis, photo_colis, status } = req.body;

    const query = `
      INSERT INTO colis 
      (de, a, prix, nom_receptionnaire, prenom_receptionnaire, contact_receptionnaire, 
       adresse_livraison, description_colis, photo_colis, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING *
    `;

    const values = [de, a, prix, nom_receptionnaire || '', prenom_receptionnaire || '',
      contact_receptionnaire || '', adresse_livraison || '', description_colis || '',
      photo_colis || '', status || 'En attente'];

    const result = await pool.query(query, values);
    res.json({ success: true, colis: result.rows[0] });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: error.message });
  }
});

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

app.get('/livreurs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM livreurs ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/livreurs/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM livreurs WHERE id = $1', [req.params.id]);
    res.json(result.rows[0] || { error: 'Not found' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/livreurs', async (req, res) => {
  try {
    const { nom, phone } = req.body;
    
    if (!nom || !phone) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const existing = await pool.query(
      'SELECT id FROM livreurs WHERE LOWER(nom) = LOWER($1)',
      [nom]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ 
        error: `⚠️ Le livreur "${nom}" existe déjà dans le système !` 
      });
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
    if (e.code === '23505') {
      return res.status(400).json({ 
        error: `⚠️ Ce nom de livreur existe déjà !` 
      });
    }
    res.status(500).json({ error: 'Creation failed' });
  }
});

// ============================================
// TRACKING ROUTES
// ============================================

app.post('/tracking', async (req, res) => {
  try {
    const { colis_id, latitude, longitude, adresse, status } = req.body;
    const result = await pool.query(
      `INSERT INTO tracking (colis_id, latitude, longitude, adresse, status, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [colis_id, latitude, longitude, adresse, status]
    );
    res.json({ success: true, tracking: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/tracking/:colis_id', async (req, res) => {
  try {
    const colis_id = req.params.colis_id;
    const result = await pool.query(
      `SELECT t.*, c.livreur, l.nom as livreur_nom, l.phone as livreur_phone
       FROM tracking t
       LEFT JOIN colis c ON t.colis_id = c.id
       LEFT JOIN livreurs l ON c.livreur = l.id
       WHERE t.colis_id = $1
       ORDER BY t.created_at DESC LIMIT 1`,
      [colis_id]
    );

    if (result.rows.length === 0) {
      return res.json({ 
        message: 'Aucune position enregistrée encore',
        latitude: null,
        longitude: null
      });
    }

    const position = result.rows[0];
    res.json({
      latitude: position.latitude,
      longitude: position.longitude,
      adresse: position.adresse,
      status: position.status,
      livreur_nom: position.livreur_nom || 'N/A',
      livreur_phone: position.livreur_phone || 'N/A',
      timestamp: position.created_at
    });
  } catch (error) {
    console.error('Erreur get tracking:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/tracking-history/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM tracking WHERE colis_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// SIGNATURES ROUTES
// ============================================

app.post('/parcels/:id/sign', async (req, res) => {
  try {
    const colis_id = req.params.id;
    const { nom, signature, statut } = req.body;

    if (!nom || !signature) {
      return res.status(400).json({ error: 'nom ou signature manquante' });
    }

    const signResult = await pool.query(
      `INSERT INTO signatures (colis_id, nom, signature_data, created_at)
       VALUES ($1, $2, $3, NOW()) RETURNING id`,
      [colis_id, nom, signature]
    );

    const signature_id = signResult.rows[0].id;

    await pool.query(
      `UPDATE colis SET status = $1, signature_id = $2, date_livraison = NOW(), updated_at = NOW() WHERE id = $3`,
      [statut || 'Livré', signature_id, colis_id]
    );

    res.json({ success: true, message: '✅ Colis livré et signé !', signature_id });
  } catch (error) {
    console.error('Erreur signature:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/signatures/:colis_id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM signatures WHERE colis_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.params.colis_id]
    );
    res.json(result.rows[0] || { error: 'No signature found' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// AUTHENTICATION ROUTES
// ============================================

app.post('/auth/register', async (req, res) => {
  try {
    const { email, password, nom_entreprise } = req.body;

    if (!email || !password || !nom_entreprise) {
      return res.status(400).json({ error: 'Tous les champs requis' });
    }

    const existing = await pool.query('SELECT id FROM entreprises WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email déjà utilisé' });
    }

    const result = await pool.query(
      `INSERT INTO entreprises (email, password, nom_entreprise, created_at)
       VALUES ($1, $2, $3, NOW()) RETURNING id, email, nom_entreprise`,
      [email, password, nom_entreprise]
    );

    res.status(201).json({
      success: true,
      message: '✅ Entreprise créée ! Connectez-vous.',
      entreprise: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    const result = await pool.query(
      'SELECT id, email, nom_entreprise FROM entreprises WHERE email = $1 AND password = $2',
      [email, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const entreprise = result.rows[0];
    res.json({
      success: true,
      message: '✅ Connecté !',
      entreprise: entreprise,
      token: `token_${entreprise.id}_${Date.now()}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Backend: https://saas-livraison-cotonou-backend.onrender.com`);
});

module.exports = app;