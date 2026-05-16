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
            // Mengirim data session user atau admin agar navbar bisa adaptif
            user: req.session.user || req.session.admin || null
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
        // 1. Cari di tabel 'users' (Sekarang admin & user masuk sini semua)
        const result = await pool.query('SELECT * FROM users WHERE username = $1 OR email = $1', [username]);

        if (result.rows.length > 0) {
            const user = result.rows[0];
            const match = await bcrypt.compare(password, user.password);

            if (match) {
                // 2. CEK ROLE-NYA DI SINI
                if (user.role === 'admin') {
                    // Kalau role-nya admin, kasih session admin
                    req.session.admin = { id: user.id, username: user.username };
                    return res.redirect('/admin'); // Dilempar ke dashboard admin
                } else {
                    // Kalau role-nya user, kasih session user
                    req.session.user = { id: user.id, username: user.username };
                    return res.redirect('/'); // Dilempar ke landing page (index)
                }
            }
        }

        req.flash('error', 'Username/Email atau Password salah!');
        res.redirect('/login');
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
});

// ROUTE KHUSUS USER UNTUK BOOKING
app.post('/user/book-table/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { reserved_by, phone, reservation_date, reservation_time } = req.body;

        await pool.query(
            `UPDATE tables 
             SET reserved_by = $1, phone = $2, res_date = $3, res_time = $4, status = 'occupied'
             WHERE id = $5`,
            [reserved_by, phone, reservation_date, reservation_time, id]
        );
        res.sendStatus(200);
    } catch (err) {
        console.error("USER BOOKING ERROR:", err.message);
        res.status(500).send("Gagal booking");
    }
});

app.get('/logout', (req, res) => {
    // 1. Simpan status admin di variabel sementara sebelum session dihapus
    const logoutDariAdmin = req.session.admin ? true : false;

    // 2. Hancurkan session
    req.session.destroy((err) => {
        if (err) {
            console.error("Gagal logout:", err);
            return res.redirect('/');
        }

        // 3. Hapus cookie session di browser
        res.clearCookie('connect.sid');

        // 4. Cek: Kalau tadi dia admin, balik ke /login. Kalau user, balik ke / (home)
        if (logoutDariAdmin) {
            res.redirect('/login');
        } else {
            res.redirect('/');
        }
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
    const adminId = req.session.admin.id;

    try {
        if (password && password.trim() !== "") {
            // KONDISI 1: Ganti Nama + Password (Password di-hash)
            const hashedPassword = await bcrypt.hash(password, 10);
            await pool.query(
                'UPDATE users SET username = $1, password = $2 WHERE id = $3',
                [name, hashedPassword, adminId]
            );
        } else {
            // KONDISI 2: Hanya Ganti Nama (PASTIKAN PAKE 'username', BUKAN 'name')
            await pool.query(
                'UPDATE users SET username = $1 WHERE id = $2',
                [name, adminId]
            );
        }

        // UPDATE SESSION: Supaya nama di pojok kanan atas langsung berubah tanpa logout
        req.session.admin.username = name;

        req.flash('success', 'Profil admin berhasil diperbarui!');
        res.redirect('/admin/settings');

    } catch (err) {
        console.error("Error Update Admin:", err.message);
        res.status(500).send("Gagal memperbarui profil admin.");
    }
});

app.get('/register', (req, res) => {
    res.render('register');
});

app.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        // Validasi input kosong
        if (!username || !email || !password) {
            req.flash('error', 'Semua kolom wajib diisi!');
            return res.redirect('/register');
        }

        // LOGIC CEK EMAIL GANDA:
        const checkEmail = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

        if (checkEmail.rows.length > 0) {
            // Jika email sudah ada, kirim pesan error
            req.flash('error', 'Email sudah terdaftar, gunakan email lain!');
            return res.redirect('/register');
        }

        // Hash password sebelum simpan
        const hashedPassword = await bcrypt.hash(password, 10);

        // Simpan user baru (Role default 'user')
        await pool.query(
            'INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4)',
            [username, email, hashedPassword, 'user']
        );

        req.flash('success', 'Registrasi berhasil! Silakan login.');
        res.redirect('/?auth=login'); // Lempar ke index dengan parameter auth

    } catch (err) {
        console.error("Error Regis:", err.message);
        res.status(500).send("Gagal mendaftarkan akun.");
    }
});

app.get('/my-reservations', async (req, res) => {
    if (!req.session.user) {
        req.flash('error', 'Silakan login dulu bos!');
        return res.redirect('/login');
    }

    try {
        const result = await pool.query(
            "SELECT * FROM tables WHERE reserved_by = $1 AND status = 'occupied' ORDER BY res_date ASC",
            [req.session.user.username]
        );

        // NAMA FILE HARUS SESUAI (Tanpa .ejs)
        res.render('reservasi', {
            user: req.session.user,
            reservations: result.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal muat data");
    }
});

app.listen(port, () => {
    console.log(`🚀 DIPOSEAT RUNNING ON http://localhost:${port}`);
});