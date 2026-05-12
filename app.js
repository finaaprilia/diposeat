const express = require('express');
const pool = require('./db');
const session = require('express-session'); // BARU: Untuk session
const app = express();
const port = 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));

// BARU: Biar server bisa baca data JSON & Form
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// BARU: Konfigurasi Session
app.use(session({
    secret: 'diposeat_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // Session aktif 1 hari
}));

// Route Utama (Update: Kirim data user ke EJS)
app.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM tables ORDER BY table_number ASC');
        // Kirim tables dan data session user (kalau ada)
        res.render('index', {
            tables: result.rows,
            user: req.session.user || null
        });
    } catch (err) {
        console.error(err);
        res.send("Error pas ambil data dari Neon");
    }
});

// BARU: Route Register
app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        // Cek email duplikat (Unique Check)
        const existing = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.json({ success: false, message: 'Email sudah terdaftar!' });
        }

        await pool.query('INSERT INTO users (username, email, password) VALUES ($1, $2, $3)',
            [username, email, password]);
        res.json({ success: true, message: 'Daftar berhasil! Silakan login.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// BARU: Route Login
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1 AND password = $2',
            [email, password]);

        if (result.rows.length > 0) {
            req.session.user = result.rows[0]; // Simpan info user di session
            res.json({ success: true });
        } else {
            res.json({ success: false, message: 'Email atau password salah' });
        }
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// BARU: Route Booking Meja
app.post('/book-table/:id', async (req, res) => {
    const tableId = req.params.id;
    const { name, phone, date, time } = req.body;

    if (!req.session.user) return res.status(401).send("Harus login dulu");

    try {
        // Update status meja dan simpan data pemesan
        await pool.query(
            `UPDATE tables SET 
             status = 'Occupied', 
             reserved_by = $1, 
             phone = $2, 
             res_date = $3, 
             res_time = $4 
             WHERE id = $5`,
            [name, phone, date, time, tableId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.post('/unbook-table/:id', async (req, res) => {
    const tableId = req.params.id;
    try {
        await pool.query(
            `UPDATE tables SET 
             status = 'Available', 
             reserved_by = NULL, 
             phone = NULL, 
             res_date = NULL, 
             res_time = NULL 
             WHERE id = $1`,
            [tableId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// Route Logout yang lebih bersih
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return console.log(err);
        }
        res.clearCookie('connect.sid'); // Hapus cookie session di browser
        res.redirect('/');
    });
});

// WAJIB ADA: Ini yang bikin servernya tetep nyala dan standby
app.listen(port, () => {
    console.log(`=========================================`);
    console.log(`🚀 DIPOSEAT IS RUNNING!`);
    console.log(`📱 Access it at: http://localhost:${port}`);
    console.log(`=========================================`);
});