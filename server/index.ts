import express from 'express';
import adminRoutes from './routes/admin';
import authRoutes from './routes/auth';
app.use('/auth', authRoutes);

const app = express();
const PORT = process.env.PORT || 3001;

app.get('/', (req, res) => {
  res.send('ViewmaXX backend is running!');
});

app.use('/admin', adminRoutes);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
