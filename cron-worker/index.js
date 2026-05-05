export default {
  async scheduled(event, env) {
    const baseUrl = 'https://chumi-app.pages.dev';
    const headers = { 'Content-Type': 'application/json' };
    if (env.CRON_SECRET) headers['Authorization'] = `Bearer ${env.CRON_SECRET}`;

    // 1. Обновление серий (каждый запуск)
    try {
      const r1 = await fetch(`${baseUrl}/api/update-streaks`, { method: 'POST', headers });
      console.log('Streaks:', await r1.json());
    } catch (e) { console.error('Streak error:', e); }

    // 2. Напоминания (каждый запуск)
    try {
      const r2 = await fetch(`${baseUrl}/api/send-reminders`, { method: 'POST', headers });
      console.log('Reminders:', await r2.json());
    } catch (e) { console.error('Reminder error:', e); }

    // 3. Очистка пустых/неактивных пар (каждый запуск)
    try {
      const r3 = await fetch(`${baseUrl}/api/cleanup-empty-pairs`, { method: 'POST', headers });
      console.log('Cleanup:', await r3.json());
    } catch (e) { console.error('Cleanup error:', e); }

    // 4. Ежедневная сводка админу — только в 09:xx UTC (12:xx МСК)
    const now = new Date();
    if (now.getUTCHours() === 9) {
      try {
        const r4 = await fetch(`${baseUrl}/api/admin-daily-summary`, { method: 'POST', headers });
        console.log('Daily summary:', await r4.json());
      } catch (e) { console.error('Summary error:', e); }
    }
  },

  async fetch(request, env) {
    // Запуск вручную допустим только при наличии правильного секрета
    if (request.method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) {
        return new Response('Forbidden', { status: 403 });
      }
      await this.scheduled({}, env);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Chumi Cron Worker', { status: 200 });
  },
};
