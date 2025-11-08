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

// Authentication helpers
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

// Find user document by either session id (which may be ObjectId or string) or username
async function findUserBySession(sessionUser) {
  if (!sessionUser) return null;
  const users = db.collection('users');

  // Try by id first if present
  if (sessionUser.id) {
    try {
      if (ObjectId.isValid(sessionUser.id)) {
        const maybe = await users.findOne({ _id: new ObjectId(sessionUser.id) });
        if (maybe) return maybe;
      }
    } catch (err) {
      // ignore and fall through to username
    }
  }

  if (sessionUser.username) {
    const byName = await users.findOne({ username: sessionUser.username });
    if (byName) return byName;
  }

  // As a last resort try matching id as raw value (for in-memory stub where _id may be string)
  if (sessionUser.id) {
    const raw = await users.findOne({ _id: sessionUser.id });
    if (raw) return raw;
  }

  return null;
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
      // create with empty jobs array for new model
      await users.insertOne({ username: userEnv, passwordHash: hash, jobs: [] });
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
    // normalize id to string when possible to make in-memory and real DB consistent in session
    const uid = user._id && user._id.toString ? user._id.toString() : user._id;
    req.session.user = { id: uid, username: user.username };
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
    // Insert user with an empty jobs array for the embedded model
    const users = db.collection('users');
    const result = await users.insertOne({ username, passwordHash: hash, jobs: [] });
    // create session
    // store id as string when possible for consistency with in-memory stub
    const userId = result.insertedId ? (typeof result.insertedId === 'object' && result.insertedId.toString ? result.insertedId.toString() : result.insertedId) : null;
    req.session.user = { id: userId, username };
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

    const users = db.collection('users');

    // find current user document
    const userDoc = await findUserBySession(req.session.user);
    if (!userDoc) return res.status(401).json({ error: 'Unauthorized' });

    // create job id - use ObjectId for real DB, string for in-memory stub
  const jobId = client ? new ObjectId() : (Date.now().toString(36) + Math.random().toString(36).slice(2,8));

    const job = { _id: jobId, company, position, date: new Date(date) };

    // push into user's jobs array
    const query = userDoc._id ? { _id: userDoc._id } : { username: userDoc.username };
    await users.updateOne(query, { $push: { jobs: job } });

    // return job with _id as string when possible
    const returnedId = jobId && jobId.toString ? jobId.toString() : jobId;

    res.status(201).json({ 
      message: 'Job created successfully',
      jobId: returnedId,
      job: { ...job, _id: returnedId }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create job: ' + error.message });
  }
});

// Load jobs
app.get('/api/jobs', async (req, res) => {
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const users = db.collection('users');
    const userDoc = await findUserBySession(req.session.user);
    if (!userDoc) return res.status(401).json({ error: 'Unauthorized' });

  // Parse query params for server-side filtering
  // support comma-separated lists for company, position, stage
  const { company, position, stage, dateFrom, dateTo, sort, all, q } = req.query || {};
  // pagination
  const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
  const pageSize = Math.max(1, parseInt(req.query.pageSize || '10', 10) || 10);

    // Helper to parse CSV into array
    const parseList = (v) => {
      if (!v) return null;
      if (Array.isArray(v)) return v;
      return String(v).split(',').map(s => s.trim()).filter(Boolean);
    };

    const companies = parseList(company);
    const positions = parseList(position);
    const stages = parseList(stage);

    // If real Mongo client available, use aggregation to filter embedded array
    if (client) {
      const userId = userDoc._id;
      // Build pipeline to unwind user.jobs, filter, sort and paginate
      const pipeline = [];
      pipeline.push({ $match: { _id: userId } });
      pipeline.push({ $unwind: { path: '$jobs', preserveNullAndEmptyArrays: false } });

      // Build match conditions on the unwound job document (target nested fields under 'jobs')
      // Use keys like 'jobs.company', 'jobs.position' etc. Also support $or for q searches.
      const jobMatch = {};
      if (companies) jobMatch['jobs.company'] = { $in: companies };
      if (positions) jobMatch['jobs.position'] = { $in: positions };
      if (stages) jobMatch['jobs.stage'] = { $in: stages };
      if (dateFrom || dateTo) {
        const dateCond = {};
        if (dateFrom) dateCond.$gte = new Date(dateFrom);
        if (dateTo) dateCond.$lte = new Date(new Date(dateTo).setHours(23,59,59,999));
        jobMatch['jobs.date'] = dateCond;
      }
      // full-text style search across company/position/stage
      if (q) {
        const regex = { $regex: q, $options: 'i' };
        jobMatch.$or = [ { 'jobs.company': regex }, { 'jobs.position': regex }, { 'jobs.stage': regex } ];
      }

      if (Object.keys(jobMatch).length) pipeline.push({ $match: jobMatch });

      // Replace root with jobs document so we can sort/group easily
      pipeline.push({ $replaceRoot: { newRoot: '$jobs' } });

      // Sorting
      if (sort === 'oldest') pipeline.push({ $sort: { date: 1 } });
      else pipeline.push({ $sort: { date: -1 } });

      // Facet to get paginated data and total count
      pipeline.push({ $facet: {
        data: [ { $skip: (page - 1) * pageSize }, { $limit: pageSize } ],
        total: [ { $count: 'count' } ]
      }});

      const agg = await users.aggregate(pipeline).toArray();
      const data = (agg[0] && Array.isArray(agg[0].data)) ? agg[0].data : [];
      const totalCount = (agg[0] && Array.isArray(agg[0].total) && agg[0].total[0]) ? agg[0].total[0].count : 0;

      const jobs = data.map(j => ({ ...j, _id: j._id && j._id.toString ? j._id.toString() : j._id }));
      return res.json({ jobs, total: totalCount });
    }

    // Fallback for in-memory stub: filter on server side in JS and paginate
    let jobs = Array.isArray(userDoc.jobs) ? userDoc.jobs.slice() : [];
    if (companies && companies.length) jobs = jobs.filter(j => companies.includes(String(j.company)));
    if (positions && positions.length) jobs = jobs.filter(j => positions.includes(String(j.position)));
    if (stages && stages.length) jobs = jobs.filter(j => stages.includes(String(j.stage || '')));
    if (dateFrom) {
      const from = new Date(dateFrom);
      jobs = jobs.filter(j => new Date(j.date) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23,59,59,999);
      jobs = jobs.filter(j => new Date(j.date) <= to);
    }
    if (q) {
      const qq = String(q).toLowerCase();
      jobs = jobs.filter(j => (String(j.company || '').toLowerCase().includes(qq) || String(j.position || '').toLowerCase().includes(qq) || String(j.stage || '').toLowerCase().includes(qq)));
    }

    if (sort === 'oldest') jobs.sort((a,b) => new Date(a.date) - new Date(b.date));
    else jobs.sort((a,b) => new Date(b.date) - new Date(a.date));

    const totalCount = jobs.length;
    const start = (page - 1) * pageSize;
    const paged = jobs.slice(start, start + pageSize).map(j => ({ ...j, _id: j._id && j._id.toString ? j._id.toString() : j._id }));
    return res.json({ jobs: paged, total: totalCount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch jobs: ' + error.message });
  }
});

// UPDATE - Update a job by ID
app.put('/api/jobs/:id', async (req, res) => {
  try {
  const { id } = req.params;
  const { company, position, date, stage } = req.body;
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Unauthorized' });

    const users = db.collection('users');

    // Prepare job id for query: prefer ObjectId when valid, otherwise use string
    let queryId = id;
    if (ObjectId.isValid(id)) {
      try { queryId = new ObjectId(id); } catch (e) { /* keep as string */ }
    }

    const updateOps = {};
    if (company !== undefined) updateOps['jobs.$.company'] = company;
    if (position !== undefined) updateOps['jobs.$.position'] = position;
    if (date !== undefined) updateOps['jobs.$.date'] = new Date(date);
    if (stage !== undefined) updateOps['jobs.$.stage'] = stage;

    if (Object.keys(updateOps).length === 0) return res.status(400).json({ error: 'No updatable fields provided' });

    // Only update the job that belongs to the logged-in user
    const userDoc = await findUserBySession(req.session.user);
    if (!userDoc) return res.status(401).json({ error: 'Unauthorized' });

    const q = { _id: userDoc._id, 'jobs._id': queryId };
    const result = await users.updateOne(q, { $set: updateOps });

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

    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Unauthorized' });

    const users = db.collection('users');

    // Prepare job id for query
    let queryId = id;
    if (ObjectId.isValid(id)) {
      try { queryId = new ObjectId(id); } catch (e) { /* keep as string */ }
    }

    const userDoc = await findUserBySession(req.session.user);
    if (!userDoc) return res.status(401).json({ error: 'Unauthorized' });

    const result = await users.updateOne({ _id: userDoc._id }, { $pull: { jobs: { _id: queryId } } });

    // result.modifiedCount should be 1 when a job removed
    if (!result || result.modifiedCount === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({ 
      message: 'Job deleted successfully',
      deletedCount: 1
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete job: ' + error.message });
  }
});

// CLEANUP - Remove all jobs
app.delete('/api/cleanup', async (req, res) => {
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const users = db.collection('users');
    const userDoc = await findUserBySession(req.session.user);
    if (!userDoc) return res.status(401).json({ error: 'Unauthorized' });

    const result = await users.updateOne({ _id: userDoc._id }, { $set: { jobs: [] } });

    res.json({
      message: `Database cleaned successfully! Removed jobs for user ${userDoc.username}.`,
      deletedCount: result.modifiedCount
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to cleanup database: ' + error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Example app Listening on port ${PORT}`)
})