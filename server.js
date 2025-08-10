const app = require("express")();
const axios = require("axios");

app.use(require("express").static("public"))
    .set('view engine', 'ejs')
    .set('views', __dirname + '/views');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const request = require("request");
app.use(cors());
const bodyParser = require("body-parser");
const sessions = require('express-session');
app.use(bodyParser.urlencoded({ extended: true }));
const qrcode = require('qrcode');
const http = require('http');
const socketIo = require('socket.io');
const server = http.createServer(app);
const io = socketIo(server);

app.use(sessions({
    secret: 'K0201508',
    resave: true,
    saveUninitialized: true
}));
   //.get("/", (req, res) => res.send("Hello, Speedrun Express! 🚀"))


// Auto-create db file in the current directory
const dbFile = path.join(__dirname, 'student.db');

// Open (or create if not exists) the database
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
        //console.error("Error opening database", err);
    } else {
        //console.log("Database opened successfully");
    }
});
// Create table if it doesn't exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS student (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rollno TEXT,
        name TEXT,
        application_no TEXT,
        fathername TEXT,
        mothername TEXT,
        mobileno TEXT,
        other1 TEXT,
        other2 TEXT,
        other3 TEXT,
        other4 TEXT,
        other5 TEXT,
        other6 TEXT,
        other7 TEXT,
        other8 TEXT
    )`, (err) => {
        if (err) {
            //console.error("Error creating table", err);
        } else {
            //console.log("Table 'student' is ready");
        }
    });
});


// Auth middleware
function isAuth(req, res, next) {
  /*  if (!req.session.user) {
     // console.log(new Date().getHours());
//console.log(new Date().getMinutes());
       // return res.redirect('/login');
      //next();
    //  next();
    }*/
 // res.redirect('/dashboard')
    //next(); // Allow access to next middleware or route
  next();
}

const renderPage = (page, options = {}) => (req, res) => {
  const user = req.session?.user || undefined;
  res.render(page, {
    ...options,
    user // pass user to template
  });
};



const msgdb = new sqlite3.Database('payments.db');
msgdb.serialize(() => {
  // Create 'payments' table
  msgdb.run(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    qr_id TEXT,
    session_id TEXT,
    amount INTEGER,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Create 'qr_codes' table
  msgdb.run(`CREATE TABLE IF NOT EXISTS qr_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    qr_id TEXT UNIQUE,
    account_last4 TEXT,
    upi_id TEXT
  )`);

  // Insert only one QR
  msgdb.run(`INSERT OR IGNORE INTO qr_codes (qr_id, account_last4, upi_id) VALUES 
    ('QR1', '3115', '9301751642@pnb')
  `);
});

app.post('/ntmsg', (req, res) => {
  const message = req.body.message;
  console.log("message");

  console.log("📩 Received Paytm Notification:", message); // <-- console.log here!

  // You can add logic to extract amount, upi ID etc. here
  // For example:
  const amountMatch = message.match(/INR\s+(\d+\.\d{2})/);
  if (amountMatch) {
    const amount = amountMatch[1];
    console.log("💰 Extracted Amount:", amount);
  }

  res.sendStatus(200);
});

// WebSocket connections
io.on('connection', (socket) => {
  console.log('🔌 New client connected');

  socket.on('watch-payment', (paymentId) => {
    socket.join(`payment_${paymentId}`);
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected');
  });
});

function emitPaymentUpdate(paymentId, status) {
  io.to(`payment_${paymentId}`).emit('payment-status', { paymentId, status });
}

// Payment Form
app.get('/form', (req, res) => {
  res.render('form');
});


app.get('/signup', (req, res) => {
  res.render('signup');
});

// Handle Signup POST
app.post('/signup', async (req, res) => {
  const {
    rollno, name, application_no,
    fathername, mothername, mobileno,
    other1, other2, other3, other4,
    other5, other6, other7, other8
  } = req.body;

  const sql = `
    INSERT INTO students (
      rollno, name, application_no,
      fathername, mothername, mobileno,
      other1, other2, other3, other4,
      other5, other6, other7, other8
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    rollno, name, application_no,
    fathername, mothername, mobileno,
    other1, other2, other3, other4,
    other5, other6, other7, other8
  ];

  db.run(sql, values, function (err) {
    if (err) {
      return res.send('❌ Error inserting into database: ' + err.message);
    }

    res.render('success', {
      user: {
        id: this.lastID,
        rollno, name, application_no,
        fathername, mothername, mobileno,
        other1, other2, other3, other4,
        other5, other6, other7, other8
      }
    });
  });
});

//newpga

const paybydb = new sqlite3.Database('./paydb.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database');
        // Create table if not exists
        paybydb.run(`CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message TEXT NOT NULL,
            amount REAL,
            txnid TEXT,
            user TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    }
});

// Routes
// GET /payment - Show QR and UTR input form
app.get('/payment', (req, res) => {
    res.render('payment');
});

// POST /payment - Receive payment message
app.post('/payment', (req, res) => {
    const { message } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    // Extract amount and txnid from message
    const amountMatch = message.match(/Rs\.(\d+(?:\.\d{2})?)/);
    const txnidMatch = message.match(/Txn ID:\s*(\w+)/);
    
    const amount = amountMatch ? parseFloat(amountMatch[1]) : null;
    const txnid = txnidMatch ? txnidMatch[1] : null;

    // Insert into database
    paybydb.run(
        `INSERT INTO messages (message, amount, txnid) VALUES (?, ?, ?)`,
        [message, amount, txnid],
        function(err) {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ error: 'Database error' });
            }
            
            console.log('Message stored with ID:', this.lastID);
            res.json({ 
                success: true, 
                id: this.lastID,
                amount: amount,
                txnid: txnid
            });
        }
    );
});

// POST /verify - Verify UTR and update user
app.post('/verify', (req, res) => {
    const { utr, user } = req.body;
    
    if (!utr) {
        return res.status(400).json({ error: 'UTR is required' });
    }

    // Find message by txnid and update user
    paybydb.run(
        `UPDATE messages SET user = ? WHERE txnid = ?`,
        [user || '', utr],
        function(err) {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (this.changes === 0) {
                return res.json({ success: false, message: 'UTR not found' });
            }
            
            res.json({ 
                success: true, 
                message: 'Verification successful',
                updated: this.changes
            });
        }
    );
});

// GET /messages - View all messages (optional for testing)
app.get('/messages', (req, res) => {
    paybydb.all(`SELECT * FROM messages ORDER BY created_at DESC`, (err, rows) => {
        if (err) {
            console.error('Database error:', err.message);
            return res.status(500).json({ error: 'Database error' });
        }
        res.render('messages', { messages: rows });
    });
});

const sites = [
  "https://csandjurnalism.onrender.com"
];

const utcNow = new Date();

// Add 5 hours and 30 minutes manually (for IST)
const newHour = utcNow.getUTCHours() + 5;
const newMinute = utcNow.getUTCMinutes() + 30;

// Handle minute overflow
let istHour = newHour;
let istMinute = newMinute;
if (istMinute >= 60) {
    istMinute -= 60;
    istHour += 1;
}

// Optional: handle 24-hour overflow
if (istHour >= 24) {
    istHour -= 24;
}

function checkup() {
    
// Ping every 4 minutes (less than Glitch's 5-minute sleep)
setInterval(() => {
  sites.forEach(site => {
    axios.get(site)
       
      .catch(err => console.log(`❌ Error pinging ${site}:`, err.message));
  });
}, 240000); // every 4 minutes

}

// Call checkup only if IST hour is between 8 and 20
if (istHour >= 9 && istHour <= 19) {
  
  //  checkup();
}

    
// Ping every 4 minutes (less than Glitch's 5-minute sleep)
setInterval(() => {
  sites.forEach(site => {
    axios.get(site)
       
      //.catch(err => console.log(`❌ Error pinging ${site}:`, err.message));
  });
}, 49000); // every 4 minutes


app.get("/ping", (req, res) => {
  
  res.send("Pinger bot is alive 🚀");
                               });
const text = 'upi://pay?pa=9301751642@pnb&pn=Ajay%20Vishwakarma';

const options = {
    errorCorrectionLevel: 'H',
    type: 'image/png',
    rendererOpts: { quality: 1 }
};

let qrUrl; // define variable outside

async function generateQR() {
    try {
        qrUrl = await qrcode.toDataURL(text, options);
        //console.log('QR Code URL:', qrUrl); // use the variable here
        // You can now use `qrUrl` wherever needed (inside this function or after awaited)
    } catch (err) {
        console.error('QR generation failed:', err);
    }
}

//generateQR();

app.get('/', renderPage('home'));
app.get('/gallery', renderPage('gallery'));
app.get('/login', renderPage('login', { name: '', title: 'Login', menu: 'login',error:undefined,}));
app.get('/result',renderPage('result',{roll_n:undefined}));
app.get('/bca', renderPage('bca'));
app.get('/ba', renderPage('ba'));
app.get('/diploma', renderPage('diploma'));
app.get('/certificate', renderPage('certificate'));
app.get('/apply', renderPage('apply'));
app.get('/eligibility', renderPage('eligibility'));
app.get('/fees', renderPage('fees'));
app.get('/scholarships', renderPage('scholarships'));
app.get('/facilities', renderPage('facilities'));
app.get('/contact', renderPage('contact'));

app.get('/dashboard', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    res.render('student',{user:req.session.user});
});
app.post('/result',(req,res)=>{
  const roll_n= req.body;
  res.render('result',{roll_n:roll_n});
});

app.post('/login', (req, res) => {
    const { loginUser } = req.body;

    if (!loginUser) {
        return res.render('login', { title: 'Login', error: 'Invalid Input' });
    }

    db.get("SELECT * FROM student WHERE rollno = ?", [loginUser], (err, user) => {
        if (err) {
            console.error(err);
            return res.render('login', { title: 'Login', error: 'Database Error' });
        }
        if (!user) {
            return res.render('login', { 
                title: 'Login', 
                error: '<p style="color:red;border-radius:30px;border:3px dotted black;text-align:center;">Unauthorized User</p>'
            });
        }

        // Store user info in session
        req.session.user = user;
        res.redirect('/dashboard'); // Redirect to a protected route
    });
});

app.post("/proxy", (req, res) => {
    request.post({
        url: "http://103.12.1.55:81/mkhu_jun_2025_results_0625/resultdisplay.php",
        form: req.body
    }).pipe(res);
});
/*
app.post("/payment",(req,res)=>{
  console.log(req.body.message);
})
*/
app.get('/fee',renderPage('fee'));
/*
app.post('/payment',(req,res)=>{

const {message}=req.body;
console.log(message);

})
*/
app.post('/studentdata',(req,res)=>{
  
  let okdata = req.body;
  
  function insertStudent(data) {
    const sql = `INSERT INTO student 
        (rollno, name, application_no, fathername, mothername, mobileno, other1, other2, other3, other4, other5, other6, other7, other8) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.run(sql, [
        data.rollno,
        data.name,
        data.application_no,
        data.fathername,
        data.mothername,
        data.mobileno,
        data.other1,
        data.other2,
        data.other3,
        data.other4,
        data.other5,
        data.other6,
        data.other7,
        data.other8
    ], function (err) {
        if (err) {
            //console.error("Error inserting data", err);
        } else {
            //console.log("Student inserted with ID:", this.lastID);
        }
    });
}
  const dataString = Object.keys(okdata)[0];

// Split by `,`
const ok_data = dataString.split(',');


// Example insert
insertStudent({
    rollno: ok_data[0]||"",
    name: ok_data[2]||"",
    application_no: ok_data[1]||"",
    fathername: ok_data[3]||"",
    mothername: ok_data[4]||"",
    mobileno:ok_data[5]||"",
    other1:ok_data[6]||"",
    other2:ok_data[7]||"",
    other3:ok_data[8]||"",
    other4:ok_data[9]||"",
    other5:ok_data[10]||"",
    other6:ok_data[11]||"",
    other7:ok_data[12]||"",
    other8:ok_data[13]||""
});
  
  /*
  fs.appendFile('views/stuu.ejs', `${studentdata}`, (err) => {
    if (err) {
        console.error('Error appending to file:', err);
    } else {
        console.log('Content appended successfully!');
    }
});*/
});

app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
      res.sendStatus(500);
    } else {
      res.redirect('/login');
    }
  });
});


app.use((req,res,next)=>{
  
  
  res.render('redirecterr',{req:req.url});
})




   app.listen(
  { port: process.env.PORT, host: "0.0.0.0" },
  function (err, address) {
    if (err) {
      //console.error(err);
      process.exit(1);
    }
   // console.log(`Your app is listening on ${address}`);
  }
);
