const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const SECRET_KEY = "OPENMINDS_SUPER_SECRET_2026";

const app = express();
app.use(cors());
app.use(express.json());
app.use('/badges', express.static('public/badges'));

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


app.get('/likes', verifyToken, (req, res) => {
    const userId = req.id; // Correction ici : req.id au lieu de req.user.id
    
    const query = 'SELECT Id_Formation FROM Like_ WHERE Id_User = ?';
    db.execute(query, [userId], (err, results) => {
        if (err) {
            console.error("Erreur GET likes:", err);
            return res.status(500).json({ error: "Erreur serveur" });
        }
        res.json(results); 
    });
});

app.post('/formations/:id/like', verifyToken, (req, res) => {
    const userId = req.id; // Correction ici
    const formationId = req.params.id;

    const query = 'INSERT IGNORE INTO Like_ (Id_User, Id_Formation) VALUES (?, ?)';
    db.execute(query, [userId, formationId], (err, results) => {
        if (err) {
            console.error("Erreur POST like:", err);
            return res.status(500).json({ error: "Erreur serveur" });
        }
        res.status(200).json({ message: "Ajouté aux favoris" });
    });
});

app.delete('/formations/:id/like', verifyToken, (req, res) => {
    const userId = req.id; // Correction ici
    const formationId = req.params.id;

    const query = 'DELETE FROM Like_ WHERE Id_User = ? AND Id_Formation = ?';
    db.execute(query, [userId, formationId], (err, results) => {
        if (err) {
            console.error("Erreur DELETE like:", err);
            return res.status(500).json({ error: "Erreur serveur" });
        }
        res.status(200).json({ message: "Retiré des favoris" });
    });
});

// RÉCUPÉRER LES FORMATIONS LIKÉES (Pour le Dashboard)
app.get('/my-favorites', verifyToken, (req, res) => {
    const userId = req.id;

    const query = `
        SELECT 
            F.id, 
            F.Titre, 
            F.Description, 
            F.isOnline,
            (SELECT MIN(DateHeure) FROM Session s WHERE s.Id_Formation = F.id) as DateHeure
        FROM Like_ L
        JOIN Formation F ON L.Id_Formation = F.id
        WHERE L.Id_User = ?
    `;

    db.execute(query, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: 'Erreur favoris' });
        res.status(200).json(results);
    });
});


// Route pour s'inscrire à une formation
app.post('/formations/:id/enroll', verifyToken, (req, res) => {
    const userId = req.id; 
    const formationId = req.params.id;

    // 1. On vérifie si l'utilisateur n'est pas déjà inscrit
    const checkQuery = "SELECT * FROM Participe WHERE Id_User = ? AND Id_Formation = ?";
    
    db.execute(checkQuery, [userId, formationId], (err, results) => {
        if (err) return res.status(500).json({ error: "Erreur lors de la vérification." });
        
        if (results.length > 0) {
            return res.status(400).json({ message: "Vous êtes déjà inscrit à cette formation !" });
        }

        // 2. On l'inscrit avec une progression de 0% (Id_Session est NULL par défaut pour le E-learning)
        const insertQuery = "INSERT INTO Participe (Id_User, Id_Formation, Progression) VALUES (?, ?, 0.00)";
        
        db.execute(insertQuery, [userId, formationId], (err, insertResult) => {
            if (err) return res.status(500).json({ error: "Erreur lors de l'inscription." });
            res.status(200).json({ message: "Inscription réussie !" });
        });
    });
});


// ==========================================
// ROUTE : RÉCUPÉRER LES BADGES DE L'UTILISATEUR
// ==========================================
app.get('/my-badges', verifyToken, (req, res) => {
    const userId = req.id;

    const query = `
        SELECT B.id, B.nomBadge, B.URLImage, P.DateObtention
        FROM Possede P
        JOIN Badges B ON P.id_Badges = B.id
        WHERE P.id_User = ?
        ORDER BY P.DateObtention DESC
    `;

    db.execute(query, [userId], (err, results) => {
        if (err) {
            console.error("Erreur SQL Badges :", err);
            return res.status(500).json({ error: 'Erreur lors de la récupération des badges.' });
        }
        res.status(200).json(results);
    });
});

// ==========================================
// ROUTE : RÉCUPÉRER LA PROGRESSION (FORMATIONS EN LIGNE)
// ==========================================
app.get('/my-online-progress', verifyToken, (req, res) => {
    const userId = req.id;

    const query = `
        SELECT F.id, F.Titre, F.Description, P.Progression
        FROM Participe P
        JOIN Formation F ON P.Id_Formation = F.id
        WHERE P.Id_User = ? AND F.isOnline = 1
    `;

    db.execute(query, [userId], (err, results) => {
        if (err) {
            console.error("Erreur SQL Progression :", err);
            return res.status(500).json({ error: 'Erreur lors de la récupération des progressions.' });
        }
        res.status(200).json(results);
    });
});

// ==========================================
// ROUTE 5 : RÉCUPÉRER LES SESSIONS À VENIR EN TANT QUE FORMATEUR
// ==========================================
app.get('/my-teaching-sessions', verifyToken, (req, res) => {
    const userId = req.id;

    // On relie l'utilisateur à ses sessions, puis on récupère les infos de la formation associée
    const query = `
        SELECT 
            F.id AS id_formation,
            F.Titre,
            S.id AS id_session,
            S.Statut,
            S.DateHeure,
            S.Duree,
            S.Adresse
        FROM APourFormateur APF
        JOIN Session S ON APF.id_Session = S.id
        JOIN Formation F ON S.id_Formation = F.id
        WHERE APF.id_User = ? AND S.DateHeure >= NOW()
        ORDER BY S.DateHeure ASC
    `;

    db.execute(query, [userId], (err, results) => {
        if (err) {
            console.error("Erreur SQL Formateur :", err);
            return res.status(500).json({ error: 'Erreur lors de la récupération de vos sessions en tant que formateur.' });
        }
        res.status(200).json(results);
    });
});

// ==========================================
// ROUTE : RÉCUPÉRER LES SESSIONS D'UN JOUR PRÉCIS
// ==========================================
app.get('/my-teaching-sessions/by-date', verifyToken, (req, res) => {
    const userId = req.id;
    // On récupère la date depuis l'URL (ex: /by-date?date=2023-10-24)
    const requestedDate = req.query.date;

    if (!requestedDate) {
        return res.status(400).json({ error: 'La date est requise (format YYYY-MM-DD).' });
    }

    // On utilise DATE(S.DateHeure) = ? pour filtrer sur le jour exact
    const query = `
        SELECT S.id_session, S.Titre, S.DateHeure, S.Duree, S.Statut
        FROM Session S
        WHERE S.id_Formateur = ? 
        AND DATE(S.DateHeure) = ?
        ORDER BY S.DateHeure ASC
    `;

    db.execute(query, [userId, requestedDate], (err, results) => {
        if (err) {
            console.error("Erreur SQL Sessions par date :", err);
            return res.status(500).json({ error: 'Erreur lors de la récupération des sessions.' });
        }
        res.status(200).json(results);
    });
});


// ==========================================
// ROUTE : RÉCUPÉRER LES PARTICIPANTS D'UNE SESSION
// ==========================================
app.get('/sessions/:id/participants', verifyToken, (req, res) => {
    const sessionId = req.params.id;

    // On fait une jointure pour récupérer le nom de l'utilisateur en plus de son statut
    const query = `
        SELECT U.id AS id_user, U.userName, P.isPresent
        FROM Participe P
        JOIN users U ON P.Id_User = U.id
        WHERE P.Id_Session = ?
    `;

    db.execute(query, [sessionId], (err, results) => {
        if (err) {
            console.error("Erreur SQL Participants :", err);
            return res.status(500).json({ error: 'Erreur lors de la récupération des participants.' });
        }
        res.status(200).json(results);
    });
});


// ==========================================
// ROUTE : SAUVEGARDER LES PRÉSENCES D'UNE SESSION
// ==========================================
app.post('/sessions/:id/attendance', verifyToken, async (req, res) => {
    const sessionId = req.params.id;
    const { attendances } = req.body;
    // attendances ressemblera à ça : [{ userId: 1, isPresent: 1 }, { userId: 2, isPresent: 0 }, ...]

    if (!attendances || !Array.isArray(attendances)) {
        return res.status(400).json({ error: 'Données de présence invalides.' });
    }

    try {
        const query = 'UPDATE Participe SET isPresent = ? WHERE Id_User = ? AND Id_Session = ?';

        // On crée un tableau de promesses pour exécuter toutes les requêtes d'un coup
        const updatePromises = attendances.map(record => {
            return new Promise((resolve, reject) => {
                db.execute(query, [record.isPresent, record.userId, sessionId], (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            });
        });

        // On attend que toutes les mises à jour soient terminées
        await Promise.all(updatePromises);

        res.status(200).json({ message: 'Appel validé avec succès !' });
    } catch (error) {
        console.error("Erreur SQL lors de la validation des présences :", error);
        res.status(500).json({ error: 'Erreur lors de la validation de la séance.' });
    }
});


const PORT = 3000;
app.listen(PORT, () => {
  console.log(`API en cours d'exécution sur le port ${PORT}`);
});
