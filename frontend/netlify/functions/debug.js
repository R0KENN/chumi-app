exports.handler = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      hasSupabaseUrl: !!process.env.SUPABASE_URL,
      hasSupabaseKey: !!process.env.SUPABASE_KEY,
      hasBotToken: !!process.env.BOT_TOKEN,
      supabaseUrlStart: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.substring(0, 15) : 'EMPTY',
      allEnvKeys: Object.keys(process.env).filter(k => k.startsWith('SUPA') || k.startsWith('BOT') || k.startsWith('WEBAPP'))
    })
  };
};
