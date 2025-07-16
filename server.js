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
const bodyParser = require("body-parser")
const sessions = require('express-session');
app.use(bodyParser.urlencoded({ extended: true }));
const qrcode = require('qrcode');
const socketIo = require('socket.io');

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
const renderPage = (page, options = {}) => (req, res) => res.render(page, options);


const msgdb = new sqlite3.Database('payments.db');
msgdb.serialize(() => {

  msgdb.run(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    qr_id INTEGER,
    session_id TEXT,
    amount INTEGER,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

    
msgdb.run(`CREATE TABLE IF NOT EXISTS qr_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  qr_id TEXT UNIQUE,
  account_last4 TEXT,
  upi_id TEXT
)`);

  // Sample QR IDs
   msgdb.run(`INSERT OR IGNORE INTO qr_codes (qr_id, account_last4, upi_id) VALUES 
  ('QR1', '3115', '9301751642@pnb'),
  ('QR2', '7145', '9301751642@ybl'),
  ('QR3', '8989', 'example@okicici')`);
  
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


// Display payment form
app.get('/form', (req, res) => {
  res.render('form');
});

// Handle payment form submission
app.post('/form', (req, res) => {
  const { session_id, amount } = req.body;

  // Check if there's already a pending payment for this amount
  msgdb.get(`SELECT * FROM payments WHERE amount = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1`, [amount], (err, pendingPayment) => {
    if (err) return res.send('DB error');

    if (pendingPayment) {
      // Already someone paying this amount — redirect to wait
      return res.redirect(`/form-waiting/${pendingPayment.id}`);
    }

    // No pending payment — assign new QR
    msgdb.all(`SELECT * FROM qr_codes`, [], (err, allQrs) => {
      if (err) return res.send('QR load error');

      msgdb.all(`SELECT qr_id FROM payments WHERE status = 'pending'`, [], (err, used) => {
        const usedQrIds = used.map(r => r.qr_id);
        const availableQr = allQrs.find(qr => !usedQrIds.includes(qr.qr_id));
        if (!availableQr) return res.send('No QR available at the moment.');

        msgdb.run(`INSERT INTO payments (qr_id, session_id, amount) VALUES (?, ?, ?)`,
          [availableQr.qr_id, session_id, amount], function (err) {
            if (err) return res.send('Insert error');
            res.redirect(`/form-waiting/${this.lastID}`);
          });
      });
    });
  });
});

// Display waiting page with QR code
app.get('/form-waiting/:id', (req, res) => {
  const id = req.params.id;

  msgdb.get(`
    SELECT payments.*, qr_codes.upi_id 
    FROM payments 
    JOIN qr_codes ON payments.qr_id = qr_codes.qr_id 
    WHERE payments.id = ?
  `, [id], (err, row) => {
    if (!row) return res.redirect('/failure');

    const upi = row.upi_id;
    const amount = row.amount;
    const name = 'Ajay';
    const qr_link = `upi://pay?pa=${upi}&pn=${name}&am=${amount}&cu=INR`;

    if (row.status === 'success') {
      return res.redirect(`/success/${id}`);
    } else if (row.status === 'failed') {
      return res.redirect('/failure');
    }

    // Check if this payment is the first pending for the amount
    msgdb.get(`SELECT id FROM payments WHERE amount = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1`, [amount], async (err, firstPending) => {
      if (err || !firstPending) return res.redirect('/failure');

      if (parseInt(firstPending.id) !== parseInt(id)) {
        // Not your turn — wait
        return res.render('form-waiting', {
          session_id: row.session_id,
          qr_link: null,
          qr_upi: null,
          amount: row.amount
        });
      }

      // It's your turn — show QR
      try {
        const qrUrl = await qrcode.toDataURL(qr_link);
        res.render('form-waiting', {
          session_id: row.session_id,
          qr_link: qrUrl,
          qr_upi: qr_link,
          amount: row.amount
        });
      } catch (err) {
        console.error('QR generation failed:', err);
        res.redirect('/failure');
      }
    });
  });
});

// Display success page
app.get('/success/:id', (req, res) => {
  msgdb.get("SELECT * FROM payments WHERE id = ?", [req.params.id], (err, row) => {
    if (!row || row.status !== 'success') return res.redirect('/failure');
    res.render('success', { payment: row });
  });
});

// Display failure page
app.get('/failure', (req, res) => {
  res.render('failure');
});

console.log(new Date())
// Handle incoming SMS
app.post('/payment', (req, res) => {
  const message = req.body.message;
  const amountMatch = message.match(/INR\s+(\d+)\.(\d{2})?/i);
  const acctMatch = message.match(/a\/c\s+.*?(\d{4})/i); // last 4 digits

  console.log("📩 Received SMS:", message);

  if (!amountMatch || !acctMatch) {
    return res.status(400).send("❌ Invalid SMS");
  }

  const amount = parseInt(amountMatch[1]);
  const acctLast4 = acctMatch[1];

  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffsetMs);
  const fourMinAgo = new Date(istNow.getTime() - 4 * 60 * 1000);
  const formattedTime = fourMinAgo.toISOString().replace('T', ' ').split('.')[0];

  console.log("⏱️ IST now:", istNow.toLocaleString(), "| Auto-fail if before:", formattedTime);

  // Auto-fail old pending payments
  msgdb.run(`
    UPDATE payments
    SET status = 'failed'
    WHERE status = 'pending' AND created_at <= ?
  `, [formattedTime], (failErr) => {
    if (failErr) console.error("❌ Auto-fail error:", failErr);

    // Try to match this payment
    msgdb.get(`
      SELECT p.id FROM payments p
      JOIN qr_codes q ON p.qr_id = q.qr_id
      WHERE p.amount = ? AND p.status = 'pending' AND q.account_last4 = ?
      ORDER BY p.created_at ASC LIMIT 1
    `, [amount, acctLast4], (err, row) => {
      if (err) return res.status(500).send("DB error");

      if (row) {
        msgdb.run(`
          UPDATE payments
          SET status = 'success', created_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [row.id], (updateErr) => {
          if (updateErr) return res.status(500).send("Update error");
          res.send("✅ Payment matched & marked successful");
        });
      } else {
        res.send("⚠️ No matching pending payment found");
      }
    });
  });
});

// Auto-fail checker every 4 minutes
setInterval(() => {
  const now = new Date();
  const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const fourMinAgo = new Date(istNow.getTime() - 4 * 60 * 1000);
  const formattedTime = fourMinAgo.toISOString().replace('T', ' ').split('.')[0];

  msgdb.run(`
    UPDATE payments
    SET status = 'failed'
    WHERE status = 'pending' AND created_at <= ?
  `, [formattedTime], (err) => {
    if (err) console.error("⏱️ Auto-fail interval error:", err);
  });
}, 4 * 60 * 1000);


const sites = [
  "https://pnbagent.glitch.me"
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

/*    
// Ping every 4 minutes (less than Glitch's 5-minute sleep)
setInterval(() => {
  sites.forEach(site => {
    axios.get(site)
       
      .catch(err => console.log(`❌ Error pinging ${site}:`, err.message));
  });
}, 240000); // every 4 minutes
*/

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
app.get('/login', renderPage('login', { name: '', title: 'Login', menu: 'login',error:undefined }));
app.get('/result',renderPage('result',{roll_n:undefined}));

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
        url: "http://103.12.1.55:81/mkhu_dec_2024_results_1224/resultdisplay.php",
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
