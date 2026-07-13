// ====================================
// FICHIER : init-db.js
// Créer les tables
// À EXÉCUTER UNE SEULE FOIS : node init-db.js
// ====================================

const pool = require('./database');

async function createTables() {
  try {
    console.log('⏳ Création des tables...\n');

    // TABLE 1 : COLIS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS colis (
        id SERIAL PRIMARY KEY,
        de VARCHAR(255) NOT NULL,
        a VARCHAR(255) NOT NULL,
        prix NUMERIC NOT NULL,
        status VARCHAR(50) DEFAULT 'créé',
        livreur VARCHAR(100),
        commission NUMERIC,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table "colis" créée');

    // TABLE 2 : LIVREURS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS livreurs (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(100) NOT NULL,
        phone VARCHAR(20),
        revenus NUMERIC DEFAULT 0,
        colis_livres INT DEFAULT 0,
        rating NUMERIC DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table "livreurs" créée');

    // TABLE 3 : TRACKING (pour GPS)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tracking (
        id SERIAL PRIMARY KEY,
        colis_id INT REFERENCES colis(id) ON DELETE CASCADE,
        livreur_id INT REFERENCES livreurs(id),
        latitude NUMERIC,
        longitude NUMERIC,
        status VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table "tracking" créée');

    // TABLE 4 : RATINGS (avis clients)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ratings (
        id SERIAL PRIMARY KEY,
        colis_id INT REFERENCES colis(id) ON DELETE CASCADE,
        rating INT,
        comment TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table "ratings" créée');

    // TABLE 5 : USERS (pour plus tard avec authentification)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255),
        name VARCHAR(100),
        role VARCHAR(50) DEFAULT 'client',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table "users" créée');

    // Insérer données de test
    console.log('\n⏳ Insertion de données de test...');
    
    await pool.query(`
      INSERT INTO livreurs (nom, phone, revenus, colis_livres, rating) 
      VALUES 
        ('Ahmed', '95123456', 125000, 12, 4.8),
        ('Marie', '95234567', 98000, 10, 4.9),
        ('Yannick', '95345678', 87000, 8, 4.5)
      ON CONFLICT DO NOTHING;
    `);
    console.log('✅ Livreurs de test insérés');

    console.log('\n🎉 Toutes les tables créées avec succès !');
    console.log('\nVous pouvez maintenant utiliser : npm start');
    process.exit(0);

  } catch (err) {
    console.error('❌ Erreur :', err.message);
    process.exit(1);
  }
}

createTables();
