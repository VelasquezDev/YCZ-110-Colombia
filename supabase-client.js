/* Cliente público: lectura del catálogo y conexión con la función segura de Netlify. */
(() => {
  'use strict';

  const config = window.YCZ_SUPABASE_CONFIG || {};
  const url = String(config.url || '').trim();
  const publishableKey = String(config.publishableKey || '').trim();
  const hasSupabaseLibrary = Boolean(window.supabase?.createClient);
  const isConfigured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)
    && publishableKey.startsWith('sb_publishable_')
    && !publishableKey.includes('REEMPLAZAR')
    && hasSupabaseLibrary;

  let client = null;
  if (isConfigured) {
    client = window.supabase.createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
  }

  function mapProduct(row) {
    return {
      id: row.id,
      nombre: row.name,
      categoria: row.category,
      precio: Number(row.price),
      precioAnterior: Number(row.previous_price || 0),
      tipoVenta: row.sale_type,
      stock: row.stock === null ? null : Number(row.stock),
      referencia: row.reference,
      etiqueta: row.tag || '',
      imagen: row.image,
      descripcion: row.description || '',
      especificaciones: Array.isArray(row.specifications) ? row.specifications : []
    };
  }

  async function loadProducts() {
    if (!isConfigured || !client) return null;
    const { data, error } = await client
      .from('products')
      .select('id,name,category,price,previous_price,sale_type,stock,reference,tag,image,description,specifications')
      .eq('is_active', true)
      .order('name', { ascending: true });
    if (error) throw new Error(`No se pudo cargar el catálogo de Supabase: ${error.message}`);
    return (data || []).map(mapProduct);
  }

  async function createOrder(payload) {
    if (!isConfigured) throw new Error('Configura primero la URL y la Publishable key de Supabase en supabase-config.js.');
    const response = await fetch('/.netlify/functions/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let result = {};
    try { result = await response.json(); } catch { /* respuesta no JSON */ }
    if (!response.ok) {
      const error = new Error(result.error || 'No se pudo registrar la orden.');
      error.code = result.code || 'ORDER_CREATE_FAILED';
      error.status = response.status;
      throw error;
    }
    return result.order;
  }

  window.YCZ_DB = {
    isConfigured,
    loadProducts,
    createOrder
  };
})();
