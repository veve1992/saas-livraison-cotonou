import express from 'express';
import pkg from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import axios from 'axios';

// ====================================
// FONCTION ENVOI EMAIL AVEC RESEND
// ====================================

const sendEmailToAdmin = async (subject, htmlContent) => {
  try {
    await axios.post('https://api.resend.com/emails', {
      from: 'DeliverHub <onboarding@resend.dev>',
      to: process.env.ADMIN_EMAIL,
      subject: subject,
      html: htmlContent
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      }
    });
    console.log('✅ Email admin envoyé via Resend');
  } catch (error) {
    console.error('❌ Erreur email admin:', error.message);
  }
};

const sendEmailToClient = async (email, subject, htmlContent) => {
  try {
    await axios.post('https://api.resend.com/emails', {
      from: 'DeliverHub <onboarding@resend.dev>',
      to: email,
      subject: subject,
      html: htmlContent
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      }
    });
    console.log('✅ Email client envoyé via Resend');
  } catch (error) {
    console.error('❌ Erreur email client:', error.message);
  }
};
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
    
    // Calculer expiration du trial (7 jours)
    const trialExpiry = new Date();
    trialExpiry.setDate(trialExpiry.getDate() + 7);
    
    if (!email || !password || !nom_entreprise || !company_code) {
      return res.status(400).json({ error: 'Champs manquants' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      `INSERT INTO entreprises 
       (email, password, nom_entreprise, company_code, country, phone_prefix, plan, plan_expiry, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING id, email, nom_entreprise, company_code, country, phone_prefix, plan, plan_expiry`,
      [email, hashedPassword, nom_entreprise, company_code, country || 'BJ', phone_prefix || '+229', 'startup', trialExpiry]
    );
    
    const entreprise = result.rows[0];
    
    console.log('✅ Inscription réussie:', { email, nom_entreprise, company_code });
    
    // ENVOYER EMAIL À L'ADMIN
    await sendEmailToAdmin(
      `🎉 Nouvelle inscription - ${nom_entreprise}`,
      `
        <h2>Nouvelle entreprise inscrite !</h2>
        <p><strong>Nom:</strong> ${nom_entreprise}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Code:</strong> ${company_code}</p>
        <p><strong>Pays:</strong> ${country || 'BJ'}</p>
        <p><strong>Trial expire le:</strong> ${trialExpiry.toLocaleDateString('fr-FR')}</p>
        <hr>
        <p>L'entreprise a accès au trial gratuit (7 jours, 10 colis max, 2 livreurs max).</p>
      `
    );
    // ENVOYER EMAIL AU GESTIONNAIRE
await sendEmailToClient(
  email,
  `🎉 Bienvenue sur DeliverHub !`,
  `
    <h2>Votre inscription est confirmée !</h2>
    <p>Bonjour ${nom_entreprise},</p>
    <p>Vous disposez maintenant de <strong>7 jours gratuits</strong> pour tester DeliverHub !</p>
    <hr>
    <p><strong>Votre code entreprise :</strong> ${company_code}</p>
    <p><strong>Limite trial :</strong> 10 colis, 2 livreurs</p>
    <p><strong>Trial expire le :</strong> ${trialExpiry.toLocaleDateString('fr-FR')}</p>
    <hr>
    <p>Commencez à ajouter vos colis maintenant !</p>
  `
);
    const token = jwt.sign({ 
      id: entreprise.id, 
      email: entreprise.email,
      enterprise_id: entreprise.id
    }, SECRET_KEY, { expiresIn: '24h' });
    
    res.json({
      success: true,
      message: '✅ Inscription réussie - 7 jours de trial gratuits !',
      token,
      entreprise: entreprise
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
    phone_prefix: entreprise.phone_prefix,
    plan: entreprise.plan,
    plan_expiry: entreprise.plan_expiry
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
// ROUTE DEMANDE DE PAIEMENT (MANUEL)
// ====================================
app.post('/api/payment', verifyJWT, async (req, res) => {
  try {
    const { plan } = req.body;
    const enterprise_id = req.user.enterprise_id;

    console.log('💳 Demande de paiement:', { plan, enterprise_id });

    if (!plan) {
      return res.status(400).json({ error: 'Plan requis' });
    }

    // Récupérer les données de l'entreprise
    const entrepriseResult = await pool.query(
      'SELECT * FROM entreprises WHERE id = $1',
      [enterprise_id]
    );

    if (entrepriseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Entreprise non trouvée' });
    }

    const entreprise = entrepriseResult.rows[0];

    // Déterminer le montant selon le plan
    const amounts = {
      pro: 2900,
      enterprise: 9900
    };

    const amount = amounts[plan.toLowerCase()];
    if (!amount) {
      return res.status(400).json({ error: 'Plan invalide' });
    }

    // Générer une référence unique
    const reference = `PAY-${Date.now()}-${enterprise_id}`;

    // Enregistrer la demande de paiement
    const paymentResult = await pool.query(
      `INSERT INTO paiement_demandes (enterprise_id, company_code, email, plan, amount, currency, reference, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [enterprise_id, entreprise.company_code, entreprise.email, plan, amount, 'XOF', reference, 'pending']
    );

    const payment = paymentResult.rows[0];

    console.log('✅ Demande de paiement enregistrée:', reference);

    // ENVOYER EMAIL AU CONCEPTEUR
    await sendEmailToAdmin(
      `🔔 Nouvelle demande de paiement - ${entreprise.nom_entreprise}`,
      `
        <h2>Nouvelle demande de paiement</h2>
        <p><strong>Entreprise:</strong> ${entreprise.nom_entreprise}</p>
        <p><strong>Code:</strong> ${entreprise.company_code}</p>
        <p><strong>Email:</strong> ${entreprise.email}</p>
        <p><strong>Plan:</strong> ${plan.toUpperCase()}</p>
        <p><strong>Montant:</strong> ${amount} XOF</p>
        <p><strong>Référence:</strong> ${reference}</p>
        <hr>
        <p>Vérifiez le paiement FedaPay et approuvez via le lien ci-dessous :</p>
        <p><a href="https://saas-livraison-cotonou-backend.onrender.com/admin/approve?reference=${reference}">
          ✅ Approuver le paiement
        </a></p>
      `
    );

    res.json({
      success: true,
      message: 'Demande de paiement envoyée - Vérifiez votre email',
      reference: reference,
      amount: amount,
      plan: plan
    });

  } catch (error) {
    console.error('❌ Erreur demande paiement:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// ROUTE APPROUVER PAIEMENT (ADMIN)
// ====================================
app.post('/api/admin/approve-payment', async (req, res) => {
  try {
    const { reference, admin_password } = req.body;

    // Vérifier mot de passe admin
    if (admin_password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Mot de passe admin incorrect' });
    }

    console.log('✅ Approbation paiement:', reference);

    // Récupérer la demande
    const paymentResult = await pool.query(
      'SELECT * FROM paiement_demandes WHERE reference = $1',
      [reference]
    );

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    const payment = paymentResult.rows[0];

    // Mettre à jour la demande à "approved"
    await pool.query(
      'UPDATE paiement_demandes SET status = $1, approved_at = NOW() WHERE reference = $2',
      ['approved', reference]
    );

    // Calculer la date d'expiration (30 jours après)
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    // Mettre à jour le plan de l'entreprise
    const updateResult = await pool.query(
      `UPDATE entreprises 
       SET plan = $1, plan_expiry = $2, updated_at = NOW() 
       WHERE id = $3
       RETURNING *`,
      [payment.plan, expiryDate, payment.enterprise_id]
    );

    console.log(`✅ Plan ${payment.plan} activé jusqu'au ${expiryDate}`);

    // ENVOYER EMAIL À L'ENTREPRISE
    await sendEmailToClient(
      payment.email,
      `✅ Votre abonnement ${payment.plan.toUpperCase()} est activé !`,
      `
        <h2>Paiement confirmé !</h2>
        <p>Bonjour,</p>
        <p>Votre paiement a été confirmé et votre abonnement <strong>${payment.plan.toUpperCase()}</strong> est maintenant actif !</p>
        <hr>
        <p><strong>Détails :</strong></p>
        <ul>
          <li>Plan: <strong>${payment.plan.toUpperCase()}</strong></li>
          <li>Montant: <strong>${payment.amount} XOF</strong></li>
          <li>Valide jusqu'au: <strong>${expiryDate.toLocaleDateString('fr-FR')}</strong></li>
          <li>Code entreprise: <strong>${payment.company_code}</strong></li>
        </ul>
        <hr>
        <p>Bienvenue sur DeliverHub !</p>
      `
    );

    res.json({
      success: true,
      message: `Plan ${payment.plan} activé pour 30 jours`,
      expiry_date: expiryDate
    });

  } catch (error) {
    console.error('❌ Erreur approbation:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// CALLBACK PAIEMENT FEDAPAY
// ====================================
app.get('/payment-callback', async (req, res) => {
  try {
    const { reference, status } = req.query;

    console.log('📩 Callback paiement reçu:', { reference, status });

    // Chercher la tentative de paiement
    const result = await pool.query(
      'SELECT * FROM paiements_tentatives WHERE reference = $1',
      [reference]
    );

    if (result.rows.length === 0) {
      return res.json({ error: 'Paiement non trouvé' });
    }

    const paiement = result.rows[0];

    if (status === 'approved' || status === 'success') {
      // Mettre à jour le plan
      await pool.query(
        'UPDATE entreprises SET plan = $1, updated_at = NOW() WHERE id = $2',
        [paiement.plan, paiement.enterprise_id]
      );

      console.log(`✅ Plan ${paiement.plan} activé pour enterprise ${paiement.enterprise_id}`);

      // Redirection vers dashboard
      res.redirect('/#/dashboard?payment=success');
    } else {
      res.redirect('/#/dashboard?payment=failed');
    }

  } catch (error) {
    console.error('❌ Erreur callback:', error);
    res.redirect('/#/dashboard?payment=error');
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
// ROUTE DE TEST FEDAPAY
// ====================================
app.get('/api/test-fedapay', async (req, res) => {
  try {
    console.log('🧪 Test FedaPay...');
    console.log('🔑 API Key exists:', !!process.env.FEDAPAY_SECRET_KEY);
    console.log('🔑 API Key starts with:', process.env.FEDAPAY_SECRET_KEY?.substring(0, 10) + '...');
    
    res.json({
      success: true,
      message: '✅ FedaPay configurée',
      apiKeyExists: !!process.env.FEDAPAY_SECRET_KEY,
      keyPrefix: process.env.FEDAPAY_SECRET_KEY?.substring(0, 10) + '...',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erreur test FedaPay',
      details: error.message
    });
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