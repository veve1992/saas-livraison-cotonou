import express from 'express';
import pkg from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { FedaPay } from 'fedapay';
const { Pool } = pkg;
const SECRET_KEY = process.env.SECRET_KEY || 'your-super-secret-key-change-in-production';

const app = express();
// Configuration FedaPay
FedaPay.setApiKey(process.env.FEDAPAY_SECRET_KEY);

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

const generateJWT = (id, email, type, enterprise_id) => {
  return jwt.sign(
    {
      id: id,
      email: email,
      type: type,
      enterprise_id: enterprise_id,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
    },
    SECRET_KEY
  );
};

const verifyJWT = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded;
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

// GET ALL PARCELS WITH PAGINATION (SÉCURISÉ)
app.get('/parcels', verifyJWT, async (req, res) => {
  try {
    const enterprise_id = req.user.enterprise_id;  // ← DU JWT (SÉCURISÉ)
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

// GET ONE PARCEL (DÉJÀ SÉCURISÉ)
app.get('/parcels/:id', verifyJWT, async (req, res) => {
  try {
    const colis_id = req.params.id;
    const enterprise_id = req.user.enterprise_id;  // ← DU JWT (SÉCURISÉ)

    const result = await pool.query(
      `SELECT c.*, l.nom as livreur_nom, l.phone as livreur_phone
       FROM colis c
       LEFT JOIN livreurs l ON c.livreur::integer = l.id
       WHERE c.id = $1 AND c.enterprise_id = $2`,
      [colis_id, enterprise_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Colis non trouvé' });
    }

    res.json(result.rows[0]);
  } catch (e) {
    console.error('Erreur:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

// ROUTE PUBLIQUE SUIVI CLIENT (SANS JWT)
app.get('/tracking/public/:company_code/:colis_id', async (req, res) => {
  try {
    const { company_code, colis_id } = req.params;

    const entrepriseResult = await pool.query(
      'SELECT id FROM entreprises WHERE company_code = $1',
      [company_code.toUpperCase()]
    );

    if (entrepriseResult.rows.length === 0) {
      return res.status(403).json({ error: 'Entreprise non trouvée' });
    }

    const enterprise_id = entrepriseResult.rows[0].id;

    const colisResult = await pool.query(
      `SELECT c.*, l.nom as livreur_nom, l.phone as livreur_phone
       FROM colis c
       LEFT JOIN livreurs l ON c.livreur::integer = l.id
       WHERE c.id = $1 AND c.enterprise_id = $2`,
      [colis_id, enterprise_id]
    );

    if (colisResult.rows.length === 0) {
      return res.status(404).json({ error: 'Colis non trouvé ou accès refusé' });
    }

    res.json({
      colis: colisResult.rows[0]
    });
  } catch (e) {
    console.error('Erreur:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

// CREATE PARCEL (SÉCURISÉ)
app.post('/parcels', verifyJWT, async (req, res) => {
  try {
    const enterprise_id = req.user.enterprise_id;  // ← DU JWT (SÉCURISÉ)
    const { de, a, prix, nom_receptionnaire, prenom_receptionnaire,
      contact_receptionnaire, adresse_livraison, description_colis, photo_colis, status } = req.body;

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

// UPDATE PARCEL STATUS (SÉCURISÉ)
app.put('/parcels/:id', verifyJWT, async (req, res) => {
  try {
    const colis_id = req.params.id;
    const enterprise_id = req.user.enterprise_id;  // ← DU JWT (SÉCURISÉ)
    const { status, livreur, latitude, longitude, signature } = req.body;
    
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

    let updateQuery = `UPDATE colis SET status = $1, updated_at = NOW()`;
    let params = [status];
    let paramIndex = 2;

    if (livreur) {
      updateQuery += `, livreur = $${paramIndex}`;
      params.push(livreur);
      paramIndex++;
    }

    if (latitude && longitude) {
      updateQuery += `, latitude = $${paramIndex}, longitude = $${paramIndex + 1}`;
      params.push(latitude, longitude);
      paramIndex += 2;
    }

    if (signature) {
      updateQuery += `, signature_id = $${paramIndex}`;
      params.push(signature);
      paramIndex++;
    }

    if (status === 'Livré') {
      updateQuery += `, date_livraison = NOW()`;
    }

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

// GET ALL (SÉCURISÉ)
app.get('/livreurs', verifyJWT, async (req, res) => {
  try {
    const enterprise_id = req.user.enterprise_id;  // ← DU JWT (SÉCURISÉ)

    const result = await pool.query('SELECT * FROM livreurs WHERE enterprise_id = $1 ORDER BY id', [enterprise_id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CREATE LIVREUR
app.post('/livreurs', verifyJWT, async (req, res) => {
  const enterprise_id = req.user.enterprise_id;  // ← DU JWT (SÉCURISÉ)
  const { nom, phone } = req.body;

  if (!nom || !phone) {
    return res.status(400).json({ error: '❌ Tous les champs sont requis' });
  }

  try {
    const checkLivreur = await pool.query(
      'SELECT id FROM livreurs WHERE nom = $1 AND enterprise_id = $2',
      [nom, enterprise_id]
    );

    if (checkLivreur.rows.length > 0) {
      return res.status(400).json({ error: '❌ Un livreur avec ce nom existe déjà dans cette entreprise' });
    }

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
  const { email, password, nom_entreprise, company_code, country, phone_prefix } = req.body;

  if (!email || !password || !nom_entreprise || !company_code || !country) {
    return res.status(400).json({ error: '❌ Tous les champs sont requis' });
  }

  try {
    const checkCode = await pool.query(
      'SELECT id FROM entreprises WHERE company_code = $1',
      [company_code.toUpperCase()]
    );

    if (checkCode.rows.length > 0) {
      return res.status(400).json({ error: '❌ Ce code entreprise existe déjà' });
    }

    const checkEmail = await pool.query(
      'SELECT id FROM entreprises WHERE email = $1',
      [email]
    );

    if (checkEmail.rows.length > 0) {
      return res.status(400).json({ error: '❌ Cet email est déjà utilisé' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO entreprises (email, password, nom_entreprise, company_code, country, phone_prefix, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING id, email, nom_entreprise, company_code, country, phone_prefix`,
      [email, hashedPassword, nom_entreprise, company_code.toUpperCase(), country, phone_prefix]
    );

    const entreprise = result.rows[0];
    const token = generateJWT(entreprise.id, entreprise.email, 'gestionnaire', entreprise.id);

    res.json({
      message: '✅ Entreprise inscrite avec succès',
      entreprise,
      token
    });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de l\'inscription' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: '❌ Email et mot de passe requis' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM entreprises WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: '❌ Email ou mot de passe incorrect' });
    }

    const entreprise = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, entreprise.password);

    if (!passwordMatch) {
      return res.status(400).json({ error: '❌ Email ou mot de passe incorrect' });
    }

    const token = generateJWT(entreprise.id, entreprise.email, 'gestionnaire', entreprise.id);

    res.json({
      message: '✅ Connexion réussie',
      entreprise: {
        id: entreprise.id,
        email: entreprise.email,
        nom_entreprise: entreprise.nom_entreprise,
        company_code: entreprise.company_code,
        country: entreprise.country,
        phone_prefix: entreprise.phone_prefix
      },
      token
    });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de la connexion' });
  }
});

// ============================================
// LIVREUR AUTHENTICATION ROUTES
// ============================================

app.post('/auth/livreur/register', async (req, res) => {
  const { nom, phone, email, password, company_code } = req.body;

  if (!nom || !phone || !email || !password || !company_code) {
    return res.status(400).json({ error: '❌ Tous les champs sont requis' });
  }

  try {
    const entrepriseResult = await pool.query(
      'SELECT id FROM entreprises WHERE company_code = $1',
      [company_code.toUpperCase()]
    );

    if (entrepriseResult.rows.length === 0) {
      return res.status(400).json({ error: '❌ Code entreprise invalide' });
    }

    const enterprise_id = entrepriseResult.rows[0].id;

    const checkLivreur = await pool.query(
      'SELECT id FROM livreurs WHERE (nom = $1 AND email = $2 AND enterprise_id = $3) OR (email = $4 AND enterprise_id = $5)',
      [nom, email, enterprise_id, email, enterprise_id]
    );

    if (checkLivreur.rows.length > 0) {
      return res.status(400).json({ error: '❌ Ce livreur existe déjà pour cette entreprise' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO livreurs (nom, phone, email, password, enterprise_id, role, colis_livres, revenus, rating)
       VALUES ($1, $2, $3, $4, $5, 'livreur', 0, '0', '5.0')
       RETURNING id, nom, phone, email, enterprise_id`,
      [nom, phone, email, hashedPassword, enterprise_id]
    );

    const livreur = result.rows[0];

    const entrepriseData = await pool.query(
      'SELECT id, nom_entreprise, country, phone_prefix FROM entreprises WHERE id = $1',
      [enterprise_id]
    );

    const entreprise = entrepriseData.rows[0];
    const token = generateJWT(livreur.id, livreur.email, 'livreur', enterprise_id);

    res.json({
      message: '✅ Livreur inscrit avec succès',
      livreur,
      entreprise,
      token
    });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de l\'inscription' });
  }
});

app.post('/auth/livreur/login', async (req, res) => {
  const { email, password, company_code } = req.body;

  if (!email || !password || !company_code) {
    return res.status(400).json({ error: '❌ Email, mot de passe et code entreprise requis' });
  }

  try {
    const entrepriseResult = await pool.query(
      'SELECT id FROM entreprises WHERE company_code = $1',
      [company_code.toUpperCase()]
    );

    if (entrepriseResult.rows.length === 0) {
      return res.status(400).json({ error: '❌ Code entreprise invalide' });
    }

    const enterprise_id = entrepriseResult.rows[0].id;

    const result = await pool.query(
      'SELECT * FROM livreurs WHERE email = $1 AND enterprise_id = $2',
      [email, enterprise_id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: '❌ Email ou mot de passe incorrect' });
    }

    const livreur = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, livreur.password);

    if (!passwordMatch) {
      return res.status(400).json({ error: '❌ Email ou mot de passe incorrect' });
    }

    const entrepriseData = await pool.query(
      'SELECT id, nom_entreprise, country, phone_prefix FROM entreprises WHERE id = $1',
      [enterprise_id]
    );

    const entreprise = entrepriseData.rows[0];
    const token = generateJWT(livreur.id, livreur.email, 'livreur', enterprise_id);

    res.json({
      message: '✅ Connexion réussie',
      livreur: {
        id: livreur.id,
        nom: livreur.nom,
        phone: livreur.phone,
        email: livreur.email,
        enterprise_id: livreur.enterprise_id,
        role: livreur.role,
        colis_livres: livreur.colis_livres,
        revenus: livreur.revenus,
        rating: livreur.rating
      },
      entreprise,
      token
    });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de la connexion' });
  }
});

// ============================================
// TRACKING ROUTES
// ============================================

app.post('/tracking', verifyJWT, async (req, res) => {
  try {
    const enterprise_id = req.user.enterprise_id;  // ← DU JWT (SÉCURISÉ)
    const { colis_id, latitude, longitude, adresse, status } = req.body;

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
    const enterprise_id = req.user.enterprise_id;  // ← DU JWT (SÉCURISÉ)

    const result = await pool.query(
      `SELECT t.*, c.livreur, l.nom as livreur_nom, l.phone as livreur_phone
       FROM tracking t
       LEFT JOIN colis c ON t.colis_id = c.id
       LEFT JOIN livreurs l ON c.livreur::integer = l.id
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
    const enterprise_id = req.user.enterprise_id;  // ← DU JWT (SÉCURISÉ)

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

export default app;

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});