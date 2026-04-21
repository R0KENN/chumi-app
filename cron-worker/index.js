export default {
  async scheduled(event, env) {
    try {
      const res = await fetch('https://chumi-app.pages.dev/api/send-reminders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const data = await res.json();
      console.log('Reminders result:', data);
    } catch (e) {
      console.error('Cron error:', e);
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
