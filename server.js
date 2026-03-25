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

app.get('/', (req, res) => {
  res.send('L\'API OpenMinds fonctionne parfaitement !');
});

// ==========================================
// ROUTE 1 : INSCRIPTION (/register)
// ==========================================
app.post('/register', async (req, res) => {
  const { email, password , username } = req.body;

  if (!email || !password || !username) {
    return res.status(400).json({ error: 'Username, Email et mot de passe requis !' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const query = 'INSERT INTO users (email, password, userName, isAdmin) VALUES (?, ?, ?, 0)';
    
    db.execute(query, [email.trim(), hashedPassword, username], (err, results) => {
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
// ROUTE 2 : CONNEXION (/login) ULTRA SÉCURISÉE
// ==========================================
app.post('/login', (req, res) => {
  const email = req.body.email ? req.body.email.trim() : '';
  const password = req.body.password;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis !' });
  }

  const query = 'SELECT * FROM users WHERE email = ?';
  db.execute(query, [email], async (err, results) => {
    if (err) return res.status(500).json({ error: 'Erreur serveur.' });
    if (results.length === 0) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }

    try {
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
      
      console.log(`Connexion réussie pour ${user.email}`);
      res.status(200).json({ 
          message: 'Connexion réussie !', 
          token: token, 
          user: { 
              id: user.id, 
              isAdmin: user.isAdmin,
              email: user.email,
              userName: user.username
          } 
      });

    } catch (error) {
      console.error("ERREUR FATALE attrapée :", error);
      res.status(500).json({ error: 'Erreur interne lors de la création de la session.' });
    }
  });
});


// ==========================================
// ROUTE 3 : RÉCUPÉRER LES FORMATIONS DE L'UTILISATEUR
// ==========================================
app.get('/my-formations', verifyToken, (req, res) => {
  const userId = req.id; // L'ID vient du token décodé par verifyToken

  // On fait une jointure (JOIN) entre Participe, Formation et Session
  const query = `
    SELECT 
        F.id AS id_formation, 
        F.Titre, 
        S.DateHeure, 
        S.Duree, 
        S.Statut, 
        P.Progression
    FROM Participe P
    JOIN Formation F ON P.Id_Formation = F.id
    LEFT JOIN Session S ON P.Id_Session = S.id
    WHERE P.Id_User = ?
    ORDER BY S.DateHeure ASC
  `;

  db.execute(query, [userId], (err, results) => {
    if (err) {
      console.error("Erreur SQL :", err);
      return res.status(500).json({ error: 'Erreur lors de la récupération des formations.' });
    }
    res.status(200).json(results);
  });
});



// ==========================================
// ROUTE 4 : RÉCUPÉRER LE CATALOGUE DE FORMATIONS
// ==========================================
app.get('/formations', verifyToken, (req, res) => {
  // On récupère toutes les formations et on cherche la date de la session la plus proche
  const query = `
    SELECT 
        f.id, 
        f.Titre, 
        f.Description, 
        f.isOnline,
        (SELECT MIN(DateHeure) FROM Session s WHERE s.Id_Formation = f.id) as DateHeure
    FROM Formation f
  `;

  db.execute(query, [], (err, results) => {
    if (err) {
      console.error("Erreur SQL Catalogue :", err);
      return res.status(500).json({ error: 'Erreur lors de la récupération du catalogue.' });
    }
    res.status(200).json(results);
  });
});


app.get('/likes', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id; // Récupéré depuis le token JWT
        // Requête sur ta table Like_
        const [likes] = await db.query('SELECT Id_Formation FROM Like_ WHERE Id_User = ?', [userId]);
        res.json(likes); // Renvoie un tableau : [{ Id_Formation: 1 }, { Id_Formation: 4 }]
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur" });
    }
});


app.post('/formations/:id/like', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const formationId = req.params.id;
        await db.query('INSERT IGNORE INTO Like_ (Id_User, Id_Formation) VALUES (?, ?)', [userId, formationId]);
        res.status(200).json({ message: "Ajouté aux favoris" });
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur" });
    }
});

app.delete('/formations/:id/like', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const formationId = req.params.id;
        await db.query('DELETE FROM Like_ WHERE Id_User = ? AND Id_Formation = ?', [userId, formationId]);
        res.status(200).json({ message: "Retiré des favoris" });
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur" });
    }
});











const PORT = 3000;
app.listen(PORT, () => {
  console.log(`API en cours d'exécution sur le port ${PORT}`);
});