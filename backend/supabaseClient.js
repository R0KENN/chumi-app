const { createClient } = require('@supabase/supabase-js');

// Клиент для использования в API (с правами анонимного пользователя)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Административный клиент для операций, требующих полного доступа (бот)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = { supabase, supabaseAdmin };