// Minimal test API function
export default function handler(req, res) {
  res.json({ ok: true, message: 'API is working', timestamp: new Date().toISOString() });
}
