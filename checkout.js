(() => {
  'use strict';
  const CART_KEY = 'ycz110_cart_v1';

  /* CONFIGURACIÓN OBLIGATORIA ANTES DE PUBLICAR */
  const WHATSAPP_COMMERCE_NUMBER = '57XXXXXXXXXX'; // Reemplazar por el número real, con indicativo, solo dígitos.
  const EMAILJS_PUBLIC_KEY = 'PPpAhPQgC2dp_QB_T';
  const EMAILJS_SERVICE_ID = 'service_yna4twf';
  const EMAILJS_TEMPLATE_ID = 'template_bh684oa';

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  let products = Array.isArray(window.PRODUCTOS) ? window.PRODUCTOS : [];
  const formatCOP = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const departmentCities = {
    'Antioquia': ['Medellín', 'Bello', 'Itagüí', 'Envigado', 'Rionegro', 'Apartadó', 'Sabaneta', 'La Estrella', 'Copacabana', 'Caldas', 'Guarne'],
    'Cundinamarca': ['Soacha', 'Chía', 'Zipaquirá', 'Facatativá', 'Fusagasugá', 'Girardot', 'Madrid', 'Mosquera', 'Funza', 'Cajicá'],
    'Valle del Cauca': ['Cali', 'Palmira', 'Buenaventura', 'Tuluá', 'Buga', 'Jamundí', 'Yumbo', 'Cartago', 'Candelaria'],
    'Atlántico': ['Barranquilla', 'Soledad', 'Malambo', 'Puerto Colombia', 'Sabanalarga'],
    'Bogotá D.C.': ['Bogotá'],
    'Bolívar': ['Cartagena', 'Turbaco', 'Magangué', 'Arjona'],
    'Boyacá': ['Tunja', 'Duitama', 'Sogamoso', 'Chiquinquirá'],
    'Caldas': ['Manizales', 'La Dorada', 'Chinchiná', 'Villamaría'],
    'Nariño': ['Pasto', 'Ipiales', 'Tumaco', 'Túquerres'],
    'Risaralda': ['Pereira', 'Dosquebradas', 'Santa Rosa de Cabal'],
    'Santander': ['Bucaramanga', 'Floridablanca', 'Girón', 'Piedecuesta', 'Barrancabermeja'],
    'Tolima': ['Ibagué', 'Espinal', 'Melgar', 'Honda']
  };
  const deliveryOptions = {
    metropolitana: { label: 'Domicilio área metropolitana', fee: 15000 },
    nacional: { label: 'Envío nacional', fee: 25000 },
    recoger: { label: 'Recoger en tienda', fee: 0 }
  };

  const form = $('#checkout-form');
  if (!form) return;
  const emptyState = $('#empty-state');
  const orderConfirmation = $('#order-confirmation');
  const orderItems = $('#order-items');
  const departmentSelect = $('#department');
  const citySelect = $('#city');
  const confirmButton = $('#confirm-order');
  const emailStatus = $('#email-status');
  const checkoutError = $('#checkout-error');
  const whatsappFallbackLink = $('#whatsapp-fallback-link');
  const whatsappFallbackNote = $('#whatsapp-fallback-note');
  let currentCart = [];
  let orderIsBeingCreated = false;
  let activeOrder = null;
  let activeWhatsAppURL = '';

  function readCart() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.map(line => {
        const product = products.find(item => item.id === line.id);
        if (!product) return null;
        if (product.tipoVenta !== 'bajo-pedido' && Number(product.stock) <= 0) return null;
        const max = product.tipoVenta === 'bajo-pedido' ? 99 : product.stock;
        return { id: product.id, cantidad: Math.max(1, Math.min(max, Math.floor(Number(line.cantidad) || 1))) };
      }).filter(Boolean);
    } catch (error) {
      console.warn('No fue posible leer el carrito.', error);
      return [];
    }
  }
  function saveCart(cart) {
    currentCart = cart;
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
      window.dispatchEvent(new CustomEvent('ycz:cart-updated'));
    } catch (error) {
      console.warn('No fue posible guardar el carrito.', error);
    }
  }
  function findProduct(id) { return products.find(item => item.id === id); }
  function getCartLines() {
    return currentCart.map(line => {
      const product = findProduct(line.id);
      return product ? { ...line, product, subtotal: product.precio * line.cantidad } : null;
    }).filter(Boolean);
  }
  function getSubtotal() { return getCartLines().reduce((sum, line) => sum + line.subtotal, 0); }
  function getShipping() {
    const selected = $('input[name="deliveryMethod"]:checked', form);
    const option = selected ? deliveryOptions[selected.value] : null;
    return option ? option.fee : 0;
  }
  function getSelectedDelivery() {
    const selected = $('input[name="deliveryMethod"]:checked', form);
    return selected ? deliveryOptions[selected.value] : null;
  }
  function populateDepartments() {
    const departments = Object.keys(departmentCities).sort((a, b) => a.localeCompare(b, 'es'));
    departmentSelect.innerHTML = '<option value="">Selecciona tu departamento</option>' + departments.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join('');
  }
  function populateCities(department) {
    const cities = departmentCities[department] || [];
    citySelect.innerHTML = cities.length
      ? '<option value="">Selecciona tu ciudad o municipio</option>' + cities.map(city => `<option value="${escapeHTML(city)}">${escapeHTML(city)}</option>`).join('')
      : '<option value="">Primero selecciona el departamento</option>';
    citySelect.disabled = cities.length === 0;
    citySelect.value = '';
    clearError(citySelect);
  }
  function renderCartCount() {
    const count = currentCart.reduce((sum, line) => sum + line.cantidad, 0);
    $$('[data-cart-count]').forEach(node => { node.textContent = count > 99 ? '99+' : String(count); });
  }
  function renderSummary() {
    const lines = getCartLines();
    orderItems.innerHTML = lines.map(line => `<article class="order-item"><div class="order-item__image"><img src="${escapeHTML(line.product.imagen)}" alt="Ilustración de ${escapeHTML(line.product.nombre)}" width="640" height="420"></div><div class="order-item__details"><span class="order-item__name">${escapeHTML(line.product.nombre)}</span><span class="order-item__unit">${formatCOP(line.product.precio)} por unidad</span><span class="order-item__commercial ${line.product.tipoVenta === 'bajo-pedido' ? 'order-item__commercial--order' : ''}">${line.product.tipoVenta === 'bajo-pedido' ? 'Bajo pedido · sujeto a disponibilidad' : `Disponible · ${line.product.stock} en inventario`}</span><div class="order-item__bottom"><div class="item-controls"><div class="item-quantity" aria-label="Cantidad de ${escapeHTML(line.product.nombre)}"><button type="button" data-cart-action="minus" data-id="${escapeHTML(line.id)}" aria-label="Restar una unidad">−</button><span>${line.cantidad}</span><button type="button" data-cart-action="plus" data-id="${escapeHTML(line.id)}" aria-label="Añadir una unidad" ${line.product.tipoVenta !== 'bajo-pedido' && line.cantidad >= line.product.stock ? 'disabled' : ''}>+</button></div><button class="item-remove" type="button" data-cart-action="remove" data-id="${escapeHTML(line.id)}" aria-label="Eliminar ${escapeHTML(line.product.nombre)}">×</button></div><strong class="order-item__subtotal">${formatCOP(line.subtotal)}</strong></div></div></article>`).join('');
    const count = lines.reduce((sum, line) => sum + line.cantidad, 0);
    $('#summary-item-count').textContent = `${count} ${count === 1 ? 'ítem' : 'ítems'}`;
    $('#subtotal-value').textContent = formatCOP(getSubtotal());
    $('#shipping-value').textContent = formatCOP(getShipping());
    $('#total-value').textContent = formatCOP(getSubtotal() + getShipping());
  }
  function renderState() {
    renderCartCount();
    const isEmpty = currentCart.length === 0;
    if (isEmpty) {
      emptyState.hidden = true;
      form.hidden = true;
      if (!orderConfirmation.hidden) return;
      emptyState.hidden = false;
      return;
    }
    orderConfirmation.hidden = true;
    emptyState.hidden = true;
    form.hidden = false;
    renderSummary();
  }
  function clearError(field) {
    if (!field) return;
    field.removeAttribute('aria-invalid');
    const errorNode = $(`#error-${field.id}`);
    if (errorNode) errorNode.textContent = '';
  }
  function setError(field, message) {
    field.setAttribute('aria-invalid', 'true');
    const errorNode = $(`#error-${field.id}`);
    if (errorNode) errorNode.textContent = message;
  }
  function validateField(field) {
    clearError(field);
    const value = field.value.trim();
    const namePattern = /^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u;
    if (field.id === 'first-name' || field.id === 'last-name') {
      if (!value) setError(field, 'Este campo es obligatorio.');
      else if (!namePattern.test(value)) setError(field, 'Usa solo letras, espacios, apóstrofes o guiones; no uses números.');
      else if (value.replace(/[ '\u2019-]/g, '').length < 2) setError(field, 'Escribe al menos dos letras.');
    } else if (field.id === 'department') {
      if (!value || !departmentCities[value]) setError(field, 'Selecciona un departamento de la lista.');
    } else if (field.id === 'city') {
      if (!value || !(departmentCities[departmentSelect.value] || []).includes(value)) setError(field, 'Selecciona una ciudad válida para el departamento.');
    } else if (field.id === 'address') {
      if (!value) setError(field, 'La dirección es obligatoria.');
      else if (value.length < 5) setError(field, 'Escribe una dirección más completa.');
      else if (/[<>]/.test(value)) setError(field, 'Revisa los caracteres de la dirección.');
    } else if (field.id === 'phone') {
      if (!value) setError(field, 'El teléfono es obligatorio.');
      else if (!/^\d{7,15}$/.test(value)) setError(field, 'Ingresa entre 7 y 15 dígitos, sin espacios ni símbolos.');
    } else if (field.id === 'email') {
      if (!value) setError(field, 'El correo electrónico es obligatorio.');
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) setError(field, 'Escribe un correo electrónico válido.');
    }
    return field.getAttribute('aria-invalid') !== 'true';
  }
  function validateForm() {
    const fields = ['#first-name', '#last-name', '#department', '#city', '#address', '#phone', '#email'].map(selector => $(selector));
    let isValid = true;
    fields.forEach(field => { if (!validateField(field)) isValid = false; });
    if (!getSelectedDelivery()) {
      isValid = false;
      const firstOption = $('input[name="deliveryMethod"]', form);
      firstOption?.focus();
    }
    const invalidField = fields.find(field => field.getAttribute('aria-invalid') === 'true');
    if (invalidField) {
      invalidField.focus({ preventScroll: true });
      invalidField.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return isValid;
  }
  function collectCustomer() {
    return {
      nombre: $('#first-name').value.trim(),
      apellidos: $('#last-name').value.trim(),
      departamento: departmentSelect.value,
      ciudad: citySelect.value,
      direccion: $('#address').value.trim(),
      detallesDireccion: $('#address-details').value.trim(),
      telefono: $('#phone').value.trim(),
      correo: $('#email').value.trim(),
      notas: $('#order-notes').value.trim()
    };
  }
  function buildOrderPayload() {
    return {
      customer: collectCustomer(),
      items: currentCart.map(line => ({ id: line.id, quantity: line.cantidad })),
      deliveryMethod: $('input[name="deliveryMethod"]:checked').value,
      orderNotes: $('#order-notes').value.trim()
    };
  }

  function buildOrderFromDatabase(savedOrder, customer, deliveryMethod) {
    const delivery = deliveryOptions[deliveryMethod];
    const productos = (savedOrder.items || []).map(item => ({
      id: item.id,
      nombre: item.name,
      referencia: item.reference,
      tipoVenta: item.sale_type,
      disponibilidad: item.sale_type === 'bajo-pedido' ? 'Pendiente de confirmar' : 'Reservado en inventario',
      precioUnitario: Number(item.unit_price),
      cantidad: Number(item.quantity),
      subtotal: Number(item.line_total)
    }));
    return {
      id: savedOrder.id,
      numeroOrden: savedOrder.order_number,
      estado: savedOrder.status,
      requiereConfirmacionDisponibilidad: Boolean(savedOrder.requires_availability),
      fechaCreacion: savedOrder.created_at,
      cliente: customer,
      entrega: { metodo: deliveryMethod, nombre: savedOrder.delivery_method || delivery.label, costo: Number(savedOrder.shipping_cost) },
      metodoPago: 'Transferencia bancaria directa',
      productos,
      subtotal: Number(savedOrder.subtotal),
      costoEnvio: Number(savedOrder.shipping_cost),
      total: Number(savedOrder.total)
    };
  }
  function isWhatsAppConfigured() {
    return /^\d{10,15}$/.test(WHATSAPP_COMMERCE_NUMBER) && !/^573000000000$/.test(WHATSAPP_COMMERCE_NUMBER);
  }
  function buildWhatsAppURL(order) {
    const items = order.productos.map(item => `${item.nombre} x${item.cantidad} (${formatCOP(item.subtotal)})`).join('; ');
    const hasOnDemand = order.requiereConfirmacionDisponibilidad;
    const intro = hasOnDemand ? `Hola, mi orden es ${order.numeroOrden}. Tengo productos bajo pedido y necesito confirmar disponibilidad y total antes de pagar.` : `Hola, mi orden es ${order.numeroOrden}. Voy a pagar ${formatCOP(order.total)} por transferencia.`;
    const mensaje = `${intro} Datos: ${order.cliente.nombre} ${order.cliente.apellidos}, ${order.cliente.ciudad}, ${order.entrega.nombre}. Pedido: ${items}. Total calculado: ${formatCOP(order.total)}.`;
    return `https://wa.me/${WHATSAPP_COMMERCE_NUMBER}?text=${encodeURIComponent(mensaje)}`;
  }
  function buildEmailParams(order) {
    return {
      to_email: order.cliente.correo,
      customer_name: `${order.cliente.nombre} ${order.cliente.apellidos}`,
      order_number: order.numeroOrden,
      order_status: order.estado,
      customer_email: order.cliente.correo,
      customer_phone: order.cliente.telefono,
      customer_department: order.cliente.departamento,
      customer_city: order.cliente.ciudad,
      shipping_address: `${order.cliente.direccion}${order.cliente.detallesDireccion ? ', ' + order.cliente.detallesDireccion : ''}`,
      delivery_method: order.entrega.nombre,
      shipping_cost: formatCOP(order.costoEnvio),
      subtotal: formatCOP(order.subtotal),
      total: formatCOP(order.total),
      payment_method: order.metodoPago,
      order_items: order.productos.map(item => `${item.nombre} — ${item.cantidad} × ${formatCOP(item.precioUnitario)} = ${formatCOP(item.subtotal)}${item.tipoVenta === 'bajo-pedido' ? ' [BAJO PEDIDO: confirmar disponibilidad]' : ''}`).join('\n'),
      availability_notice: order.requiereConfirmacionDisponibilidad ? 'Este pedido contiene productos bajo pedido. Confirmar disponibilidad y valor final con el cliente antes de solicitar el pago.' : 'Todos los productos figuran disponibles en el inventario de demostración.',
      order_notes: order.cliente.notas || 'Sin notas'
    };
  }
  async function sendConfirmationEmail(order) {
    const isConfigured = EMAILJS_PUBLIC_KEY && EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID && ![EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID].some(value => value.startsWith('TU_'));
    if (!isConfigured) throw new Error('EmailJS está integrado, pero falta configurar la Public Key, Service ID y Template ID en checkout.js.');
    if (!window.emailjs) throw new Error('No se pudo cargar EmailJS. Revisa la conexión a internet o inténtalo más tarde.');
    window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    return window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, buildEmailParams(order));
  }
  function showOrderConfirmation(order, popupOpened) {
    form.hidden = true;
    emptyState.hidden = true;
    orderConfirmation.hidden = false;
    $('#confirmation-order-number').textContent = order.numeroOrden;
    const statusNode = $('#confirmation-status');
    if (statusNode) statusNode.textContent = order.estado;
    const detailNode = $('#confirmation-detail');
    if (detailNode) detailNode.textContent = order.requiereConfirmacionDisponibilidad ? 'Tu solicitud incluye productos bajo pedido. La tienda confirmará disponibilidad y el valor final antes de indicarte cómo realizar el pago.' : 'Tu pedido fue registrado. Revisa los datos de transferencia con la tienda antes de pagar.';
    whatsappFallbackLink.href = activeWhatsAppURL;
    if (popupOpened) {
      whatsappFallbackLink.hidden = true;
      whatsappFallbackNote.hidden = true;
    } else {
      whatsappFallbackLink.hidden = false;
      whatsappFallbackNote.hidden = false;
    }
    orderConfirmation.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showStockErrorModal(products = []) {
  const modal = document.getElementById('stock-error-modal');
  const productsContainer = document.getElementById('stock-modal-products');
  const closeButton = document.getElementById('stock-modal-close');

  if (!modal || !productsContainer || !closeButton) {
    alert('Uno o más productos ya no tienen existencias suficientes.');
    return;
  }

  productsContainer.innerHTML = '';

  products.forEach(product => {
    const item = document.createElement('div');
    item.className = 'stock-modal__product';

    const name = document.createElement('strong');
    name.textContent = product.name || product.nombre || 'Producto';

    const available = document.createElement('p');
    available.textContent =
      `Unidades disponibles: ${product.available ?? product.disponible ?? 0}`;

    item.append(name, available);
    productsContainer.appendChild(item);
  });

  modal.classList.add('is-visible');
  modal.setAttribute('aria-hidden', 'false');

  closeButton.onclick = () => {
    modal.classList.remove('is-visible');
    modal.setAttribute('aria-hidden', 'true');
  };
}

  function clearCartAfterWhatsAppOpen() {
    try { localStorage.removeItem(CART_KEY); } catch (error) { console.warn('No fue posible limpiar el carrito guardado.', error); }
    currentCart = [];
    window.dispatchEvent(new CustomEvent('ycz:cart-updated'));
    renderCartCount();
  }

  // Fallback de WhatsApp: si el navegador bloquea window.open, el cliente abre el enlace con un clic.
  whatsappFallbackLink.addEventListener('click', () => {
    window.setTimeout(() => {
      clearCartAfterWhatsAppOpen();
      whatsappFallbackNote.hidden = true;
      whatsappFallbackLink.textContent = 'Enlace de WhatsApp abierto';
    }, 0);
  });

  orderItems.addEventListener('click', event => {
    const button = event.target.closest('[data-cart-action]');
    if (!button) return;
    const { id, cartAction } = button.dataset;
    const product = findProduct(id);
    const line = currentCart.find(item => item.id === id);
    if (!product || !line) return;
    if (cartAction === 'remove') currentCart = currentCart.filter(item => item.id !== id);
    else if (cartAction === 'plus') {
      const max = product.tipoVenta === 'bajo-pedido' ? 99 : product.stock;
      if (line.cantidad >= max) return;
      line.cantidad = Math.min(max, line.cantidad + 1);
    }
    else if (cartAction === 'minus') {
      if (line.cantidad <= 1) currentCart = currentCart.filter(item => item.id !== id);
      else line.cantidad -= 1;
    }
    saveCart(currentCart);
    renderState();
  });
  form.addEventListener('change', event => {
    if (event.target.name === 'deliveryMethod') renderSummary();
  });
  form.addEventListener('input', event => {
    if (event.target.id === 'phone') {
      const digitsOnly = event.target.value.replace(/\D/g, '').slice(0, 15);
      if (event.target.value !== digitsOnly) event.target.value = digitsOnly;
    }
    if (event.target.id === 'order-notes') $('#notes-count').textContent = `${event.target.value.length} / 500`;
    if (event.target.matches('input, select') && event.target.hasAttribute('aria-invalid')) validateField(event.target);
  });
  ['first-name', 'last-name', 'department', 'city', 'address', 'phone', 'email'].forEach(id => {
    const field = $(`#${id}`);
    field.addEventListener('blur', () => { if (field.value.trim() || field.hasAttribute('aria-invalid')) validateField(field); });
  });
  departmentSelect.addEventListener('change', () => {
    populateCities(departmentSelect.value);
    validateField(departmentSelect);
  });
  citySelect.addEventListener('change', () => validateField(citySelect));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (orderIsBeingCreated) return;
    if (!currentCart.length) { renderState(); return; }
    if (!validateForm()) return;

    if (!window.YCZ_DB?.isConfigured) {
      if (checkoutError) {
        checkoutError.hidden = false;
        checkoutError.textContent = 'La base de datos todavía no está configurada. Sigue los pasos de README.md antes de registrar pedidos reales.';
      }
      return;
    }

    orderIsBeingCreated = true;
    confirmButton.disabled = true;
    confirmButton.textContent = 'Registrando pedido…';
    if (checkoutError) checkoutError.hidden = true;

    const customer = collectCustomer();
    const deliveryMethod = $('input[name="deliveryMethod"]:checked').value;
    const payload = buildOrderPayload();
    let whatsappTab = null;

    // Abrir una pestaña vacía durante el gesto del usuario evita el bloqueo del navegador.
    if (isWhatsAppConfigured()) {
      try {
        whatsappTab = window.open('about:blank', '_blank');
        if (whatsappTab) whatsappTab.opener = null;
      } catch (error) {
        console.warn('El navegador no permitió preparar WhatsApp.', error);
      }
    }

    try {
      // La función de Netlify valida el inventario y crea la orden en una sola transacción.
      const savedOrder = await window.YCZ_DB.createOrder(payload);
      const order = buildOrderFromDatabase(savedOrder, customer, deliveryMethod);
      activeOrder = order;
      activeWhatsAppURL = isWhatsAppConfigured() ? buildWhatsAppURL(order) : '';

      let whatsappOpened = false;
      if (activeWhatsAppURL && whatsappTab) {
        try {
          whatsappTab.location.href = activeWhatsAppURL;
          whatsappOpened = true;
        } catch (error) {
          console.warn('No fue posible redirigir la pestaña a WhatsApp.', error);
          try { whatsappTab.close(); } catch { /* noop */ }
          whatsappTab = null;
        }
      } else if (whatsappTab) {
        try { whatsappTab.close(); } catch { /* noop */ }
        whatsappTab = null;
      }

      showOrderConfirmation(order, whatsappOpened);
      const localNote = $('.order-local-note');
      if (localNote) localNote.textContent = 'Tu orden ya quedó registrada en la base de datos de YCZ 110 Colombia.';

      if (!isWhatsAppConfigured()) {
        whatsappFallbackLink.hidden = true;
        whatsappFallbackNote.hidden = false;
        whatsappFallbackNote.textContent = 'WhatsApp aún no está configurado. Reemplaza WHATSAPP_COMMERCE_NUMBER en checkout.js para habilitar el envío. Tu orden ya quedó guardada en la base de datos.';
      } else if (whatsappOpened) {
        clearCartAfterWhatsAppOpen();
      }

      // El correo se envía después de guardar la orden: un fallo de EmailJS no pierde la venta.
      sendConfirmationEmail(order).then(() => {
        emailStatus.textContent = `Correo de confirmación enviado a ${order.cliente.correo}.`;
        emailStatus.classList.remove('is-error');
        emailStatus.classList.add('is-success');
      }).catch(error => {
        console.warn('La orden se guardó, pero EmailJS no pudo enviar el correo.', error);
        emailStatus.textContent = `La orden quedó guardada, pero no se pudo enviar el correo. ${error?.message || 'Revisa la configuración de EmailJS.'}`;
        emailStatus.classList.remove('is-success');
        emailStatus.classList.add('is-error');
      });
    } catch (error) {
      if (whatsappTab) {
        try { whatsappTab.close(); } catch { /* noop */ }
      }
      console.error('No se pudo crear la orden:', error);
      if (error?.code === 'OUT_OF_STOCK' && window.YCZ_DB?.isConfigured) {
        try {
          const refreshedProducts = await window.YCZ_DB.loadProducts();
          if (Array.isArray(refreshedProducts)) products = refreshedProducts;
          currentCart = readCart();
          saveCart(currentCart);
          renderState();
        } catch (refreshError) {
          console.warn('No se pudo actualizar el inventario después del rechazo.', refreshError);
        }
      }
      if (checkoutError) {
        checkoutError.hidden = false;
        checkoutError.textContent = error?.message || 'No fue posible registrar el pedido. Tu carrito se conserva; inténtalo nuevamente.';
      }
      confirmButton.disabled = false;
      confirmButton.textContent = 'Confirmar pedido →';
      orderIsBeingCreated = false;
      checkoutError?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  window.addEventListener('storage', event => {
    if (event.key === CART_KEY || event.key === null) {
      currentCart = readCart();
      renderState();
    }
  });
  window.addEventListener('ycz:cart-updated', renderCartCount);
  $('#current-year').textContent = String(new Date().getFullYear());
  async function initializeCheckout() {
    populateDepartments();
    if (window.YCZ_DB?.isConfigured) {
      try {
        const databaseProducts = await window.YCZ_DB.loadProducts();
        if (Array.isArray(databaseProducts)) products = databaseProducts;
      } catch (error) {
        console.error(error);
        if (checkoutError) {
          checkoutError.hidden = false;
          checkoutError.textContent = 'No se pudo conectar con el inventario. Recarga la página; si el problema continúa, revisa Supabase y la configuración del proyecto.';
        }
      }
    } else if (checkoutError) {
      checkoutError.hidden = false;
      checkoutError.textContent = 'Modo de demostración: configura Supabase y la función de Netlify siguiendo README.md para guardar pedidos e inventario reales.';
    }
    currentCart = readCart();
    renderState();
  }

  initializeCheckout();
})();
