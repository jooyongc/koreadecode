export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  // --- Handle legacy /post.html?id=xxx redirect ---
  if (url.pathname === '/post.html') {
    const postId = url.searchParams.get('id');
    if (postId) {
      try {
        const SUPABASE_URL = env.SUPABASE_URL || 'https://agkkvtfwqmzgbrqhvohs.supabase.co';
        const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFna2t2dGZ3cW16Z2JycWh2b2hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2MTU5MDIsImV4cCI6MjA4NjE5MTkwMn0.nZZ8Qrt0dU_v4CSeiVy4DM1IQLAEGBmKldtiotb6Oh8';

        const headers = {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        };

        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}&select=slug&limit=1`,
          { headers }
        );

        if (res.ok) {
          const posts = await res.json();
          if (posts && posts.length > 0 && posts[0].slug) {
            return Response.redirect(`${url.origin}/blog/${posts[0].slug}`, 301);
          }
        }
      } catch (_) {
        // Fall through to next
      }
    }
  }

  // --- Proceed with original request ---
  const response = await next();

  // --- Add security headers ---
  const newHeaders = new Headers(response.headers);
  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('X-Frame-Options', 'SAMEORIGIN');
  newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
