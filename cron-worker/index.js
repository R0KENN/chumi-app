async function runScheduledTasks(
  controller,
  env,
) {
  const baseUrl = (
    env.BASE_URL ||
    'https://chumi.space'
  ).replace(/\/+$/, '');

  const headers = {
    'Content-Type': 'application/json',
  };

  if (env.CRON_SECRET) {
    headers.Authorization =
      `Bearer ${env.CRON_SECRET}`;
  }

  const cron = controller?.cron || '';
  const results = [];

  const hit = async (label, path) => {
    const startedAt = Date.now();

    try {
      const response = await fetch(
        `${baseUrl}${path}`,
        {
          method: 'POST',
          headers,
        },
      );

      let body = null;

      try {
        body = await response.json();
      } catch {
        body = null;
      }

      const result = {
        label,
        path,
        ok: response.ok,
        status: response.status,
        durationMs:
          Date.now() - startedAt,
        body,
      };

      results.push(result);

      if (!response.ok) {
        throw new Error(
          `${label} failed with HTTP ${response.status}: ` +
          JSON.stringify(body),
        );
      }

      console.log(
        `${label}:`,
        JSON.stringify(result),
      );

      return result;
    } catch (error) {
      const existingResult = results.find(
        (item) =>
          item.label === label &&
          item.path === path,
      );

      if (!existingResult) {
        results.push({
          label,
          path,
          ok: false,
          status: 0,
          durationMs:
            Date.now() - startedAt,
          error: String(error),
        });
      }

      console.error(
        `${label} error:`,
        error,
      );

      throw error;
    }
  };

  const tasks = [];

  if (
    cron === '*/30 * * * *' ||
    !cron
  ) {
    tasks.push(
      hit(
        'Streaks',
        '/api/update-streaks',
      ),
      hit(
        'Cleanup',
        '/api/cleanup-empty-pairs',
      ),
    );
  }

  if (cron === '0 18 * * *') {
    tasks.push(
      hit(
        'Reminders',
        '/api/send-reminders',
      ),
    );
  }

  if (cron === '0 9 * * *') {
    tasks.push(
      hit(
        'Daily summary',
        '/api/admin-daily-summary',
      ),
    );
  }

  if (cron === '0 4 * * *') {
    tasks.push(
      hit(
        'Postcards cleanup',
        '/api/cleanup-postcards',
      ),
    );
  }

  if (cron === '5 0 * * 1') {
    tasks.push(
      hit(
        'Weekly game report',
        '/api/admin-weekly-game-report',
      ),
    );
  }

  const settled = await Promise.allSettled(
    tasks,
  );

  const failed = settled.filter(
    (result) =>
      result.status === 'rejected',
  );

  return {
    ok: failed.length === 0,
    cron: cron || 'frequent',
    results,
    failedCount: failed.length,
  };
}

export default {
  async scheduled(controller, env) {
    const result = await runScheduledTasks(
      controller,
      env,
    );

    if (!result.ok) {
      throw new Error(
        `${result.failedCount} scheduled task(s) failed`,
      );
    }
  },

  async fetch(request, env) {
    if (request.method === 'GET') {
      return new Response(
        'Chumi Cron Worker',
        {
          status: 200,
          headers: {
            'Content-Type':
              'text/plain; charset=utf-8',
          },
        },
      );
    }

    if (request.method !== 'POST') {
      return new Response(
        'Method Not Allowed',
        {
          status: 405,
          headers: {
            Allow: 'GET, POST',
          },
        },
      );
    }

    const authorization =
      request.headers.get(
        'Authorization',
      ) || '';

    if (
      !env.CRON_SECRET ||
      authorization !==
        `Bearer ${env.CRON_SECRET}`
    ) {
      return new Response(
        'Forbidden',
        { status: 403 },
      );
    }

    const url = new URL(request.url);
    const cron =
      url.searchParams.get('cron') || '';

    const result = await runScheduledTasks(
      { cron },
      env,
    );

    return new Response(
      JSON.stringify(result),
      {
        status: result.ok ? 200 : 502,
        headers: {
          'Content-Type':
            'application/json; charset=utf-8',
        },
      },
    );
  },
};
