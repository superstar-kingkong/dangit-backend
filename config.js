// config.js
export const API_URL = process.env.NODE_ENV === 'production' 
  ? process.env.RENDER_EXTERNAL_URL || 'https://your-app-name.onrender.com'
  : 'http://localhost:3001';
