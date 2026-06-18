export default {
  async scheduled(event, env) {
    const baseUrl = env.BASE_URL || 'https://chumi-app.pages.dev';
    const headers = { 'Content-Type': 'application/json' };
    if (env.CRON_SECRET) headers['Authorization'] = `Bearer ${env.CRON_SECRET}`;

    // Какое именно расписание сработало (см. wrangler.toml).
    // При ручном запуске через fetch() event.cron отсутствует — тогда
    // выполняем только частые задачи (streaks + cleanup).
    const cron = event?.cron || '';

    // ── Частые задачи: streaks + cleanup (каждые 30 минут) ──
    if (cron === '*/30 * * * *' || !cron) {
      try {
        const r1 = await fetch(`${baseUrl}/api/update-streaks`, { method: 'POST', headers });
        console.log('Streaks:', await r1.json());
      } catch (e) { console.error('Streak error:', e); }

      try {
        const r3 = await fetch(`${baseUrl}/api/cleanup-empty-pairs`, { method: 'POST', headers });
        console.log('Cleanup:', await r3.json());
      } catch (e) { console.error('Cleanup error:', e); }
    }

    // ── Напоминания: раз в день, 18:00 UTC ──
    if (cron === '0 18 * * *') {
      try {
        const r2 = await fetch(`${baseUrl}/api/send-reminders`, { method: 'POST', headers });
        console.log('Reminders:', await r2.json());
      } catch (e) { console.error('Reminder error:', e); }
    }

    // ── Админ-сводка: раз в день, 9:00 UTC ──
    if (cron === '0 9 * * *') {
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
          // ── Чистка открыток в Storage: раз в день, 4:00 UTC ──
    if (cron === '0 4 * * *') {
      try {
        const r5 = await fetch(`${baseUrl}/api/cleanup-postcards`, { method: 'POST', headers });
        console.log('Postcards cleanup:', await r5.json());
      } catch (e) { console.error('Postcards cleanup error:', e); }
    }
    }
    return new Response('Chumi Cron Worker', { status: 200 });
  },
};
