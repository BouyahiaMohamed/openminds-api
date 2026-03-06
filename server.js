const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const SECRET_KEY = "OPENMINDS_SUPER_SECRET_2026";

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createPool({
  host: 'db',
  port: 3306,
  user: 'root',
  password: '1t9lFRuXqxW62Hxue1JGN',
  database: 'openminds',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});


const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: "Accès refusé. Token manquant." });

    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) return res.status(403).json({ error: "Session expirée ou invalide." });

        req.id = decoded.id;
        req.isAdmin = decoded.isAdmin;
        next();
    });
};

// Route de test Ping
app.get('/', (req, res) => {
  res.send('L\'API OpenMinds fonctionne et ne crash plus !');
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
    const hashedPassword = await bcrypt.hash(password, 10);

    const query = 'INSERT INTO users (email, password, userName, isAdmin) VALUES (?, ?, ?, 0)';
    db.execute(query, [email, hashedPassword, username], (err, results) => {
      if (err) {
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
          { expiresIn: '24h' }
      );
    res.status(200).json({ message: 'Connexion réussie !', token: token, id: user.id, isAdmin: user.isAdmin });
  });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`API en cours d'exécution sur le port ${PORT}`);
});