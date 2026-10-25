module.exports = function handler(_request, response) {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    const missing = [];
    if (!SUPABASE_URL) missing.push("SUPABASE_URL (hoặc VITE_SUPABASE_URL)");
    if (!SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY (hoặc VITE_SUPABASE_PUBLISHABLE_KEY)");
    response.status(503).json({
      error: `Thiếu cấu hình Supabase trên Vercel: ${missing.join(", ")}. Thêm trong Settings → Environment Variables rồi redeploy.`,
    });
    return;
  }

  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
};
