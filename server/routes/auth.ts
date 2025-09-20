import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const router = Router();

// In-memory users for demo (replace with DB integration)
const users: { username: string; password: string; role: 'user' | 'admin' }[] = [
  { username: 'admin', password: bcrypt.hashSync('admin123', 10), role: 'admin' },
];

const JWT_SECRET = process.env.JWT_SECRET || 'changeme';

// Signup
router.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  if (users.find(u => u.username === username)) return res.status(409).json({ error: 'User exists' });
  const hashed = await bcrypt.hash(password, 10);
  users.push({ username, password: hashed, role: 'user' });
  res.json({ message: 'Signup successful' });
});

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, role: user.role });
});

export default router;
