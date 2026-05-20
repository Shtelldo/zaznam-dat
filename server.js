const express = require('express');
const mysql = require('mysql2');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();

// Povolenie CORS, aby mohol frontend komunikovať so serverom
app.use(cors());
app.use(express.json());

// Servírovanie statických súborov z projektik priečinka
app.use(express.static(path.join(__dirname, 'projektik')));

// Vytvorenie stabilného Connection Poolu pre databázu ulozena_dat
const db = mysql.createPool({
    host: 'localhost',  
    user: 'root',          
    password: '',         
    database: 'ulozena_dat', // Presne podľa tvojho obrázka z phpMyAdmin
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Otestovanie spojenia s databázou pri štarte
db.getConnection((err, connection) => {
    if (err) {
        console.error("❌ Chyba pripojenia k MySQL. Beží ti XAMPP? Chyba:", err.message);
        return;
    }
    console.log("✅ Úspešne prepojené s MySQL databázou (ulozena_dat) cez Connection Pool!");
    connection.release();
});

// 1. ENDPOINT: Stiahnutie dát z externého API a uloženie do MySQL
app.get('/update-database', async (req, res) => {
    try {
        console.log("🔄 Sťahujem čerstvé dáta z externého API...");
        const response = await axios.get('http://test.qvamp.eu/feed');
        
        // Poistka, ak by náhodou neprišlo pole
        const users = Array.isArray(response.data) ? response.data : [];
        console.log(`📥 Stiahnutých ${users.length} užívateľov. Idem premazať starú databázu...`);

        if (users.length === 0) {
            console.log("⚠️  POZOR: API vrátilo 0 užívateľov!");
            return res.status(400).json({ status: "error", message: "API vrátilo 0 údajov" });
        }

        // Premazanie starej tabuľky, aby sme nemali duplicity
        await new Promise((resolve, reject) => {
            db.query('DELETE FROM users', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Hromadná príprava na zápis do MySQL
        const insertPromises = users.map(u => {
            // Koníčky spojíme do jedného textového reťazca oddeleného čiarkou, aby vošli do jedného stĺpca
            const hobbiesString = Array.isArray(u.hobbies) ? u.hobbies.join('|') : '';
            
            const sql = `INSERT INTO users (uid, name, birth_date, country, street, city, postal_code, hobbies)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
            
            const values = [
                u.uid || null,
                u.name || '',
                u.birth_date || '',
                u.country || '',
                u.address?.street || '',
                u.address?.city || '',
                u.address?.postal_code || '',
                hobbiesString
            ];

            return new Promise((resolve, reject) => {
                db.query(sql, values, (err) => {
                    if (err) {
                        console.error("❌ Chyba pri vkladaní užívateľa:", err.message);
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        });

        // Počkám, kým sa všetci užívatelia zapíšu
        await Promise.all(insertPromises);
        
        console.log("💾 Všetky dáta boli úspešne uložené do MySQL databázy.");
        res.json({ status: "success", message: "Databáza bola úspešne aktualizovaná!" });

    } catch (error) {
        console.error("❌ Chyba pri aktualizácii databázy:", error.message);
        res.status(500).json({ status: "error", message: error.message });
    }
});

// 2. ENDPOINT: Čítanie užívateľov z databázy pre tvoj frontend
app.get('/get-users', (req, res) => {
    console.log("🔍 Frontend si pýta dáta z MySQL...");
    db.query('SELECT * FROM users', (err, results) => {
        if (err) {
            console.error("❌ Chyba pri čítaní z MySQL:", err.message);
            return res.status(500).json({ error: "Nedá sa čítať z databázy" });
        }
        res.json(results);
    });
});

// 3. ENDPOINT: Aktualizácia užívateľa v databáze
app.post('/update-user', (req, res) => {
    console.log("📨 POST /update-user prijaté! Body:", JSON.stringify(req.body));
    
    const { uid, name, birth_date, country, street, city, postal_code, hobbies } = req.body;
    
    if (!uid) {
        console.error("❌ Chyba: UID chýba!");
        return res.status(400).json({ status: "error", message: "UID chýba" });
    }
    
    console.log(`✏️  Aktualizujem užívateľa ID ${uid}...`);
    
    const sql = `UPDATE users SET name=?, birth_date=?, country=?, street=?, city=?, postal_code=?, hobbies=? WHERE uid=?`;
    const values = [name, birth_date, country, street, city, postal_code, hobbies, uid];
    
    db.query(sql, values, (err) => {
        if (err) {
            console.error("❌ Chyba pri aktualizácii:", err.message);
            return res.status(500).json({ status: "error", message: err.message });
        }
        console.log(`✅ Užívateľ ${uid} bol úspešne aktualizovaný.`);
        res.json({ status: "success", message: "Užívateľ bol uložený" });
    });
});

// 4. ENDPOINT: Vytvorenie nového užívateľa v databáze
app.post('/add-user', (req, res) => {
    console.log("📨 POST /add-user prijaté! Body:", JSON.stringify(req.body));
    
    const { name, birth_date, country, street, city, postal_code, hobbies } = req.body;
    
    console.log(`➕ Pridávam nového užívateľa: ${name}...`);
    
    const sql = `INSERT INTO users (name, birth_date, country, street, city, postal_code, hobbies) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const values = [name, birth_date, country, street, city, postal_code, hobbies];
    
    db.query(sql, values, (err, results) => {
        if (err) {
            console.error("❌ Chyba pri vkladaní:", err.message);
            return res.status(500).json({ status: "error", message: err.message });
        }
        console.log(`✅ Nový užívateľ bol vytvorený s ID ${results.insertId}.`);
        res.json({ status: "success", message: "Užívateľ bol vytvorený", uid: results.insertId });
    });
});

// Spustenie servera na porte 3000
app.listen(3000, () => {
    console.log("======================================================");
    console.log("🚀 Node.js server úspešne beží na http://localhost:3000");
    console.log("======================================================");
});