// ====================================
// BACKEND ROUTES : TRACKING + SMS + SIGNATURE
// ====================================

const express = require('express');
const twilio = require('twilio');
require('dotenv').config();

const router = express.Router();
const pool = require('./database'); // Votre connexion DB

// ====================================
// TWILIO SETUP
// ====================================

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;

// ====================================
// HELPER : Envoyer SMS
// ====================================

async function sendSMS(to, message) {
  try {
    await twilioClient.messages.create({
      body: message,
      from: TWILIO_PHONE,
      to: to
    });
    console.log(`SMS envoyé à ${to}`);
    return true;
  } catch (error) {
    console.error('Erreur Twilio:', error);
    return false;
  }
}

// ====================================
// 1. LIVREUR PREND LE COLIS
// ====================================

router.post('/parcels/:id/pickup', async (req, res) => {
  try {
    const { livreur_id } = req.body;
    const colis_id = req.params.id;

    // Récupérer info colis
    const parcel = await pool.query(
      'SELECT * FROM colis WHERE id = $1',
      [colis_id]
    );

    if (parcel.rows.length === 0) {
      return res.status(404).json({ error: 'Colis non trouvé' });
    }

    const colis = parcel.rows[0];

    // UPDATE status
    await pool.query(
      `UPDATE colis 
       SET status = $1, livreur = $2, date_levee = NOW()
       WHERE id = $3`,
      ['Pris', livreur_id, colis_id]
    );

    // Récupérer info livreur
    const livreur = await pool.query(
      'SELECT * FROM livreurs WHERE id = $1',
      [livreur_id]
    );

    // Envoyer SMS au client
    if (colis.numero_receptionnaire) {
      const message = `✅ Votre colis #${colis_id} a été levé par ${livreur.rows[0].nom}. 
Numéro suivi: ${livreur.rows[0].phone}
Livraison estimée dans 1-2h.`;
      
      await sendSMS(colis.numero_receptionnaire, message);
    }

    res.json({
      success: true,
      message: 'Colis pris et SMS envoyé au client',
      colis_id
    });
  } catch (error) {
    console.error('Erreur pickup:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// 2. ENVOYER POSITION GPS (TRACKING)
// ====================================

router.post('/tracking', async (req, res) => {
  try {
    const { colis_id, livreur_id, latitude, longitude, adresse } = req.body;

    // Valider les données
    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Latitude/Longitude manquantes' });
    }

    // Enregistrer la position
    await pool.query(
      `INSERT INTO tracking (colis_id, livreur_id, latitude, longitude, adresse, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'En route', NOW())`,
      [colis_id, livreur_id, latitude, longitude, adresse]
    );

    res.json({
      success: true,
      message: 'Position enregistrée'
    });
  } catch (error) {
    console.error('Erreur tracking:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// 3. OBTENIR POSITION EN DIRECT
// ====================================

router.get('/tracking/:colis_id', async (req, res) => {
  try {
    const { colis_id } = req.params;

    // Récupérer la DERNIÈRE position
    const tracking = await pool.query(
      `SELECT * FROM tracking 
       WHERE colis_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [colis_id]
    );

    if (tracking.rows.length === 0) {
      return res.json({ 
        message: 'Aucune position enregistrée encore',
        latitude: null,
        longitude: null
      });
    }

    const position = tracking.rows[0];

    res.json({
      latitude: position.latitude,
      longitude: position.longitude,
      adresse: position.adresse,
      status: position.status,
      timestamp: position.created_at
    });
  } catch (error) {
    console.error('Erreur get tracking:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// 4. HISTORIQUE GPS D'UN COLIS
// ====================================

router.get('/tracking-history/:colis_id', async (req, res) => {
  try {
    const { colis_id } = req.params;

    const tracking = await pool.query(
      `SELECT * FROM tracking 
       WHERE colis_id = $1 
       ORDER BY created_at ASC`,
      [colis_id]
    );

    res.json({
      success: true,
      total: tracking.rows.length,
      positions: tracking.rows
    });
  } catch (error) {
    console.error('Erreur tracking history:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// 5. CLIENT SIGNE (SIGNATURE ÉLECTRONIQUE)
// ====================================

router.post('/parcels/:id/sign', async (req, res) => {
  try {
    const { signature_data, nom_client, notes } = req.body;
    const colis_id = req.params.id;

    if (!signature_data || !nom_client) {
      return res.status(400).json({ error: 'Signature ou nom manquant' });
    }

    // Convertir base64 en buffer
    const signatureBuffer = Buffer.from(signature_data.split(',')[1], 'base64');

    // Enregistrer la signature
    const signature = await pool.query(
      `INSERT INTO signatures 
       (colis_id, signature_image, nom_client, date_signature, notes)
       VALUES ($1, $2, $3, NOW(), $4)
       RETURNING id`,
      [colis_id, signatureBuffer, nom_client, notes]
    );

    const signature_id = signature.rows[0].id;

    // UPDATE colis avec signature + date livraison
    const parcel = await pool.query(
      `UPDATE colis 
       SET status = $1, 
           signature_id = $2,
           date_livraison = NOW()
       WHERE id = $3
       RETURNING *`,
      ['Livré', signature_id, colis_id]
    );

    const colis = parcel.rows[0];

    // Envoyer SMS de confirmation
    if (colis.numero_receptionnaire) {
      const message = `✅ Votre colis #${colis_id} a été livré et signé par ${nom_client}. 
Merci d'avoir utilisé notre service! 
Besoin d'aide? Appelez-nous.`;
      
      await sendSMS(colis.numero_receptionnaire, message);
    }

    res.json({
      success: true,
      message: 'Colis signé et livré!',
      signature_id,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Erreur signature:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// 6. OBTENIR SIGNATURE (POUR VÉRIFICATION)
// ====================================

router.get('/signatures/:colis_id', async (req, res) => {
  try {
    const { colis_id } = req.params;

    const signature = await pool.query(
      `SELECT id, nom_client, date_signature, notes
       FROM signatures 
       WHERE colis_id = $1`,
      [colis_id]
    );

    if (signature.rows.length === 0) {
      return res.status(404).json({ error: 'Pas de signature pour ce colis' });
    }

    res.json({
      success: true,
      signature: signature.rows[0]
    });
  } catch (error) {
    console.error('Erreur get signature:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// 7. TÉLÉCHARGER IMAGE SIGNATURE
// ====================================

router.get('/signatures/:signature_id/image', async (req, res) => {
  try {
    const { signature_id } = req.params;

    const signature = await pool.query(
      `SELECT signature_image FROM signatures WHERE id = $1`,
      [signature_id]
    );

    if (signature.rows.length === 0) {
      return res.status(404).json({ error: 'Signature non trouvée' });
    }

    const imageBuffer = signature.rows[0].signature_image;

    res.setHeader('Content-Type', 'image/png');
    res.send(imageBuffer);
  } catch (error) {
    console.error('Erreur download signature:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// 8. STATISTIQUES LIVREUR
// ====================================

router.get('/livreurs/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;

    // Colis livrés
    const colis_livres = await pool.query(
      `SELECT COUNT(*) FROM colis WHERE livreur = $1 AND status = 'Livré'`,
      [id]
    );

    // Revenus
    const revenus = await pool.query(
      `SELECT SUM(prix * 0.20) as total FROM colis WHERE livreur = $1 AND status = 'Livré'`,
      [id]
    );

    // Signatures (preuves)
    const signatures = await pool.query(
      `SELECT COUNT(*) FROM signatures 
       WHERE colis_id IN (SELECT id FROM colis WHERE livreur = $1)`,
      [id]
    );

    res.json({
      success: true,
      colis_livres: parseInt(colis_livres.rows[0].count),
      revenus_total: parseFloat(revenus.rows[0].total) || 0,
      signatures: parseInt(signatures.rows[0].count),
      commission_rate: '20%'
    });
  } catch (error) {
    console.error('Erreur stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// EXPORT
// ====================================

module.exports = router;