export default {
  async scheduled(event, env) {
    const baseUrl = 'https://chumi-app.pages.dev';
    const headers = { 'Content-Type': 'application/json' };
    if (env.CRON_SECRET) headers['Authorization'] = `Bearer ${env.CRON_SECRET}`;

    const now = new Date();
    const hour = now.getUTCHours();

    // 1. Серии — каждый запуск
    try {
      const r1 = await fetch(`${baseUrl}/api/update-streaks`, { method: 'POST', headers });
      console.log('Streaks:', await r1.json());
    } catch (e) { console.error('Streak error:', e); }

    // 2. Очистка — каждый запуск
    try {
      const r3 = await fetch(`${baseUrl}/api/cleanup-empty-pairs`, { method: 'POST', headers });
      console.log('Cleanup:', await r3.json());
    } catch (e) { console.error('Cleanup error:', e); }

    // 3. Напоминания — ТОЛЬКО в 18:00 UTC (21:00 МСК)
    if (hour === 18) {
      try {
        const r2 = await fetch(`${baseUrl}/api/send-reminders`, { method: 'POST', headers });
        console.log('Reminders:', await r2.json());
      } catch (e) { console.error('Reminder error:', e); }
    }

    // 4. Ежедневная сводка админу — в 9:00 UTC (12:00 МСК)
    if (hour === 9) {
      try {
        const r4 = await fetch(`${baseUrl}/api/admin-daily-summary`, { method: 'POST', headers });
        console.log('Daily summary:', await r4.json());
      } catch (e) { console.error('Summary error:', e); }
    }
  },

  async fetch(request, env) {
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
