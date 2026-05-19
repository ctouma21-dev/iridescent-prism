export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    supabaseUrl: process.env.SUPABASE_URL       || '',
    supabaseKey: process.env.SUPABASE_ANON_KEY  || '',
  });
}
