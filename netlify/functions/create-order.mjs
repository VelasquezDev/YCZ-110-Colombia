/* Endpoint público de checkout. La Secret key solo vive en las variables de Netlify. */
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

export default async function handler(request) {
  if (request.method !== 'POST') {
    return json({ error: 'Método no permitido.' }, 405);
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const secretKey = String(process.env.SUPABASE_SECRET_KEY || '');
  if (!supabaseUrl || !secretKey) {
    console.error('Faltan SUPABASE_URL o SUPABASE_SECRET_KEY en Netlify.');
    return json({ error: 'El servidor no está configurado para registrar pedidos. Contacta a la tienda.' }, 503);
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 20000) return json({ error: 'La solicitud supera el tamaño permitido.' }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'El contenido de la solicitud no es válido.' }, 400);
  }

  if (!body || typeof body !== 'object' || !body.customer || !Array.isArray(body.items)) {
    return json({ error: 'Faltan los datos del cliente o los productos del pedido.' }, 400);
  }
  if (body.items.length < 1 || body.items.length > 30) {
    return json({ error: 'El pedido debe contener entre 1 y 30 productos diferentes.' }, 400);
  }

  const rpcPayload = {
    p_customer: body.customer,
    p_items: body.items,
    p_delivery_method: body.deliveryMethod,
    p_order_notes: String(body.orderNotes || '').slice(0, 500)
  };

  try {
    const supabaseResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/create_order`, {
      method: 'POST',
      headers: {
        apikey: secretKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(rpcPayload)
    });

    const responseText = await supabaseResponse.text();
    let data;
    try { data = responseText ? JSON.parse(responseText) : null; }
    catch { data = { message: responseText }; }

    if (!supabaseResponse.ok) {
      const detail = String(data?.message || data?.error || 'Error al registrar el pedido.');
      console.warn('Supabase rechazó la orden:', detail);
      if (detail.includes('OUT_OF_STOCK|')) {
        const [, productName, stock] = detail.split('|');
        return json({ code: 'OUT_OF_STOCK', error: `No hay unidades suficientes de ${productName}. Disponibles: ${stock}. Actualiza el carrito e inténtalo de nuevo.` }, 409);
      }
      return json({ code: 'DATABASE_ERROR', error: detail.replace(/^.*ERROR:\s*/, '').slice(0, 240) }, 400);
    }

    return json({ order: data });
  } catch (error) {
    console.error('Error de conexión con Supabase:', error);
    return json({ error: 'No fue posible conectar con la base de datos. Tu carrito se conserva; inténtalo nuevamente.' }, 502);
  }
}
