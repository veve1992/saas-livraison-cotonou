\# 🚚 DeliverHub Backend API



\*\*API REST pour la gestion des livraisons\*\*



\## 🚀 Démarrage rapide



\### Installation



```bash

npm install

```



\### Configuration



Crée un fichier `.env` :

DATABASE\_URL=postgresql://...

ADMIN\_PASSWORD=ton\_password

ADMIN\_EMAIL=ton\_email@gmail.com

RESEND\_API\_KEY=re\_xxxxx

\### Démarrage



```bash

npm start

```



L'API démarre sur : `http://localhost:3000`



\## 📚 API Routes



\### Authentification

\- `POST /register-gestionnaire` - Inscription gestionnaire

\- `POST /login-gestionnaire` - Connexion gestionnaire

\- `POST /register-livreur` - Inscription livreur

\- `POST /login-livreur` - Connexion livreur



\### Colis

\- `GET /parcels` - Lister tous les colis (JWT)

\- `POST /parcels` - Ajouter un colis (JWT)

\- `PUT /parcels/:id/livreur` - Assigner livreur (JWT)

\- `PUT /parcels/:id/status` - Changer statut + GPS (JWT)



\### Livreurs

\- `GET /livreurs` - Lister livreurs (JWT)

\- `GET /livreur/mes-colis/:livreur\_id` - Mes colis (JWT)



\### Suivi Public

\- `GET /tracking/public/:company\_code/:colis\_id` - Suivi sans login

\- `GET /tracking/:colis\_id` - Suivi avec login (JWT)



\### Admin

\- `POST /api/payment` - Demander paiement (JWT)

\- `POST /api/admin/approve-payment` - Approuver paiement

\- `GET /api/admin/payments` - Lister demandes

\- `GET /api/admin/enterprises` - Lister entreprises

\- `PUT /api/admin/enterprise/:id/status` - Bloquer/débloquer

\- `GET /api/enterprise/status` - Vérifier plan (JWT)



\## 🗄️ Base de données



PostgreSQL via Neon.tech



\*\*Tables principales :\*\*

\- `entreprises` - Gestionnaires

\- `livreurs` - Équipe de livraison

\- `colis` - Livraisons

\- `paiement\_demandes` - Paiements



\## 🔐 Sécurité



\- JWT Authentication

\- Plan expiry verification

\- Admin password protection

\- Email verification (Resend)



\## 🌐 Déploiement



Render.com

\- Backend : https://saas-livraison-cotonou-backend.onrender.com

\- Database : Neon PostgreSQL



\## 📧 Support



Email : bienhagla@gmail.com



\## 📝 Version



v1.0 - MVP Complete (Août 2026)

