// =============================================================================
// La Fabriquita — Netlify Serverless Function (Proxy)
// Archivo: netlify/functions/api.js
// Requiere Node 18+ (fetch nativo). Configurado en netlify.toml.
// Funcion: recibe peticiones del frontend y las reenvía al GAS Web App,
// eliminando completamente el problema de CORS.
// =============================================================================

const GAS_URL = process.env.GAS_WEBAPP_URL;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async function(event) {
  // Preflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (!GAS_URL) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        error: 'GAS_WEBAPP_URL no configurada. Revisar variables de entorno en Netlify.'
      })
    };
  }

  try {
    let targetUrl = GAS_URL;
    let fetchOptions = { redirect: 'follow' };

    if (event.httpMethod === 'GET') {
      // Pasar parametros de query al GAS
      const params = event.queryStringParameters || {};
      const qs     = new URLSearchParams(params).toString();
      if (qs) targetUrl = GAS_URL + '?' + qs;
      fetchOptions.method = 'GET';

    } else {
      // POST: reenviar el body JSON al GAS
      fetchOptions.method  = 'POST';
      fetchOptions.headers = { 'Content-Type': 'application/json' };
      fetchOptions.body    = event.body || '{}';
    }

    const gasResponse = await fetch(targetUrl, fetchOptions);
    const text        = await gasResponse.text();

    // Validar que la respuesta sea JSON valido antes de enviar
    try {
      JSON.parse(text);
    } catch (_) {
      // GAS a veces devuelve HTML de error en lugar de JSON
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          error: 'El backend devolvio una respuesta no-JSON',
          raw: text.substring(0, 500)
        })
      };
    }

    return {
      statusCode: gasResponse.status >= 400 ? gasResponse.status : 200,
      headers: CORS_HEADERS,
      body: text
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};

