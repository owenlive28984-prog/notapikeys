function normalizeDeepLLanguage(lang) {
  if (!lang) return null;
  const trimmed = String(lang).trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  switch (lower) {
    case 'english':
      return 'EN';
    case 'english (us)':
    case 'en-us':
    case 'american english':
      return 'EN-US';
    case 'english (gb)':
    case 'en-gb':
    case 'british english':
      return 'EN-GB';
    case 'chinese':
    case 'zh':
    case 'zh-cn':
    case 'zh-hans':
    case 'simplified chinese':
      return 'ZH';
    case 'japanese':
    case 'ja':
      return 'JA';
    case 'korean':
    case 'ko':
      return 'KO';
    default:
      if (
        trimmed.length <= 5 &&
        [...trimmed].every((c) => /[a-zA-Z-]/.test(c))
      ) {
        return trimmed.toUpperCase();
      }
      return null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
        },
      });
    }

    if (request.method === 'GET') {
      return new Response(
        JSON.stringify({
          ok: true,
          routes: {
            vision: 'POST /',
            deepl: 'POST /deepl',
          },
          message: 'Vision proxy is deployed. Send POST / with Vision payload. For DeepL proxy, POST to /deepl.',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        }
      );
    }

    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed', method: request.method }),
        {
          status: 405,
          headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        }
      );
    }

    if (path === '/') {
      if (!env.GOOGLE_CLOUD_VISION_API_KEY) {
        return new Response('Missing GOOGLE_CLOUD_VISION_API_KEY secret', { status: 500 });
      }

      const googleUrl = `https://vision.googleapis.com/v1/images:annotate?key=${env.GOOGLE_CLOUD_VISION_API_KEY}`;
      const body = await request.text();

      try {
        const response = await fetch(googleUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body,
        });

        const responseBody = await response.text();
        return new Response(responseBody, {
          status: response.status,
          headers: {
            'content-type': response.headers.get('content-type') || 'application/json',
            'access-control-allow-origin': '*',
          },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message || 'Proxy request failed' }), {
          status: 502,
          headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
          },
        });
      }
    }

    if (path === '/deepl') {
      if (!env.DEEPL_API_KEY) {
        return new Response('Missing DEEPL_API_KEY secret', { status: 500 });
      }

      let payload;
      try {
        payload = await request.json();
      } catch (error) {
        return new Response(
          JSON.stringify({ error: 'Invalid JSON payload', details: error.message || String(error) }),
          {
            status: 400,
            headers: {
              'content-type': 'application/json',
              'access-control-allow-origin': '*',
            },
          }
        );
      }

      const text = payload?.text;
      const targetLangRaw = payload?.target_lang;
      const sourceLangRaw = payload?.source_lang;
      const formality = payload?.formality ?? 'default';

      const targetLang = normalizeDeepLLanguage(targetLangRaw);
      const sourceLang = normalizeDeepLLanguage(sourceLangRaw) ?? undefined;

      if (!text || !targetLang) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: text, target_lang' }),
          {
            status: 400,
            headers: {
              'content-type': 'application/json',
              'access-control-allow-origin': '*',
            },
          }
        );
      }

      const requestBody = {
        text: Array.isArray(text) ? text : [text],
        target_lang: targetLang,
        source_lang: sourceLang,
        formality,
      };

      const isFreeKey = env.DEEPL_API_KEY.endsWith(':fx');
      const deeplUrl = isFreeKey
        ? 'https://api-free.deepl.com/v2/translate'
        : 'https://api.deepl.com/v2/translate';

      try {
        const response = await fetch(deeplUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `DeepL-Auth-Key ${env.DEEPL_API_KEY}`,
          },
          body: JSON.stringify(requestBody),
        });

        const textBody = await response.text();

        if (!response.ok) {
          return new Response(
            JSON.stringify({ error: 'DeepL API request failed', status: response.status, body: textBody }),
            {
              status: response.status,
              headers: {
                'content-type': 'application/json',
                'access-control-allow-origin': '*',
              },
            }
          );
        }

        return new Response(textBody, {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
          },
        });
      } catch (error) {
        return new Response(
          JSON.stringify({ error: error.message || 'DeepL proxy request failed' }),
          {
            status: 502,
            headers: {
              'content-type': 'application/json',
              'access-control-allow-origin': '*',
            },
          }
        );
      }
    }

    return new Response(
      JSON.stringify({ error: 'Not found', path }),
      {
        status: 404,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      }
    );
  },
};
