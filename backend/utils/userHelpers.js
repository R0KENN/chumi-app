const { supabaseAdmin } = require('../supabaseClient');

async function getOrCreateUser(telegramId, username, firstName) {
  // Пытаемся найти пользователя
  const { data: existingUser, error: selectError } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existingUser) return existingUser;

  // Если нет – создаем
  const { data: newUser, error: insertError } = await supabaseAdmin
    .from('users')
    .insert({
      telegram_id: telegramId,
      username,
      first_name: firstName,
    })
    .select()
    .single();

  if (insertError) throw insertError;
  return newUser;
}

module.exports = { getOrCreateUser };