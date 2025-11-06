import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { MongoClient, ServerApiVersion, ObjectId } from 'mongodb';


//constants
const app = express()
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const uri = process.env.MONGO_URI;

// Create client only if a URI is present. If not, we provide a minimal in-memory stub
let client;


app.use(express.static(join(__dirname, 'public')));
app.use(express.json());

// Session middleware (simple MemoryStore for demo/dev). In production use a persistent store.
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 } // 1 day
}));

let db;
async function connectDB() {
  try {
      if (!uri) {
        console.warn('MONGO_URI not set. Skipping real DB connection — using in-memory stub.');
        // Minimal in-memory stub to avoid runtime errors while developing without a DB
        const store = new Map();
        db = {
          _store: store,
          collection: (name) => {
            if (!store.has(name)) store.set(name, []);
            const arr = store.get(name);
            return {
              find: (q) => ({ toArray: async () => arr.slice() }),
              findOne: async (q) => {
                if (!q) return arr[0] || null;
                // simple matching for equality of top-level fields
                return arr.find(item => Object.keys(q).every(k => String(item[k]) === String(q[k]))) || null;
              },
              insertOne: async (doc) => {
                const _id = Date.now().toString(36) + Math.random().toString(36).slice(2,8);
                const rec = { ...doc, _id };
                arr.push(rec);
                return { insertedId: _id };
              },
              updateOne: async (q, update) => {
                const idx = arr.findIndex(item => Object.keys(q).every(k => String(item[k]) === String(q[k])));
                if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
                const set = (update && update.$set) || {};
                arr[idx] = { ...arr[idx], ...set };
                return { matchedCount: 1, modifiedCount: 1 };
              },
              deleteOne: async (q) => {
                const idx = arr.findIndex(item => Object.keys(q).every(k => String(item[k]) === String(q[k])));
                if (idx === -1) return { deletedCount: 0 };
                arr.splice(idx, 1);
                return { deletedCount: 1 };
              },
              deleteMany: async () => {
                const c = arr.length;
                arr.length = 0;
                return { deletedCount: c };
              }
            };
          }
        };
        return;
      }

    client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      }
    });

    await client.connect();
    db = client.db("jobs"); // Database name
    console.log("Connected to MongoDB!");
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
  }
}

// --- Authentication helpers ---
const ensureAuth = (req, res, next) => {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Unauthorized' });
};

async function findUserByUsername(username) {
  if (!db || !db.collection) {
    return null;
  }
  const user = await db.collection('users').findOne({ username });
  return user;
}

async function createDefaultUserFromEnv() {
  const userEnv = process.env.AUTH_USER;
  const passEnv = process.env.AUTH_PASS;
  if (!userEnv || !passEnv) return;
  try {
    const users = db.collection('users');
    const exists = await users.findOne({ username: userEnv });
    if (!exists) {
      const hash = await bcrypt.hash(passEnv, 10);
      await users.insertOne({ username: userEnv, passwordHash: hash });
      console.log('Created default user from env');
    }
  } catch (err) {
    console.error('Failed to create default user from env:', err.message);
  }
}

// After connecting to DB, try to create default user if credentials provided
connectDB().then(() => {
  if (db && db.collection) {
    createDefaultUserFromEnv();
  }
}).catch(() => {});

//APIs
// Serve login page at root
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'login.html'))
})

// Serve the main home/job list page at /home
app.get('/home', (req, res) => {
  // Serve only if session exists; otherwise let client-side redirect happen too
  if (req.session && req.session.user) {
    return res.sendFile(join(__dirname, 'public', 'home-page.html'))
  }
  // if not authenticated, still send login to avoid leaking file listing via static
  return res.redirect('/');
})

// Auth endpoints
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  try {
    // Try DB-backed user
    let user = null;
    if (db && db.collection) {
      user = await db.collection('users').findOne({ username });
    }

    // If no DB user and env default present, check against that
    if (!user && process.env.AUTH_USER && process.env.AUTH_USER === username && process.env.AUTH_PASS) {
      const ok = process.env.AUTH_PASS === password;
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
      // create a minimal session
      req.session.user = { username };
      return res.json({ message: 'ok', username });
    }

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const verified = await bcrypt.compare(password, user.passwordHash || user.password);
    if (!verified) return res.status(401).json({ error: 'Invalid credentials' });

    // create session
    req.session.user = { id: user._id, username: user.username };
    return res.json({ message: 'ok', username: user.username });
  } catch (err) {
    console.error('Login error', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// Register new user
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  try {
    // Check existing
    let exists = null;
    if (db && db.collection) {
      exists = await db.collection('users').findOne({ username });
    }
    if (exists) return res.status(409).json({ error: 'User already exists' });

    const hash = await bcrypt.hash(password, 10);
    const users = db.collection('users');
    const result = await users.insertOne({ username, passwordHash: hash });
    // create session
    req.session.user = { id: result.insertedId || null, username };
    return res.status(201).json({ message: 'created', username });
  } catch (err) {
    console.error('Register error', err);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(() => {});
  }
  res.json({ message: 'logged out' });
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.user) return res.json({ user: req.session.user });
  return res.status(401).json({ error: 'Unauthorized' });
});


// Add jobs
app.post('/api/jobs', async (req, res) => {
  // ensure auth
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { company, position, date } = req.body;
    
    // Simple validation
    if (!company || !position || !date) {
      return res.status(400).json({ error: 'Company, position, and date are required' });
    }

    const job = { company, position, date: new Date(date) };
    const result = await db.collection('jobs').insertOne(job);

    res.status(201).json({ 
      message: 'Job created successfully',
      jobId: result.insertedId,
      job: { ...job, _id: result.insertedId }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create job: ' + error.message });
  }
});

// Load jobs
app.get('/api/jobs', async (req, res) => {
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const jobs = await db.collection('jobs').find({}).toArray();
    res.json(jobs); // Return just the array for frontend simplicity
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch jobs: ' + error.message });
  }
});

// UPDATE - Update a job by ID
app.put('/api/jobs/:id', async (req, res) => {
  try {
  const { id } = req.params;
  const { company, position, date, stage } = req.body;

    // Validate ObjectId
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }

    const updateData = {};
    if (company) updateData.company = company;
    if (position) updateData.position = position;
  if (date) updateData.date = new Date(date);
  // allow updating stage (can be empty string)
  if (stage !== undefined) updateData.stage = stage;

    const result = await db.collection('jobs').updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({ 
      message: 'Job updated successfully',
      modifiedCount: result.modifiedCount 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update job: ' + error.message });
  }
});

// DELETE - Delete a job by ID
app.delete('/api/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }

    const result = await db.collection('jobs').deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({ 
      message: 'Job deleted successfully',
      deletedCount: result.deletedCount 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete job: ' + error.message });
  }
});

// CLEANUP - Remove all jobs
app.delete('/api/cleanup', async (req, res) => {
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const result = await db.collection('jobs').deleteMany({});

    res.json({
      message: `Database cleaned successfully! Removed ${result.deletedCount} jobs.`,
      deletedCount: result.deletedCount 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to cleanup database: ' + error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Example app Listening on port ${PORT}`)
})