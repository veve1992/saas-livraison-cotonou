const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.SECRET_KEY || 'your-super-secret-key-change-in-production';

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
// JWT FUNCTIONS
// ============================================

// Fonction générer JWT
const generateJWT = (id, email, type, enterprise_id) => {
  return jwt.sign(
    {
      id: id,
      email: email,
      type: type,  // 'gestionnaire' ou 'livreur'
      enterprise_id: enterprise_id,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60)  // 24h expiration
    },
    SECRET_KEY
  );
};

// Middleware vérifier JWT
const verifyJWT = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded;  // Stocker dans req pour utiliser dans routes
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
};
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
app.get('/parcels', verifyJWT, async (req, res) => {
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
app.get('/parcels/:id', verifyJWT, async (req, res) => {
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
app.post('/parcels', verifyJWT, async (req, res) => {
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
   app.put('/parcels/:id', verifyJWT, async (req, res) => {
  try {
    const colis_id = req.params.id;
    const { status, livreur, enterprise_id, latitude, longitude, signature } = req.body;
    
    if (!enterprise_id) {
      return res.status(400).json({ error: 'enterprise_id requis' });
    }
    if (!status) {
      return res.status(400).json({ error: 'Status manquant' });
    }

    // Vérifier que le colis appartient à l'entreprise
    const checkColis = await pool.query(
      'SELECT * FROM colis WHERE id = $1 AND enterprise_id = $2',
      [colis_id, enterprise_id]
    );

    if (checkColis.rows.length === 0) {
      return res.status(403).json({ error: '❌ Accès refusé à ce colis' });
    }

    // Construire la requête UPDATE dynamiquement
    let updateQuery = `UPDATE colis SET status = $1, updated_at = NOW()`;
    let params = [status];
    let paramIndex = 2;

    // Ajouter livreur si fourni
    if (livreur) {
      updateQuery += `, livreur = $${paramIndex}`;
      params.push(livreur);
      paramIndex++;
    }

    // Ajouter GPS si fourni
    if (latitude && longitude) {
      updateQuery += `, latitude = $${paramIndex}, longitude = $${paramIndex + 1}`;
      params.push(latitude, longitude);
      paramIndex += 2;
    }

    // Ajouter signature si fournie
    if (signature) {
      updateQuery += `, signature_id = $${paramIndex}`;
      params.push(signature);
      paramIndex++;
    }

    // ✅ ENREGISTRER DATE_LIVRAISON SEULEMENT SI STATUS = 'LIVRÉ'
    if (status === 'Livré') {
      updateQuery += `, date_livraison = NOW()`;
    }

    // Ajouter WHERE
    updateQuery += ` WHERE id = $${paramIndex} AND enterprise_id = $${paramIndex + 1} RETURNING *`;
    params.push(colis_id, enterprise_id);

    const result = await pool.query(updateQuery, params);

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
app.get('/livreurs', verifyJWT, async (req, res) => {
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
app.post('/livreurs', verifyJWT, async (req, res) => {
  const { nom, phone, enterprise_id } = req.body;

  if (!nom || !phone || !enterprise_id) {
    return res.status(400).json({ error: '❌ Tous les champs sont requis' });
  }

  try {
    // ✅ VÉRIFIER SI LIVREUR EXISTE DÉJÀ (PAR NOM + ENTERPRISE)
    const checkLivreur = await pool.query(
      'SELECT id FROM livreurs WHERE nom = $1 AND enterprise_id = $2',
      [nom, enterprise_id]
    );

    if (checkLivreur.rows.length > 0) {
      return res.status(400).json({ error: '❌ Un livreur avec ce nom existe déjà dans cette entreprise' });
    }

    // Créer le livreur (sans email/password = simple création par gestionnaire)
    const result = await pool.query(
      `INSERT INTO livreurs (nom, phone, enterprise_id, role, colis_livres, revenus, rating)
       VALUES ($1, $2, $3, 'livreur', 0, '0', '5.0')
       RETURNING id, nom, phone, enterprise_id, role`,
      [nom, phone, enterprise_id]
    );

    res.json({
      message: '✅ Livreur ajouté avec succès',
      livreur: result.rows[0]
    });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de l\'ajout du livreur' });
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

   const token = generateJWT(
  result.rows[0].id,
  result.rows[0].email,
  'gestionnaire',
  result.rows[0].id
);

res.status(201).json({
  success: true,
  message: '✅ Entreprise créée ! Connectez-vous.',
  entreprise: result.rows[0],
  token: token
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
  const token = generateJWT(
  entreprise.id,
  entreprise.email,
  'gestionnaire',
  entreprise.id
);

res.json({
  success: true,
  message: '✅ Connecté !',
  entreprise: entreprise,
  token: token
});  
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ============================================
// LIVREUR AUTHENTICATION ROUTES
// ============================================
app.post('/auth/livreur/register', async (req, res) => {
  const { nom, phone, email, password, enterprise_id } = req.body;

  if (!nom || !phone || !email || !password || !enterprise_id) {
    return res.status(400).json({ error: '❌ Tous les champs sont requis' });
  }

  try {
    // ✅ VÉRIFIER SI LIVREUR EXISTE DÉJÀ
    const checkLivreur = await pool.query(
      'SELECT id FROM livreurs WHERE (nom = $1 AND email = $2 AND enterprise_id = $3) OR (email = $4 AND enterprise_id = $5)',
      [nom, email, enterprise_id, email, enterprise_id]
    );

    if (checkLivreur.rows.length > 0) {
      return res.status(400).json({ error: '❌ Ce livreur existe déjà pour cette entreprise' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Créer le livreur
    const result = await pool.query(
      `INSERT INTO livreurs (nom, phone, email, password, enterprise_id, role, colis_livres, revenus, rating)
       VALUES ($1, $2, $3, $4, $5, 'livreur', 0, '0', '5.0')
       RETURNING id, nom, phone, email, enterprise_id`,
      [nom, phone, email, hashedPassword, enterprise_id]
    );

    const livreur = result.rows[0];

    // Générer JWT
    const token = generateJWT(livreur.id, livreur.email, 'livreur', enterprise_id);

    res.json({
      message: '✅ Livreur inscrit avec succès',
      livreur,
      token
    });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de l\'inscription' });
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
const token = generateJWT(
  livreur.id,
  livreur.email,
  'livreur',
  livreur.enterprise_id
);

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
  token: token
});
   
  } catch (error) {
    console.error('Erreur login livreur:', error);
    res.status(500).json({ error: error.message });
  }
});
// ============================================
// TRACKING ROUTES
// ============================================

app.post('/tracking', verifyJWT, async (req, res) => {
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

app.get('/tracking/:colis_id', verifyJWT, async (req, res) => {
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

app.get('/livreur/mes-colis/:livreur_id', verifyJWT, async (req, res) => {
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