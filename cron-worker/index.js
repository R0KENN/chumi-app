export default {
  async scheduled(event, env) {
    const baseUrl = env.BASE_URL || 'https://chumi-app.pages.dev';
    const headers = { 'Content-Type': 'application/json' };
    if (env.CRON_SECRET) headers['Authorization'] = `Bearer ${env.CRON_SECRET}`;

    // Какое именно расписание сработало (см. wrangler.toml).
    // При ручном запуске через fetch() event.cron отсутствует — тогда
    // выполняем только частые задачи (streaks + cleanup).
    const cron = event?.cron || '';

    // Хелпер: дёрнуть эндпоинт и залогировать результат, не роняя остальные.
    const hit = async (label, path) => {
      try {
        const r = await fetch(`${baseUrl}${path}`, { method: 'POST', headers });
        const body = await r.json().catch(() => ({}));
        console.log(`${label}:`, r.status, JSON.stringify(body));
      } catch (e) {
        console.error(`${label} error:`, e);
      }
    };

    // ── Частые задачи: streaks + cleanup (каждые 30 минут) ──
    // Также выполняются при ручном запуске (cron пустой).
    if (cron === '*/30 * * * *' || !cron) {
      await hit('Streaks', '/api/update-streaks');
      await hit('Cleanup', '/api/cleanup-empty-pairs');
    }

    // ── Напоминания: раз в день, 18:00 UTC ──
    if (cron === '0 18 * * *') {
      await hit('Reminders', '/api/send-reminders');
    }

    // ── Админ-сводка: раз в день, 9:00 UTC ──
    if (cron === '0 9 * * *') {
      await hit('Daily summary', '/api/admin-daily-summary');
    }

    // ── Чистка открыток в Storage: раз в день, 4:00 UTC ──
    if (cron === '0 4 * * *') {
      await hit('Postcards cleanup', '/api/cleanup-postcards');
    }
  },

  async fetch(request, env) {
    // Ручной триггер: POST с правильным Bearer-секретом запускает
    // ВСЕ ежедневные задачи разом (удобно для проверки).
    if (request.method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) {
        return new Response('Forbidden', { status: 403 });
      }

      // Позволяем выбрать конкретную задачу через ?cron=... ,
      // иначе (без параметра) запускаем частые задачи как раньше.
      const url = new URL(request.url);
      const cronParam = url.searchParams.get('cron') || '';
      await this.scheduled({ cron: cronParam }, env);

      return new Response(JSON.stringify({ ok: true, ran: cronParam || 'frequent' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Chumi Cron Worker', { status: 200 });
  },
};
