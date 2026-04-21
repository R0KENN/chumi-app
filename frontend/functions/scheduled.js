export async function onScheduled(event, env) {
  const baseUrl = 'https://chumi-app.pages.dev';
  const headers = {
    'Content-Type': 'application/json',
  };

  // If you set CRON_SECRET in env, include it
  if (env.CRON_SECRET) {
    headers['Authorization'] = `Bearer ${env.CRON_SECRET}`;
  }

  // 1. Update streaks (kill dead pets)
  try {
    const streakRes = await fetch(`${baseUrl}/api/update-streaks`, {
      method: 'POST',
      headers,
    });
    console.log('Streaks updated:', await streakRes.json());
  } catch (e) {
    console.error('Streak update error:', e);
  }

  // 2. Send reminders to users who haven't opened the app today
  try {
    const reminderRes = await fetch(`${baseUrl}/api/send-reminders`, {
      method: 'POST',
      headers,
    });
    console.log('Reminders sent:', await reminderRes.json());
  } catch (e) {
    console.error('Reminder send error:', e);
  }
}
