const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { exec } = require('child_process');

const SECRET_KEY = "OPENMINDS_SUPER_SECRET_2026";

const app = express();
app.use(cors());
app.use(express.json());
const path = require('path');

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
    const userId = req.id;

    const query = `
        SELECT
            F.id AS id_formation,
            F.Titre,
            F.isOnline,
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

app.get('/formations', verifyToken, (req, res) => {
    const query = `
        SELECT
            f.id,
            f.Titre,
            f.Description,
            f.isOnline,
            (SELECT MIN(DateHeure)
             FROM Session s
             WHERE s.Id_Formation = f.id
             AND s.DateHeure >= NOW()
             AND s.nbPlacesRestantes > 0) as DateHeureRaw
        FROM Formation f
        WHERE f.statut = 'validee' AND (f.isOnline = 1
           OR EXISTS (
               SELECT 1 FROM Session s
               WHERE s.Id_Formation = f.id
                 AND s.DateHeure >= NOW()
                 AND s.nbPlacesRestantes > 0
           ))
    `;

    db.execute(query, [], (err, results) => {
        if (err) {
            console.error("Erreur SQL Catalogue :", err);
            return res.status(500).json({ error: 'Erreur lors de la récupération du catalogue.' });
        }
        res.status(200).json(results);
    });
});

// ==========================================
// ROUTE : AJOUTER / PROPOSER UNE FORMATION
// ==========================================
app.post('/formations', verifyToken, async (req, res) => {
    const { Titre, Description, isOnline, Adresse, DateHeure, nbPlacesRestantes, Formateurs } = req.body;
    
    try {
        const queryForm = `
            INSERT INTO Formation (Titre, Description, isOnline, Adresse, statut, Id_User) 
            VALUES (?, ?, ?, ?, 'en_attente', ?)
        `;
   
        db.execute(queryForm, [Titre, Description, isOnline, Adresse, req.id], (err, result) => {
            if (err) {
                console.error("Erreur BDD Insertion Formation :", err);
                return res.status(500).json({ error: "Erreur SQL : " + err.sqlMessage });
            }

            const formationId = result.insertId;

            if (DateHeure) {
                const formattedDate = DateHeure.length <= 16 ? `${DateHeure}:00` : DateHeure;
                const places = parseInt(nbPlacesRestantes) || 0;

                const querySess = `
                    INSERT INTO Session (Id_Formation, DateHeure, Duree, nbPlaces, nbPlacesRestantes, Statut, Adresse) 
                    VALUES (?, ?, 90, ?, ?, 'À Venir', ?)
                `;
                
                db.execute(querySess, [formationId, formattedDate, places, places, Adresse], (errSess) => {
                    if (errSess) {
                        console.error("Erreur BDD Insertion Session :", errSess.sqlMessage);
                    }
                });
            }

            res.status(201).json({ message: "Proposition de formation envoyée avec succès !" });
        });
    } catch (error) {
        console.error("Crash Route POST /formations :", error);
        res.status(500).json({ error: "Erreur interne du serveur." });
    }
});

app.post('/formations', verifyToken, async (req, res) => {
    const { Titre, Description, isOnline, Adresse, DateHeure, nbPlacesRestantes, Formateurs } = req.body;
    
    try {
        const queryForm = `
            INSERT INTO Formation (Titre, Description, isOnline, Adresse, statut) 
            VALUES (?, ?, ?, ?, 'en_attente')
        `;
        
        db.execute(queryForm, [Titre, Description, isOnline, Adresse], (err, result) => {
            if (err) {
                // 👇 C'EST ICI : On renvoie la vraie erreur SQL pour comprendre le blocage
                return res.status(500).json({ error: "Erreur SQL : " + err.sqlMessage });
            }

            const formationId = result.insertId;

            if (DateHeure) {
                const formattedDate = DateHeure.length <= 16 ? `${DateHeure}:00` : DateHeure;
                const places = parseInt(nbPlacesRestantes) || 0;

                const querySess = `
                    INSERT INTO Session (Id_Formation, DateHeure, Duree, nbPlaces, nbPlacesRestantes, Statut, Adresse) 
                    VALUES (?, ?, 90, ?, ?, 'À Venir', ?)
                `;
                
                db.execute(querySess, [formationId, formattedDate, places, places, Adresse], (errSess) => {
                    if (errSess) console.error("Erreur Insertion Session :", errSess.sqlMessage);
                });
            }

            res.status(201).json({ message: "Proposition de formation envoyée avec succès !" });
        });
    } catch (error) {
        res.status(500).json({ error: "Erreur interne du serveur." });
    }
});


app.get('/likes', verifyToken, (req, res) => {
    const userId = req.id; 

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
    const userId = req.id; 
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
    const userId = req.id; 
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
        WHERE L.Id_User = ? AND F.statut = 'validee'
    `;

    db.execute(query, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: 'Erreur favoris' });
        res.status(200).json(results);
    });
});


app.post('/formations/:id/enroll', verifyToken, (req, res) => {
    const userId = req.id;
    const formationId = req.params.id;

    const sessionQuery = "SELECT id FROM Session WHERE Id_Formation = ? LIMIT 1";

    db.execute(sessionQuery, [formationId], (err, sessions) => {
        if (err) return res.status(500).json({ error: "Erreur recherche session" });

        const sessionId = sessions.length > 0 ? sessions[0].id : null;

        const checkQuery = "SELECT * FROM Participe WHERE Id_User = ? AND Id_Formation = ?";
        db.execute(checkQuery, [userId, formationId], (err, results) => {
            if (err) return res.status(500).json({ error: "Erreur vérification" });
            if (results.length > 0) return res.status(400).json({ message: "Déjà inscrit !" });

            const insertQuery = `
                INSERT INTO Participe (Id_User, Id_Formation, Id_Session, Progression, IsPresent)
                VALUES (?, ?, ?, 0.00, 0)
            `;

            db.execute(insertQuery, [userId, formationId, sessionId], (err, result) => {
                if (err) {
                    console.error("❌ ERREUR SQL:", err.sqlMessage);
                    return res.status(500).json({ error: "Erreur BDD: " + err.sqlMessage });
                }
                res.status(200).json({ message: "Inscription réussie !" });
            });
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
// ROUTE : RÉCUPÉRER LES SESSIONS D'UN JOUR PRÉCIS (CORRIGÉE)
// ==========================================
app.get('/my-teaching-sessions/by-date', verifyToken, (req, res) => {
    const userId = req.id;
    const requestedDate = req.query.date;

    if (!requestedDate) {
        return res.status(400).json({ error: 'La date est requise (format YYYY-MM-DD).' });
    }

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
        WHERE APF.id_User = ?
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

    if (!attendances || !Array.isArray(attendances)) {
        return res.status(400).json({ error: 'Données de présence invalides.' });
    }

    try {
        const query = 'UPDATE Participe SET isPresent = ? WHERE Id_User = ? AND Id_Session = ?';

        const updatePromises = attendances.map(record => {
            return new Promise((resolve, reject) => {
                db.execute(query, [record.isPresent, record.userId, sessionId], (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            });
        });

        await Promise.all(updatePromises);

        res.status(200).json({ message: 'Appel validé avec succès !' });
    } catch (error) {
        console.error("Erreur SQL lors de la validation des présences :", error);
        res.status(500).json({ error: 'Erreur lors de la validation de la séance.' });
    }
});



// La route pour update l'API
app.get('/admin/update-api', (req, res) => {
    const secretKey = req.query.mdp;

    if (secretKey !== '1t9lFRuXqxW62Hxue1JGN') {
        return res.status(403).send("<h1 style='color: red; text-align: center; margin-top: 50px;'>⛔ Accès refusé</h1>");
    }

    console.log("🚀 Lancement du script de mise à jour distant depuis le navigateur...");

    exec('/usr/local/bin/maj_api', (error, stdout, stderr) => {
        if (error) {
            console.error(`Erreur d'exécution: ${error.message}`);
            return res.status(500).send(`
                <h1 style='color: red;'>❌ Erreur lors de la mise à jour</h1>
                <pre style='background: #eee; padding: 15px;'>${error.message}</pre>
            `);
        }

        console.log(`Résultat du script : ${stdout}`);
        res.status(200).send(`
            <div style='font-family: sans-serif; text-align: center; margin-top: 50px;'>
                <h1 style='color: green;'>✅ Mise à jour terminée avec succès !</h1>
                <p>L'API est à jour pour tout le groupe.</p>
                <pre style='background: #333; color: #fff; padding: 15px; text-align: left; max-width: 600px; margin: 0 auto; border-radius: 8px;'>${stdout}</pre>
            </div>
        `);
    });
});


// ==========================================
// ROUTE : RÉCUPÉRER LES DÉTAILS D'UNE FORMATION
// ==========================================
app.get('/formations/:id', verifyToken, (req, res) => {
    const formationId = req.params.id;
    const userId = req.id; 

    const query = `
        SELECT
            f.id,
            f.Titre,
            f.Description,
            f.isOnline,
            f.Adresse, 
            s.DateHeure,
            s.nbPlaces,
            (s.nbPlaces - (SELECT COUNT(*) FROM Participe p WHERE p.Id_Session = s.id)) as nbPlacesRestantes,
            (SELECT GROUP_CONCAT(U.userName SEPARATOR ', ')
             FROM APourFormateur APF
             JOIN users U ON APF.id_User = U.id
             WHERE APF.id_Session = s.id) as Formateurs,
            EXISTS(SELECT 1 FROM Participe P WHERE P.Id_Formation = f.id AND P.Id_User = ?) AS isEnrolled
        FROM Formation f
        LEFT JOIN Session s ON f.id = s.Id_Formation
        WHERE f.id = ?
        LIMIT 1
    `;

    db.execute(query, [userId, formationId], (err, results) => {
        if (err) return res.status(500).json({ error: "Erreur serveur" });
        if (results.length === 0) return res.status(404).json({ error: "Formation non trouvée" });
        res.json(results[0]);
    });
});

// ==========================================
// ROUTE : SE DÉSINSCRIRE D'UNE FORMATION
// ==========================================
app.delete('/formations/:id/enroll', verifyToken, (req, res) => {
    const userId = req.id;
    const formationId = req.params.id;

    const query = "DELETE FROM Participe WHERE Id_User = ? AND Id_Formation = ?";

    db.execute(query, [userId, formationId], (err, results) => {
        if (err) {
            console.error("Erreur désinscription :", err);
            return res.status(500).json({ error: "Erreur lors de la désinscription." });
        }
        res.status(200).json({ message: "Désinscription réussie !" });
    });
});

// ==========================================
// ROUTES ADMIN : MODÉRATION DES FORMATIONS
// ==========================================

app.get('/admin/formations/pending', verifyToken, (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ error: "Accès refusé." });

    const query = `
        SELECT f.*, s.DateHeure 
        FROM Formation f 
        LEFT JOIN Session s ON f.id = s.Id_Formation 
        WHERE f.statut = 'en_attente'
    `;
    
    db.execute(query, [], (err, results) => {
        if (err) {
            console.error("Erreur SQL Pending:", err);
            return res.status(500).json({ error: "Erreur serveur" });
        }
        res.json(results);
    });
});

app.put('/admin/formations/:id/accept', verifyToken, (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ error: "Accès refusé." });

    const query = "UPDATE Formation SET statut = 'validee' WHERE id = ?";
    
    db.execute(query, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: "Erreur lors de la validation." });
        res.json({ message: "Formation validée et publiée au catalogue !" });
    });
});

app.delete('/admin/formations/:id/reject', verifyToken, (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ error: "Accès refusé." });

    const formationId = req.params.id;

    // On supprime les sessions d'abord pour éviter les erreurs de clés étrangères
    db.execute("DELETE FROM Session WHERE Id_Formation = ?", [formationId], (errS) => {
        if (errS) return res.status(500).json({ error: "Erreur suppression sessions." });
        
        db.execute("DELETE FROM Formation WHERE id = ?", [formationId], (errF) => {
            if (errF) return res.status(500).json({ error: "Erreur suppression formation." });
            res.json({ message: "Formation refusée et supprimée." });
        });
    });
});


// ==========================================
// ROUTE ADMIN : DASHBOARD & STATISTIQUES (US17)
// ==========================================
app.get('/admin/stats', verifyToken, async (req, res) => {
    if (!req.isAdmin) {
        return res.status(403).json({ error: "Accès refusé. Espace réservé aux administrateurs." });
    }

    const period = req.query.period || 'Année'; 

    let dateConditionSession = "1=1";
    let dateConditionQuiz = "1=1";

    if (period === 'Ce mois') {
        dateConditionSession = "MONTH(DateHeure) = MONTH(CURRENT_DATE()) AND YEAR(DateHeure) = YEAR(CURRENT_DATE())";
        dateConditionQuiz = "MONTH(DatePassage) = MONTH(CURRENT_DATE()) AND YEAR(DatePassage) = YEAR(CURRENT_DATE())";
    } else if (period === 'Trimestre') {
        dateConditionSession = "QUARTER(DateHeure) = QUARTER(CURRENT_DATE()) AND YEAR(DateHeure) = YEAR(CURRENT_DATE())";
        dateConditionQuiz = "QUARTER(DatePassage) = QUARTER(CURRENT_DATE()) AND YEAR(DatePassage) = YEAR(CURRENT_DATE())";
    } else if (period === 'Semaine') {
        dateConditionSession = "YEARWEEK(DateHeure, 1) = YEARWEEK(CURRENT_DATE(), 1)";
        dateConditionQuiz = "YEARWEEK(DatePassage, 1) = YEARWEEK(CURRENT_DATE(), 1)";
    }

    try {
        const queryAsync = (sql) => new Promise((resolve, reject) => {
            db.execute(sql, [], (err, results) => err ? reject(err) : resolve(results));
        });

        const inscrits = await queryAsync(`
            SELECT COUNT(*) as total
            FROM Participe P
            LEFT JOIN Session S ON P.Id_Session = S.id
            WHERE S.id IS NULL OR ${dateConditionSession}
        `);

        const reussite = await queryAsync(`
            SELECT IFNULL(ROUND((SUM(IsSuccess) / COUNT(*)) * 100), 0) as taux
            FROM FaitLeQuiz
            WHERE ${dateConditionQuiz}
        `);

        const sessions = await queryAsync(`
            SELECT COUNT(*) as total FROM Session WHERE ${dateConditionSession}
        `);

        const chartData = await queryAsync(`
            SELECT MONTH(S.DateHeure) as mois, COUNT(P.Id_User) as count
            FROM Participe P
            JOIN Session S ON P.Id_Session = S.id
            WHERE YEAR(S.DateHeure) = YEAR(CURRENT_DATE())
            GROUP BY MONTH(S.DateHeure)
            ORDER BY mois ASC
        `);

        res.status(200).json({
            kpis: {
                inscrits: inscrits[0].total,
                tauxReussite: reussite[0].taux,
                nouvellesSessions: sessions[0].total
            },
            chart: chartData
        });

    } catch (error) {
        console.error("Erreur Stats Admin :", error);
        res.status(500).json({ error: "Erreur calcul des statistiques" });
    }
});

// ==========================================
// ROUTE 6 : RÉCUPÉRER LES DEMANDES DE CERTIFICATIONS (ADMIN)
// ==========================================
app.get('/api/admin/certifications-attente', verifyToken, (req, res) => {

    const sqlQuery = `
        SELECT
            u.id AS id_user,
            u.userName AS nom,
            YEAR(u.createdAt) AS actifDepuis,
            COUNT(DISTINCT p.Id_Formation) AS formationsInscrites,
            SUM(CASE WHEN p.IsPresent = 1 THEN 1 ELSE 0 END) AS coursEffectues,
            SUM(CASE WHEN p.IsPresent = 0 THEN 1 ELSE 0 END) AS absences,
            SUM(CASE WHEN p.IsPresent = 1 AND s.Duree IS NOT NULL THEN (TIME_TO_SEC(s.Duree) / 60) ELSE 0 END) AS heuresTotalesMinutes
        FROM users u
        JOIN Participe p ON u.id = p.Id_User
        LEFT JOIN Session s ON p.Id_Session = s.id
        GROUP BY u.id
    `;

    db.execute(sqlQuery, [], (error, results) => {
        if (error) {
            console.error("❌ Erreur SQL Admin Certifs:", error);
            return res.status(500).json({ error: "Erreur serveur BDD" });
        }

        console.log("👉 Bingo ! Utilisateurs trouvés pour les certificats :", results.length);

        const dataFormatee = results.map(user => {
            const totalMinutes = user.heuresTotalesMinutes || 0;
            const hours = Math.floor(totalMinutes / 60);
            const minutes = Math.floor(totalMinutes % 60);

            return {
                id_user: user.id_user,
                nom: user.nom || "Utilisateur inconnu",
                prenom: "",
                avatar: `https://i.pravatar.cc/150?u=${user.id_user}`,
                actifDepuis: user.actifDepuis || "2024",
                formationsInscrites: user.formationsInscrites || 0,
                coursEffectues: user.coursEffectues || 0,
                heuresTotales: `${hours}h${minutes === 0 ? '00' : minutes.toString().padStart(2, '0')}`,
                absences: user.absences || 0,
                dateAttente: "En attente"
            };
        });

        res.json(dataFormatee);
    });
});


const PORT = 3000;
app.listen(PORT, () => {
  console.log(`API en cours d'exécution sur le port ${PORT}`);
});