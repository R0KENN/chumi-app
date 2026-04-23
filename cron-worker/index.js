export default {
  async scheduled(event, env) {
    const baseUrl = 'https://chumi-app.pages.dev';
    const headers = { 'Content-Type': 'application/json' };

    // FIX #4: добавлен Authorization header
    if (env.CRON_SECRET) {
      headers['Authorization'] = `Bearer ${env.CRON_SECRET}`;
    }

    // 1. Update streaks / kill dead pets
    try {
      const r1 = await fetch(`${baseUrl}/api/update-streaks`, { method: 'POST', headers });
      console.log('Streaks:', await r1.json());
    } catch (e) { console.error('Streak error:', e); }

    // 2. Send reminders to users who haven't opened today
    try {
      const r2 = await fetch(`${baseUrl}/api/send-reminders`, { method: 'POST', headers });
      console.log('Reminders:', await r2.json());
    } catch (e) { console.error('Reminder error:', e); }

    // 3. Cleanup solo pairs older than 5 days
    try {
      const r3 = await fetch(`${baseUrl}/api/cleanup-empty-pairs`, { method: 'POST', headers });
      console.log('Cleanup:', await r3.json());
    } catch (e) { console.error('Cleanup error:', e); }
  },

  async fetch(request, env) {
    if (request.method === 'POST') {
      await this.scheduled({}, env);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('Chumi Cron Worker', { status: 200 });
  },
};
