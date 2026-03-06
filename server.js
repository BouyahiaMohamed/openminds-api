const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const SECRET_KEY = "OPENMINDS_SUPER_SECRET_2026";

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createConnection({
  host: '192.168.1.161',
  port: 3306,
  user: 'root',
  password: '1t9lFRuXqxW62Hxue1JGN',
  database: 'openminds_db'
});

db.connect((err) => {
  if (err) throw err;
  console.log('Connecté à la base de données MySQL');
});

const verifyToken = (req, res, next) => {
    // On récupère le token dans l'entête "Authorization"
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // On enlève le mot "Bearer"

    if (!token) return res.status(401).json({ error: "Accès refusé. Token manquant." });

    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) return res.status(403).json({ error: "Session expirée ou invalide." });

        // On enregistre les infos du token dans la requête pour les utiliser après
        req.id = decoded.id;
        req.isAdmin = decoded.isAdmin;
        next(); // On laisse passer à la route suivante
    });
};

app.get('/', (req, res) => {
  res.send('L\'API OpenMinds fonctionne');
});

// ==========================================
// ROUTE 1 : INSCRIPTION (/register)
// ==========================================
app.post('/register', async (req, res) => {
  const { email, password , username } = req.body;

  if (!email || !password || !username) {
    return res.status(400).json({ error: 'Username et Email et mot de passe requis !' });
  }

  try {
    // 1. On crypte le mot de passe (10 est le "salt", le niveau de complexité)
    const hashedPassword = await bcrypt.hash(password, 10);

    // 2. On insère dans la base de données
    const query = 'INSERT INTO users (email, password, userName, isAdmin) VALUES (?, ?, ?, 0)';
    db.execute(query, [email, hashedPassword, username], (err, results) => {
      if (err) {
        // Si l'email existe déjà (Erreur MySQL 1062)
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
        }
        return res.status(500).json({ error: 'Erreur serveur.' });
      }
      res.status(201).json({ message: 'Compte créé avec succès !' });
    });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors du cryptage.' });
  }
});

// ==========================================
// ROUTE 2 : CONNEXION (/login)
// ==========================================
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis !' });
  }

  // 1. On cherche l'utilisateur par son email
  const query = 'SELECT * FROM users WHERE email = ?';
  db.execute(query, [email], async (err, results) => {
    if (err) return res.status(500).json({ error: 'Erreur serveur.' });
    if (results.length === 0) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }
    const user = results[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }
      const token = jwt.sign(
          { id: user.id, isAdmin: user.isAdmin },
          SECRET_KEY,
          { expiresIn: '24h' } // Le badge est valable 24 heures
      );
    res.status(200).json({ message: 'Connexion réussie !', token: token, id: user.id, isAdmin: user.isAdmin });
  });
});


const PORT = 3000;
app.listen(PORT, () => {
  console.log(`API en cours d'exécution sur http://localhost:${PORT}`);
});