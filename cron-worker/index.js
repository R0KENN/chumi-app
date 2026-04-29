export default {
  async scheduled(event, env) {
    const baseUrl = 'https://chumi-app.pages.dev';
    const headers = { 'Content-Type': 'application/json' };
    if (env.CRON_SECRET) headers['Authorization'] = `Bearer ${env.CRON_SECRET}`;

    try {
      const r1 = await fetch(`${baseUrl}/api/update-streaks`, { method: 'POST', headers });
      console.log('Streaks:', await r1.json());
    } catch (e) { console.error('Streak error:', e); }

    try {
      const r2 = await fetch(`${baseUrl}/api/send-reminders`, { method: 'POST', headers });
      console.log('Reminders:', await r2.json());
    } catch (e) { console.error('Reminder error:', e); }

    try {
      const r3 = await fetch(`${baseUrl}/api/cleanup-empty-pairs`, { method: 'POST', headers });
      console.log('Cleanup:', await r3.json());
    } catch (e) { console.error('Cleanup error:', e); }
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
