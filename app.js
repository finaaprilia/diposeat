const express = require('express');
const pool = require('./db');
const session = require('express-session');
const flash = require('express-flash');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const app = express();
const port = 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser('secret_diposeat'));
app.use(session({
    secret: 'diposeat_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(flash());

const isAdmin = (req, res, next) => {
    if (req.session.admin) return next();
    res.redirect('/login');
};

app.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM tables ORDER BY table_number ASC');
        res.render('index', {
            tables: result.rows,
            user: req.session.user || null
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error koneksi database");
    }
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
        if (result.rows.length > 0) {
            const admin = result.rows[0];
            const match = await bcrypt.compare(password, admin.password);
            if (match) {
                req.session.admin = {
                    id: admin.id,
                    name: admin.name,
                    username: admin.username
                };
                return res.redirect('/admin');
            }
        }
        req.flash('error', 'Username atau Password salah!');
        res.redirect('/login');
    } catch (err) {
        console.error(err);
        res.status(500).send("Terjadi kesalahan pada server");
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

app.get('/admin', isAdmin, async (req, res) => {
    try {
        const tablesResult = await pool.query('SELECT * FROM tables ORDER BY table_number ASC');
        // Query ini sekarang mengambil semua meja yang statusnya 'occupied' 
        // baik dari Booking User maupun Walk-in Admin
        const reservationsResult = await pool.query(`
            SELECT res_date as date, res_time as time, table_number, reserved_by as customer_name, phone
            FROM tables 
            WHERE status = 'occupied' 
            ORDER BY res_date ASC, res_time ASC
        `);

        res.render('admin', {
            admin: req.session.admin,
            tables: tablesResult.rows,
            reservations: reservationsResult.rows
        });
    } catch (err) {
        res.status(500).send("Error loading admin dashboard");
    }
});

app.post('/admin/update-table/:id', isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { reserved_by, phone, reservation_date, reservation_time } = req.body;

        await pool.query(
            `UPDATE tables 
             SET reserved_by = $1, 
                 phone = $2, 
                 res_date = $3, 
                 res_time = $4,
                 status = $5
             WHERE id = $6`,
            [
                reserved_by || null,
                phone || null,
                reservation_date || null,
                reservation_time || null,
                (reserved_by && reserved_by.trim() !== '' ? 'occupied' : 'available'),
                id
            ]
        );

        res.sendStatus(200);
    } catch (err) {
        console.error("ERROR DATABASE:", err.message);
        res.status(500).send(err.message);
    }
});

app.post('/admin/add-table', isAdmin, async (req, res) => {
    const { tableNumber, capacity } = req.body;
    try {
        await pool.query(
            `INSERT INTO tables (table_number, capacity, status) 
             VALUES ($1, $2, 'available')`,
            [tableNumber, capacity]
        );
        res.redirect('/admin'); // Refresh halaman admin
    } catch (err) {
        console.error("Gagal tambah meja:", err.message);
        res.status(500).send("Gagal menambahkan meja ke database.");
    }
});

// Route untuk menghapus meja
app.delete('/admin/delete-table/:id', isAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        await pool.query('DELETE FROM tables WHERE id = $1', [id]);

        // Kirim status OK ke frontend
        res.sendStatus(200);
    } catch (err) {

        console.error("Gagal hapus meja:", err.message);
        res.status(500).send(err.message);
    }
});

app.post('/admin/unbook-table/:id', isAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Kembalikan status ke available DAN kosongkan data nama & nomor telepon
        await pool.query(
            "UPDATE tables SET status = 'available', reserved_by = NULL, phone = NULL WHERE id = $1",
            [id]
        );

        // 2. Hapus data reservasi terkait untuk membersihkan histori jadwal
        await pool.query("DELETE FROM reservations WHERE table_id = $1", [id]);

        res.sendStatus(200);
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal unbook meja");
    }
});

// ROUTE SETTINGS YANG DIPERBAIKI
app.get('/admin/settings', isAdmin, (req, res) => {
    res.render('settings', {
        title: 'Settings',
        // Kirim req.user sebagai admin. Jika req.user undefined, kirim objek kosong
        admin: req.user || {}
    });
});

app.post('/admin/update-settings', isAdmin, async (req, res) => {
    const { name, password } = req.body;
    const adminId = req.user.id; // Ambil ID admin yang sedang login

    try {
        if (password && password.trim() !== "") {
            // KONDISI 1: User isi password baru (Ganti Nama + Password)
            // Jangan lupa di-hash dulu password-nya kalau kamu pakai bcrypt
            const hashedPassword = await bcrypt.hash(password, 10);
            await pool.query(
                'UPDATE users SET name = $1, password = $2 WHERE id = $3',
                [name, hashedPassword, adminId]
            );
        } else {
            // KONDISI 2: Password kosong (Hanya Ganti Nama)
            await pool.query(
                'UPDATE users SET name = $1 WHERE id = $2',
                [name, adminId]
            );
        }

        res.redirect('/admin/settings?success=true');
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memperbarui profil");
    }
});

app.listen(port, () => {
    console.log(`🚀 DIPOSEAT RUNNING ON http://localhost:${port}`);
});