export default {
  async scheduled(event, env) {
    const baseUrl = 'https://chumi-app.pages.dev';

    try {
      const streakRes = await fetch(`${baseUrl}/api/update-streaks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      console.log('Streaks updated:', await streakRes.json());
    } catch (e) {
      console.error('Streak update error:', e);
    }

    try {
      const res = await fetch(`${baseUrl}/api/send-reminders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      console.log('Reminders result:', await res.json());
    } catch (e) {
      console.error('Reminder error:', e);
    }
  },

  async fetch(request, env) {
    if (request.method === 'POST') {
      await this.scheduled({}, env);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Chumi Cron Worker', { status: 200 });
  },
};
