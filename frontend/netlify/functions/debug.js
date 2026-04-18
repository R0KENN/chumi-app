exports.handler = async (event) => {
  const url = process.env.SUPABASE_URL || 'ПУСТО';
  const key = process.env.SUPABASE_KEY || 'ПУСТО';
  return {
    statusCode: 200,
    body: JSON.stringify({
      url_first_20: url.substring(0, 20),
      url_length: url.length,
      key_first_20: key.substring(0, 20),
      key_length: key.length
    })
  };
};
