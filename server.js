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

// GET ALL PARCELS WITH PAGINATION
app.get('/parcels', async (req, res) => {
  try {
    const enterprise_id = req.query.enterprise_id;
    if (!enterprise_id) {
      return res.status(400).json({ error: 'enterprise_id requis' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;

    const countResult = await pool.query('SELECT COUNT(*) FROM colis WHERE enterprise_id = $1', [enterprise_id]);
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      'SELECT * FROM colis WHERE enterprise_id = $1 ORDER BY id DESC LIMIT $2 OFFSET $3',
      [enterprise_id, limit, offset]
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
// GET ONE PARCEL
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
    const { de, a, prix, nom_receptionnaire, prenom_receptionnaire,
      contact_receptionnaire, adresse_livraison, description_colis, photo_colis, status, enterprise_id } = req.body;

    if (!enterprise_id) {
      return res.status(400).json({ error: 'enterprise_id requis' });
    }

    const query = `
      INSERT INTO colis 
      (de, a, prix, nom_receptionnaire, prenom_receptionnaire, contact_receptionnaire, 
       adresse_livraison, description_colis, photo_colis, status, enterprise_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      RETURNING *
    `;

    const values = [de, a, prix, nom_receptionnaire || '', prenom_receptionnaire || '',
      contact_receptionnaire || '', adresse_livraison || '', description_colis || '',
      photo_colis || '', status || 'En attente', enterprise_id];

    const result = await pool.query(query, values);
    res.json({ success: true, colis: result.rows[0] });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: error.message });
  }
});
// UPDATE PARCEL STATUS
    app.put('/parcels/:id', async (req, res) => {
  try {
    const colis_id = req.params.id;
    const { status, livreur, enterprise_id } = req.body;

    if (!enterprise_id) {
      return res.status(400).json({ error: 'enterprise_id requis' });
    }

    if (!status) {
      return res.status(400).json({ error: 'Status manquant' });
    }

    const result = await pool.query(
      `UPDATE colis 
       SET status = $1, livreur = $2, updated_at = NOW(), date_livraison = NOW()
       WHERE id = $3 AND enterprise_id = $4
       RETURNING *`,
      [status, livreur || null, colis_id, enterprise_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Colis non trouvé' });
    }

    res.json({
      success: true,
      message: '✅ Colis mis à jour',
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
    const enterprise_id = req.query.enterprise_id;
    if (!enterprise_id) {
      return res.status(400).json({ error: 'enterprise_id requis' });
    }

    const result = await pool.query('SELECT * FROM livreurs WHERE enterprise_id = $1 ORDER BY id', [enterprise_id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// CREATE
app.post('/livreurs', async (req, res) => {
  try {
    const { nom, phone, enterprise_id } = req.body;
    
    if (!nom || !phone || !enterprise_id) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const existing = await pool.query(
      'SELECT id FROM livreurs WHERE LOWER(nom) = LOWER($1) AND enterprise_id = $2',
      [nom, enterprise_id]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ 
        error: `⚠️ Le livreur "${nom}" existe déjà dans votre entreprise !` 
      });
    }

    const result = await pool.query(
      'INSERT INTO livreurs (nom, phone, enterprise_id, colis_livres, revenus, rating, created_at) VALUES ($1, $2, $3, 0, 0, 5.0, NOW()) RETURNING *',
      [nom, phone, enterprise_id]
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
// AUTHENTICATION ROUTES
// ============================================

app.post('/auth/register', async (req, res) => {
  try {
    const { email, password, nom_entreprise, country, phone_prefix } = req.body;

    // VALIDATION EN PREMIER (dans la fonction)
    if (!email || !password || !nom_entreprise || !country) {
      return res.status(400).json({ error: 'Tous les champs requis' });
    }

    // Vérifier si email existe
    const existing = await pool.query('SELECT id FROM entreprises WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email déjà utilisé' });
    }

    // Créer entreprise (AVEC country et phone_prefix)
    const result = await pool.query(
      `INSERT INTO entreprises (email, password, nom_entreprise, country, phone_prefix, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id, email, nom_entreprise, country, phone_prefix`,
      [email, password, nom_entreprise, country, phone_prefix || '+229']
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
      'SELECT id, email, nom_entreprise, country, phone_prefix FROM entreprises WHERE email = $1 AND password = $2',
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
// LIVREUR AUTHENTICATION ROUTES
// ============================================

app.post('/auth/livreur/register', async (req, res) => {
  try {
    const { email, password, nom, phone, enterprise_id } = req.body;

    if (!email || !password || !nom || !enterprise_id) {
      return res.status(400).json({ error: 'Tous les champs requis' });
    }

    // Vérifier que l'entreprise existe
    const entrepriseExists = await pool.query(
      'SELECT id FROM entreprises WHERE id = $1',
      [enterprise_id]
    );
    if (entrepriseExists.rows.length === 0) {
      return res.status(400).json({ error: 'Entreprise introuvable' });
    }

    // Vérifier email unique
    const existing = await pool.query(
      'SELECT id FROM livreurs WHERE email = $1',
      [email]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email déjà utilisé' });
    }

    // Créer livreur avec email/password
    const result = await pool.query(
      `INSERT INTO livreurs (email, password, nom, phone, enterprise_id, role, colis_livres, revenus, rating, created_at)
       VALUES ($1, $2, $3, $4, $5, 'livreur', 0, 0, 5.0, NOW())
       RETURNING id, email, nom, phone, enterprise_id, role`,
      [email, password, nom, phone || '', enterprise_id]
    );

    res.status(201).json({
      success: true,
      message: '✅ Livreur créé ! Connectez-vous.',
      livreur: result.rows[0]
    });
  } catch (error) {
    console.error('Erreur register livreur:', error);
    res.status(500).json({ error: error.message });
  }
});
app.post('/auth/livreur/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    // Chercher livreur avec email et password
    const result = await pool.query(
      `SELECT id, email, nom, phone, enterprise_id, role, colis_livres, revenus, rating
       FROM livreurs
       WHERE email = $1 AND password = $2 AND role = 'livreur'`,
      [email, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const livreur = result.rows[0];

    // Récupérer infos entreprise
    const entrepriseResult = await pool.query(
      'SELECT id, nom_entreprise, country, phone_prefix FROM entreprises WHERE id = $1',
      [livreur.enterprise_id]
    );

    const entreprise = entrepriseResult.rows[0] || {};

    res.json({
      success: true,
      message: '✅ Connecté !',
      livreur: {
        id: livreur.id,
        email: livreur.email,
        nom: livreur.nom,
        phone: livreur.phone,
        enterprise_id: livreur.enterprise_id,
        role: 'livreur',
        colis_livres: livreur.colis_livres,
        revenus: livreur.revenus,
        rating: livreur.rating
      },
      entreprise: {
        id: entreprise.id,
        nom_entreprise: entreprise.nom_entreprise,
        country: entreprise.country,
        phone_prefix: entreprise.phone_prefix
      },
      token: `token_livreur_${livreur.id}_${Date.now()}`
    });
  } catch (error) {
    console.error('Erreur login livreur:', error);
    res.status(500).json({ error: error.message });
  }
});
// ============================================
// TRACKING ROUTES
// ============================================

app.post('/tracking', async (req, res) => {
  try {
    const { colis_id, latitude, longitude, adresse, status, enterprise_id } = req.body;

    if (!enterprise_id) {
      return res.status(400).json({ error: 'enterprise_id requis' });
    }

    const result = await pool.query(
      `INSERT INTO tracking (colis_id, latitude, longitude, adresse, status, enterprise_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
      [colis_id, latitude, longitude, adresse, status, enterprise_id]
    );
    res.json({ success: true, tracking: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/tracking/:colis_id', async (req, res) => {
  try {
    const colis_id = req.params.colis_id;
    const enterprise_id = req.query.enterprise_id;

    if (!enterprise_id) {
      return res.status(400).json({ error: 'enterprise_id requis' });
    }

    const result = await pool.query(
      `SELECT t.*, c.livreur, l.nom as livreur_nom, l.phone as livreur_phone
       FROM tracking t
       LEFT JOIN colis c ON t.colis_id = c.id
       LEFT JOIN livreurs l ON c.livreur = l.id
       WHERE t.colis_id = $1 AND c.enterprise_id = $2
       ORDER BY t.created_at DESC LIMIT 1`,
      [colis_id, enterprise_id]
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
// ============================================
// GET COLIS D'UN LIVREUR SPÉCIFIQUE
// ============================================

app.get('/livreur/mes-colis/:livreur_id', async (req, res) => {
  try {
    const livreur_id = req.params.livreur_id;
    const enterprise_id = req.query.enterprise_id;

    if (!enterprise_id) {
      return res.status(400).json({ error: 'enterprise_id requis' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;

    // Vérifier que le livreur appartient à cette entreprise
    const livreurCheck = await pool.query(
      'SELECT id FROM livreurs WHERE id = $1 AND enterprise_id = $2',
      [livreur_id, enterprise_id]
    );
    if (livreurCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    // Récupérer les colis du livreur
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM colis WHERE livreur = $1 AND enterprise_id = $2',
      [livreur_id, enterprise_id]
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      'SELECT * FROM colis WHERE livreur = $1 AND enterprise_id = $2 ORDER BY id DESC LIMIT $3 OFFSET $4',
      [livreur_id, enterprise_id, limit, offset]
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
// ============================================
// EXPORT
// ============================================

module.exports = app;
// Écouter sur un port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});