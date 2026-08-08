import express from 'express';
import pkg from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

// ====================================
// CONFIGURATION
// ====================================
const { Pool } = pkg;

const SECRET_KEY = process.env.SECRET_KEY || 'your-super-secret-key-change-in-production';
const app = express();

// ====================================
// DATABASE
// ====================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// ====================================
// MIDDLEWARE
// ====================================
app.use(express.json());
app.use(cors());

// ====================================
// VERIFY JWT
// ====================================
const verifyJWT = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  
  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(401).json({ error: 'Token invalide' });
    req.user = user;
    next();
  });
};

// ====================================
// ROUTES SANTÉ
// ====================================
app.get('/health', (req, res) => {
  res.json({ status: '✅ Backend en ligne' });
});

// ====================================
// ROUTE INSCRIPTION GESTIONNAIRE
// ====================================
app.post('/register-gestionnaire', async (req, res) => {
  try {
    const { email, password, nom_entreprise, company_code, country, phone_prefix } = req.body;
    
    if (!email || !password || !nom_entreprise || !company_code) {
      return res.status(400).json({ error: 'Champs manquants' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      'INSERT INTO entreprises (email, password, nom_entreprise, company_code, country, phone_prefix, plan) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, email, nom_entreprise, company_code',
      [email, hashedPassword, nom_entreprise, company_code, country || 'BJ', phone_prefix || '+229', 'startup']
    );

    const token = jwt.sign({ 
      id: result.rows[0].id, 
      email: result.rows[0].email,
      enterprise_id: result.rows[0].id
    }, SECRET_KEY, { expiresIn: '24h' });

    res.json({
      success: true,
      message: '✅ Inscription réussie',
      token,
      entreprise: result.rows[0]
    });
  } catch (error) {
    console.error('Erreur inscription:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// ROUTE LOGIN GESTIONNAIRE
// ====================================
app.post('/login-gestionnaire', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

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

    const token = jwt.sign({ 
      id: entreprise.id, 
      email: entreprise.email,
      enterprise_id: entreprise.id
    }, SECRET_KEY, { expiresIn: '24h' });

    res.json({
      success: true,
      token,
      entreprise: {
        id: entreprise.id,
        email: entreprise.email,
        nom_entreprise: entreprise.nom_entreprise,
        company_code: entreprise.company_code,
        country: entreprise.country,
        phone_prefix: entreprise.phone_prefix
      }
    });
  } catch (error) {
    console.error('Erreur login:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// ROUTE INSCRIPTION LIVREUR
// ====================================
app.post('/register-livreur', async (req, res) => {
  try {
    const { email, password, nom, phone, company_code } = req.body;
    
    if (!email || !password || !nom || !phone || !company_code) {
      return res.status(400).json({ error: 'Champs manquants' });
    }

    const entrepriseResult = await pool.query(
      'SELECT id FROM entreprises WHERE company_code = $1',
      [company_code]
    );

    if (entrepriseResult.rows.length === 0) {
      return res.status(400).json({ error: 'Code entreprise invalide' });
    }

    const enterprise_id = entrepriseResult.rows[0].id;
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO livreurs (email, password, nom, phone, enterprise_id, role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [email, hashedPassword, nom, phone, enterprise_id, 'livreur']
    );

    const token = jwt.sign({ 
      id: result.rows[0].id, 
      email: result.rows[0].email,
      enterprise_id: enterprise_id
    }, SECRET_KEY, { expiresIn: '24h' });

    res.json({
      success: true,
      message: '✅ Inscription livreur réussie',
      token,
      livreur: result.rows[0]
    });
  } catch (error) {
    console.error('Erreur inscription livreur:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// ROUTE LOGIN LIVREUR
// ====================================
app.post('/login-livreur', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    const result = await pool.query(
      'SELECT * FROM livreurs WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: '❌ Email ou mot de passe incorrect' });
    }

    const livreur = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, livreur.password);

    if (!passwordMatch) {
      return res.status(400).json({ error: '❌ Email ou mot de passe incorrect' });
    }

    const token = jwt.sign({ 
      id: livreur.id, 
      email: livreur.email,
      enterprise_id: livreur.enterprise_id
    }, SECRET_KEY, { expiresIn: '24h' });

    const entrepriseResult = await pool.query(
      'SELECT * FROM entreprises WHERE id = $1',
      [livreur.enterprise_id]
    );

    res.json({
      success: true,
      token,
      livreur: {
        id: livreur.id,
        nom: livreur.nom,
        phone: livreur.phone,
        email: livreur.email
      },
      entreprise: entrepriseResult.rows[0]
    });
  } catch (error) {
    console.error('Erreur login livreur:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// ROUTES COLIS
// ====================================
app.post('/parcels', verifyJWT, async (req, res) => {
  try {
    const { de, a, prix, enterprise_id, nom_receptionnaire, prenom_receptionnaire, contact_receptionnaire, adresse_livraison, description_colis, photo_colis, status } = req.body;
    
    if (!de || !a || !prix || !enterprise_id) {
      return res.status(400).json({ error: 'Champs requis manquants' });
    }

    const result = await pool.query(
      'INSERT INTO colis (de, a, prix, enterprise_id, nom_receptionnaire, prenom_receptionnaire, contact_receptionnaire, adresse_livraison, description_colis, photo_colis, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
      [de, a, prix, enterprise_id, nom_receptionnaire, prenom_receptionnaire, contact_receptionnaire, adresse_livraison, description_colis, photo_colis, status || 'En attente']
    );

    res.json({ success: true, parcel: result.rows[0] });
  } catch (error) {
    console.error('Erreur création colis:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/parcels', verifyJWT, async (req, res) => {
  try {
    const { page = 1, enterprise_id } = req.query;
    const limit = 10;
    const offset = (page - 1) * limit;

    if (!enterprise_id) {
      return res.status(400).json({ error: 'enterprise_id requis' });
    }

    const result = await pool.query(
      'SELECT * FROM colis WHERE enterprise_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [enterprise_id, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM colis WHERE enterprise_id = $1',
      [enterprise_id]
    );

    const total = parseInt(countResult.rows[0].total);
    const pages = Math.ceil(total / limit);

    res.json({
      data: result.rows,
      page: parseInt(page),
      pages,
      total
    });
  } catch (error) {
    console.error('Erreur récupération colis:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// ROUTES LIVREURS
// ====================================
app.get('/livreurs', verifyJWT, async (req, res) => {
  try {
    const { enterprise_id } = req.query;

    if (!enterprise_id) {
      return res.status(400).json({ error: 'enterprise_id requis' });
    }

    const result = await pool.query(
      'SELECT * FROM livreurs WHERE enterprise_id = $1',
      [enterprise_id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Erreur récupération livreurs:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// ROUTE TRACKING PUBLIC
// ====================================
app.get('/tracking/public/:company_code/:colis_id', async (req, res) => {
  try {
    const { company_code, colis_id } = req.params;

    const entrepriseResult = await pool.query(
      'SELECT id FROM entreprises WHERE company_code = $1',
      [company_code]
    );

    if (entrepriseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Entreprise non trouvée' });
    }

    const enterprise_id = entrepriseResult.rows[0].id;

    const result = await pool.query(
      'SELECT c.*, l.nom as livreur_nom, l.phone as livreur_phone FROM colis c LEFT JOIN livreurs l ON c.livreur::integer = l.id WHERE c.id = $1 AND c.enterprise_id = $2',
      [colis_id, enterprise_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Colis non trouvé' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erreur tracking:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/tracking/:colis_id', verifyJWT, async (req, res) => {
  try {
    const { colis_id } = req.params;
    const enterprise_id = req.user.enterprise_id;

    const result = await pool.query(
      'SELECT * FROM tracking WHERE colis_id = $1 AND enterprise_id = $2 ORDER BY created_at DESC LIMIT 1',
      [colis_id, enterprise_id]
    );

    if (result.rows.length === 0) {
      return res.json({ message: 'Aucune position enregistrée' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erreur tracking:', error);
    res.status(500).json({ error: error.message });
  }
});
// ====================================
// ROUTE PAIEMENT FEDAPAY (AVEC API - VERSION ROBUSTE)
// ====================================
app.post('/api/payment', verifyJWT, async (req, res) => {
  try {
    const { plan, amount, currency } = req.body;
    const enterprise_id = req.user.enterprise_id;

    console.log('💳 Création transaction FedaPay:', { plan, amount, currency });

    if (!plan || !amount) {
      return res.status(400).json({ error: 'Plan et montant requis' });
    }

    // Vérifier que la clé API existe
    if (!process.env.FEDAPAY_SECRET_KEY) {
      console.error('❌ FEDAPAY_SECRET_KEY non configurée');
      return res.status(500).json({ error: 'Paiement non configuré' });
    }

    console.log('🔑 Utilisant clé FedaPay configurée');

    // Appeler FedaPay API avec gestion d'erreur complète
    const fedapayResponse = await fetch('https://api.fedapay.com/v1/transactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FEDAPAY_SECRET_KEY}`
      },
      body: JSON.stringify({
        description: `Abonnement ${plan} - DeliverHub`,
        amount: amount,
        currency: currency || 'XOF',
        customer_email: req.user.email,
        metadata: {
          plan: plan,
          enterprise_id: enterprise_id,
          type: 'subscription'
        }
      })
    });

    console.log('📡 FedaPay Response Status:', fedapayResponse.status);

    // Vérifier le status de la réponse
    if (!fedapayResponse.ok) {
      const errorText = await fedapayResponse.text();
      console.error('❌ FedaPay API Error Status:', fedapayResponse.status);
      console.error('❌ FedaPay API Error Body:', errorText);
      
      return res.status(500).json({
        error: 'Erreur FedaPay API',
        status: fedapayResponse.status,
        message: 'Le service de paiement a retourné une erreur'
      });
    }

    // Essayer de parser la réponse JSON
    const responseText = await fedapayResponse.text();
    
    if (!responseText) {
      console.error('❌ FedaPay retourne une réponse vide');
      return res.status(500).json({
        error: 'Réponse vide de FedaPay',
        message: 'Le service de paiement ne répond pas correctement'
      });
    }

    let transaction;
    try {
      transaction = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ Erreur parsing JSON FedaPay:', parseError);
      console.error('❌ Réponse reçue:', responseText.substring(0, 200));
      
      return res.status(500).json({
        error: 'Erreur parsing réponse FedaPay',
        message: 'Le format de réponse est invalide'
      });
    }

    console.log('✅ Transaction créée:', transaction.id);
    console.log('✅ Lien paiement:', transaction.authorize_url);

    // Générer le lien de paiement
    const paymentLink = transaction.authorize_url || 
                       transaction.checkout_url ||
                       `https://app.fedapay.com/checkout/${transaction.token}`;

    res.json({
      success: true,
      transaction_id: transaction.id,
      payment_link: paymentLink,
      plan: plan,
      amount: amount,
      currency: currency || 'XOF',
      message: 'Redirection vers FedaPay'
    });

  } catch (error) {
    console.error('❌ Erreur paiement:', error.message);
    console.error('❌ Stack:', error.stack);
    
    res.status(500).json({
      error: 'Erreur lors de la création du paiement',
      details: error.message
    });
  }
});

// ====================================
// WEBHOOK FEDAPAY (POUR CONFIRMER LES PAIEMENTS)
// ====================================
app.post('/webhook/fedapay', async (req, res) => {
  try {
    const event = req.body;
    
    console.log('📩 Webhook FedaPay reçu:', event.type);

    if (event.type === 'transaction.success') {
      const transaction = event.data;
      const metadata = transaction.metadata || {};
      
      console.log(`✅ PAIEMENT CONFIRMÉ - Enterprise: ${metadata.enterprise_id}, Plan: ${metadata.plan}`);
      
      // Mettre à jour le plan dans la base de données
      if (metadata.enterprise_id && metadata.plan) {
        const result = await pool.query(
          'UPDATE entreprises SET plan = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
          [metadata.plan, metadata.enterprise_id]
        );
        
        if (result.rows.length > 0) {
          console.log(`✅ Plan ${metadata.plan} activé pour enterprise ${metadata.enterprise_id}`);
        }
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('❌ Erreur webhook:', error);
    res.status(400).json({ error: error.message });
  }
});
// ====================================
// ROUTE UPDATE COLIS LIVREUR
// ====================================
app.put('/parcels/:id/livreur', verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { livreur } = req.body;

    const result = await pool.query(
      'UPDATE colis SET livreur = $1 WHERE id = $2 RETURNING *',
      [livreur, id]
    );

    res.json({ success: true, parcel: result.rows[0] });
  } catch (error) {
    console.error('Erreur update livreur:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/parcels/:id/status', verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const result = await pool.query(
      'UPDATE colis SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
    );

    res.json({ success: true, parcel: result.rows[0] });
  } catch (error) {
    console.error('Erreur update status:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// DÉMARRER LE SERVEUR
// ====================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Backend en ligne sur port ${PORT}`);
});

export default app;