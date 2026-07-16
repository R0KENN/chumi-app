async function readResponseBody(response) {
  const contentType =
    response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return response.json().catch(() => ({}));
  }

  return response.text().catch(() => '');
}

async function runTask(
  baseUrl,
  headers,
  label,
  path
) {
  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 25000);

  try {
    const response = await fetch(
      `${baseUrl}${path}`,
      {
        method: 'POST',
        headers,
        signal: controller.signal,
      }
    );

    const body = await readResponseBody(
      response
    );

    if (!response.ok) {
      throw new Error(
        `${label} failed with HTTP ${response.status}: ` +
        JSON.stringify(body)
      );
    }

    console.log(
      `${label} completed:`,
      JSON.stringify(body)
    );

    return {
      label,
      success: true,
      status: response.status,
      body,
    };
  } catch (error) {
    console.error(
      `${label} failed:`,
      error
    );

    return {
      label,
      success: false,
      error:
        error.name === 'AbortError'
          ? 'Request timeout'
          : error.message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runScheduledTasks(
  cron,
  env
) {
  if (!env.BASE_URL) {
    throw new Error(
      'BASE_URL is not configured'
    );
  }

  if (!env.CRON_SECRET) {
    throw new Error(
      'CRON_SECRET is not configured'
    );
  }

  const baseUrl = env.BASE_URL.replace(
    /\/+$/,
    ''
  );

  const headers = {
    'Content-Type': 'application/json',
    Authorization:
      `Bearer ${env.CRON_SECRET}`,
  };

  const tasks = [];

  if (
    cron === '*/30 * * * *' ||
    !cron
  ) {
    tasks.push(
      ['Streaks', '/api/update-streaks'],
      ['Cleanup', '/api/cleanup-empty-pairs']
    );
  }

  if (cron === '0 18 * * *') {
    tasks.push(
      ['Reminders', '/api/send-reminders']
    );
  }

  if (cron === '0 9 * * *') {
    tasks.push(
      [
        'Daily summary',
        '/api/admin-daily-summary',
      ]
    );
  }

  if (cron === '0 4 * * *') {
    tasks.push(
      [
        'Postcard cleanup',
        '/api/cleanup-postcards',
      ]
    );
  }

  if (tasks.length === 0) {
    throw new Error(
      `Unknown cron schedule: ${cron}`
    );
  }

  const results = [];

  for (const [label, path] of tasks) {
    const result = await runTask(
      baseUrl,
      headers,
      label,
      path
    );

    results.push(result);
  }

  const failedTasks = results.filter(
    (result) => !result.success
  );

  if (failedTasks.length > 0) {
    throw new Error(
      `${failedTasks.length} cron task(s) failed: ` +
      failedTasks
        .map((task) => task.label)
        .join(', ')
    );
  }

  return results;
}

export default {
  async scheduled(event, env, context) {
    context.waitUntil(
      runScheduledTasks(
        event?.cron || '',
        env
      )
    );
  },

  async fetch(request, env) {
    const authorization =
      request.headers.get('Authorization') || '';

    if (
      !env.CRON_SECRET ||
      authorization !==
        `Bearer ${env.CRON_SECRET}`
    ) {
      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }

    const url = new URL(request.url);
    const cron = url.searchParams.get('cron') || '';

    try {
      const results = await runScheduledTasks(
        cron,
        env
      );

      return new Response(
        JSON.stringify({
          success: true,
          cron: cron || 'frequent',
          results,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (error) {
      console.error(
        'Manual cron run failed:',
        error
      );

      return new Response(
        JSON.stringify({
          success: false,
          error: error.message,
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }
  },
};
