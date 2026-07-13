// ====================================
// FICHIER : database.js
// Connexion à PostgreSQL
// ====================================

const { Pool } = require('pg');

// Récupérer l'URL de la database depuis variables d'environnement
// En Replit, vous ajoutez ça dans "Secrets"
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/postgres';

// Créer une "pool" de connexions
// C'est comme avoir plusieurs "tuyaux" vers la database
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false  // Pour Railway (accepte SSL)
  }
});

// Tester la connexion
pool.on('connect', () => {
  console.log('✅ Connecté à PostgreSQL !');
});

pool.on('error', (err) => {
  console.error('❌ Erreur connexion Database :', err);
});

// Exporter la pool pour utiliser dans server.js
module.exports = pool;
