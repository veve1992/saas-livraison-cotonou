// server-backend-fixed.js
// Backend Node.js/Express avec Twilio intégré
// À utiliser pour remplacer server.js

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ====================================
// CONFIGURATION DATABASE
// ====================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// ====================================
// TWILIO SETUP
// ====================================

const twilio = require('twilio');
const twilioClient = process.env.TWILIO_ACCOUNT_SID ? 
  twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN) : 
  null;

// ====================================
// MIDDLEWARE
// ====================================

app.use(cors());
app.use(express.json());

// ====================================
// HELPER : Envoyer SMS
// ====================================

async function sendSMS(phoneNumber, message) {
  if (!twilioClient) {
    console.log(`[SMS SIMULÉ] À: ${phoneNumber}`);
    console.log(`[SMS SIMULÉ] Message: ${message}`);
    return { success: true, simulated: true };
  }

  try {
    const result = await twilioClient.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber,
      body: message
    });
    console.log(`✅ SMS envoyé: ${result.sid}`);
    return { success: true, sid: result.sid };
  } catch (error) {
    console.error(`❌ Erreur SMS: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ====================================
// ROUTES
// ====================================

// Test API
app.get('/', (req, res) => {
  res.json({
    app: 'Livraison de Colis - Cotonou',
    version: '2.0.0',
    database: 'PostgreSQL',
    endpoints: {
      health: 'GET /health',
      parcels: 'GET /parcels',
      parcels_create: 'POST /parcels',
      livreurs: 'GET /livreurs',
      livreurs_create: 'POST /livreurs',
      stats: 'GET /stats'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: '✅ OK',
    database: 'PostgreSQL',
    message: 'Serveur fonctionne !'
  });
});

// ====================================
// ROUTES COLIS
// ====================================

// GET - Tous les colis
app.get('/parcels', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM colis ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur database' });
  }
});

// GET - Un colis par ID
app.get('/parcels/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM colis WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Colis non trouvé' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erreur database' });
  }
});

// POST - Créer un colis (ROUTE FIXÉE!)
app.post('/parcels', async (req, res) => {
  try {
    const { de, a, prix, status = 'En attente' } = req.body;

    // Validation
    if (!de || !a || !prix) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    // Insérer dans la database
    const result = await pool.query(
      'INSERT INTO colis (de, a, prix, status, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *',
      [de, a, prix, status]
    );

    const newParcel = result.rows[0];

    // Envoyer SMS de confirmation (OPTIONNEL - si numéro disponible)
    // await sendSMS('+229XXXXXXXXX', `Votre colis #${newParcel.id} a été créé. Destination: ${a}`);

    res.status(201).json({
      success: true,
      message: '✅ Colis créé avec succès!',
      parcel: newParcel
    });
  } catch (error) {
    console.error('Erreur POST /parcels:', error);
    res.status(500).json({ error: 'Erreur lors de la création du colis' });
  }
});

// PUT - Mettre à jour un colis
app.put('/parcels/:id', async (req, res) => {
  try {
    const { status, livreur, signature } = req.body;

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
    res.status(500).json({ error: 'Erreur database' });
  }
});

// DELETE - Supprimer un colis
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
    res.status(500).json({ error: 'Erreur database' });
  }
});

// ====================================
// ROUTES LIVREURS
// ====================================

// GET - Tous les livreurs
app.get('/livreurs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM livreurs ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erreur database' });
  }
});

// GET - Un livreur par ID
app.get('/livreurs/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM livreurs WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Livreur non trouvé' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erreur database' });
  }
});

// POST - Créer un livreur (ROUTE FIXÉE!)
app.post('/livreurs', async (req, res) => {
  try {
    const { nom, phone } = req.body;

    // Validation
    if (!nom || !phone) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    // Insérer dans la database
    const result = await pool.query(
      'INSERT INTO livreurs (nom, phone, colis_livres, revenus, rating, created_at) VALUES ($1, $2, 0, 0, 5.0, NOW()) RETURNING *',
      [nom, phone]
    );

    const newDriver = result.rows[0];

    // Envoyer SMS de bienvenue (OPTIONNEL)
    // await sendSMS(phone, `Bienvenue sur Livraison Cotonou! Votre ID livreur: ${newDriver.id}`);

    res.status(201).json({
      success: true,
      message: '✅ Livreur créé avec succès!',
      livreur: newDriver
    });
  } catch (error) {
    console.error('Erreur POST /livreurs:', error);
    res.status(500).json({ error: 'Erreur lors de la création du livreur' });
  }
});

// ====================================
// ROUTES STATISTIQUES
// ====================================

// GET - Statistiques
app.get('/stats', async (req, res) => {
  try {
    const parcelCount = await pool.query('SELECT COUNT(*) FROM colis');
    const driverCount = await pool.query('SELECT COUNT(*) FROM livreurs');
    const totalRevenue = await pool.query('SELECT SUM(revenus) as total FROM livreurs');

    res.json({
      total_parcels: parcelCount.rows[0].count,
      total_drivers: driverCount.rows[0].count,
      total_revenue: totalRevenue.rows[0].total || 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Erreur database' });
  }
});

// ====================================
// ROUTES NOTIFICATIONS
// ====================================

// POST - Envoyer SMS
app.post('/notifications/sms', async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;

    const result = await sendSMS(phoneNumber, message);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Erreur SMS' });
  }
});

// POST - Envoyer Email
app.post('/notifications/email', async (req, res) => {
  try {
    const { email, subject, message } = req.body;

    // Implémentation SendGrid (à ajouter si configuré)
    res.json({
      success: true,
      message: 'Email simulé'
    });
  } catch (error) {
    res.status(500).json({ error: 'Erreur Email' });
  }
});

// ====================================
// ERROR HANDLING
// ====================================

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

// ====================================
// START SERVER
// ====================================

app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur le port ${PORT}`);
  console.log(`🚀 API: http://localhost:${PORT}`);
  console.log(`📦 Database: ${process.env.DATABASE_URL ? 'Connecté' : 'Non configuré'}`);
  console.log(`📱 Twilio: ${process.env.TWILIO_ACCOUNT_SID ? 'Configuré' : 'Non configuré (SMS simulés)'}`);
});

module.exports = app;
