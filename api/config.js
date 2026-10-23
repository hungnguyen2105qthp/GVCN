module.exports = function handler(_request, response) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    response.status(503).json({ error: "Supabase chưa được cấu hình trên Vercel." });
    return;
  }

  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
};
