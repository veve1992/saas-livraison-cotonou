// ====================================
// FICHIER : server.js (Version 2 - Avec Database)
// Backend Livraison Colis
// ====================================

const express = require('express');
const pool = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// ====================================
// ROUTES
// ====================================

// Test serveur
app.get('/health', (req, res) => {
  res.json({
    status: "✅ OK",
    message: "Serveur fonctionne !",
    database: "PostgreSQL",
    timestamp: new Date()
  });
});

// Page d'accueil
app.get('/', (req, res) => {
  res.json({
    app: "Livraison de Colis - Cotonou",
    version: "2.0.0",
    database: "PostgreSQL",
    endpoints: {
      health: "GET /health",
      parcels: "GET /parcels",
      parcel_detail: "GET /parcels/:id",
      create_parcel: "POST /parcels",
      update_parcel: "PUT /parcels/:id",
      delete_parcel: "DELETE /parcels/:id",
      livreurs: "GET /livreurs",
      stats: "GET /stats"
    }
  });
});

// ====================================
// COLIS ROUTES (Avec Database)
// ====================================

// Lister tous les colis
app.get('/parcels', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM colis ORDER BY created_at DESC');
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Voir détail d'un colis
app.get('/parcels/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM colis WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `Colis ${id} pas trouvé`
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Créer un colis
app.post('/parcels', async (req, res) => {
  try {
    const { de, a, prix, livreur } = req.body;
    
    // Validation
    if (!de || !a || !prix) {
      return res.status(400).json({
        success: false,
        error: "Manque de données. Besoin : de, a, prix"
      });
    }
    
    // Calculer commission (7%)
    const commission = Math.round(prix * 0.07);
    
    // Insérer en database
    const result = await pool.query(
      'INSERT INTO colis (de, a, prix, status, livreur, commission) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [de, a, prix, 'créé', livreur || 'non-assigné', commission]
    );
    
    res.status(201).json({
      success: true,
      message: "Colis créé avec succès !",
      colis: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Modifier un colis
app.put('/parcels/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, livreur } = req.body;
    
    // Vérifier que au moins un champ à modifier
    if (!status && !livreur) {
      return res.status(400).json({
        success: false,
        error: "Aucun champ à modifier (status ou livreur)"
      });
    }
    
    // Construire dynamiquement la requête
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (status) {
      updates.push(`status = $${paramCount}`);
      values.push(status);
      paramCount++;
    }
    
    if (livreur) {
      updates.push(`livreur = $${paramCount}`);
      values.push(livreur);
      paramCount++;
    }
    
    // Toujours mettre à jour updated_at
    updates.push(`updated_at = NOW()`);
    values.push(id);
    
    const query = `UPDATE colis SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;
    
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `Colis ${id} pas trouvé`
      });
    }
    
    res.json({
      success: true,
      message: `Colis ${id} mis à jour`,
      data: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Supprimer un colis
app.delete('/parcels/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('DELETE FROM colis WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `Colis ${id} pas trouvé`
      });
    }
    
    res.json({
      success: true,
      message: `Colis ${id} supprimé`,
      data: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ====================================
// LIVREURS ROUTES
// ====================================

// Lister tous les livreurs
app.get('/livreurs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM livreurs');
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Voir détail livreur
app.get('/livreurs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM livreurs WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `Livreur ${id} pas trouvé`
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ====================================
// STATS
// ====================================

app.get('/stats', async (req, res) => {
  try {
    // Compter par status
    const colisResult = await pool.query(
      "SELECT status, COUNT(*) as count FROM colis GROUP BY status"
    );
    
    // Calculer revenus
    const revenueResult = await pool.query(
      "SELECT SUM(commission) as total FROM colis WHERE status = 'livré'"
    );
    
    const stats = {
      total_colis: 0,
      colis_livres: 0,
      colis_en_transit: 0,
      colis_crees: 0,
      revenue_jour: "0 XOF"
    };
    
    // Traiter résultats
    colisResult.rows.forEach(row => {
      const count = parseInt(row.count);
      if (row.status === 'livré') stats.colis_livres = count;
      if (row.status === 'en_transit') stats.colis_en_transit = count;
      if (row.status === 'créé') stats.colis_crees = count;
      stats.total_colis += count;
    });
    
    if (revenueResult.rows[0] && revenueResult.rows[0].total) {
      stats.revenue_jour = Math.round(revenueResult.rows[0].total) + " XOF";
    }
    
    res.json({
      success: true,
      stats: stats
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ====================================
// ERROR HANDLER
// ====================================

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: "Erreur serveur",
    message: err.message
  });
});

// ====================================
// LANCER LE SERVEUR
// ====================================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║  🚚 SERVEUR LIVRAISON COTONOU 🚚      ║
╠════════════════════════════════════════╣
║  ✅ Serveur lancé                     ║
║  Port: ${PORT}                           ║
║  Database: PostgreSQL (Connected)      ║
║  URL: http://localhost:${PORT}                ║
║                                        ║
║  Endpoints:                            ║
║  - http://localhost:${PORT}/health           ║
║  - http://localhost:${PORT}/parcels          ║
║  - http://localhost:${PORT}/livreurs         ║
║  - http://localhost:${PORT}/stats            ║
║                                        ║
║  Ready for testing! 🚀                ║
╚════════════════════════════════════════╝
  `);
});
