exports.handler = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      SUPABASE_URL_value: process.env.SUPABASE_URL,
      SUPABASE_URL_length: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.length : 0,
      SUPABASE_URL_type: typeof process.env.SUPABASE_URL
    })
  };
};
