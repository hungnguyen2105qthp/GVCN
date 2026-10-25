module.exports = function handler(_request, response) {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    response.status(503).json({ error: "Supabase chưa được cấu hình trên Vercel." });
    return;
  }

  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
};
