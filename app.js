(() => {
  'use strict';
  const CART_KEY = 'ycz110_cart_v1';
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const formatCOP = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  let products = Array.isArray(window.PRODUCTOS) ? window.PRODUCTOS : [];
  let catalogWarning = window.YCZ_DB?.isConfigured ? '' : ' · Catálogo de demostración: configura Supabase para inventario compartido';
  const grid = $('#product-grid');
  if (!grid) return;

  const searchDesktop = $('#search-input');
  const searchMobile = $('#search-input-mobile');
  const filterContainer = $('#category-filters');
  const sortSelect = $('#sort-select');
  const noProducts = $('#no-products');
  const resultsCount = $('#results-count');
  const catalogStatus = $('#catalog-status');
  const cartCountNodes = $$('[data-cart-count]');
  const dialog = $('#product-dialog');
  const dialogContent = $('#dialog-product-content');
  const toast = $('#toast');
  let activeCategory = 'Todos';
  let activeQuery = '';
  let toastTimer = null;
  let activeProduct = null;

  function readCart() {
    try {
      const value = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      if (!Array.isArray(value)) return [];
      return value.map(item => {
        const product = products.find(candidate => candidate.id === item.id);
        if (!product) return null;
        const max = product.tipoVenta === 'bajo-pedido' ? 99 : Math.max(0, Number(product.stock) || 0);
        if (product.tipoVenta !== 'bajo-pedido' && max <= 0) return null;
        const cantidad = Math.max(1, Math.min(max, Math.floor(Number(item.cantidad) || 1)));
        return { id: product.id, cantidad };
      }).filter(Boolean);
    } catch (error) {
      console.warn('No fue posible leer el carrito guardado.', error);
      return [];
    }
  }
  function saveCart(cart) {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
      window.dispatchEvent(new CustomEvent('ycz:cart-updated'));
      updateCartCount();
      return true;
    } catch (error) {
      showToast('No se pudo guardar el carrito en este navegador.');
      return false;
    }
  }
  function updateCartCount() {
    const total = readCart().reduce((sum, item) => sum + item.cantidad, 0);
    cartCountNodes.forEach(node => { node.textContent = total > 99 ? '99+' : String(total); });
  }
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }
  function findProduct(id) { return products.find(product => product.id === id); }

  function addToCart(id, quantity = 1) {
    const product = findProduct(id);
    if (!product) return;
    const cart = readCart();
    const line = cart.find(item => item.id === id);
    const current = line ? line.cantidad : 0;
    const requested = Math.max(1, Math.floor(Number(quantity) || 1));
    if (product.tipoVenta !== 'bajo-pedido' && current >= product.stock) {
      showToast(`Stock disponible: ${product.stock} unidades.`);
      return;
    }
    const max = product.tipoVenta === 'bajo-pedido' ? 99 : product.stock;
    const next = Math.min(max, current + requested);
    if (line) line.cantidad = next;
    else cart.push({ id, cantidad: Math.min(max, requested) });
    if (saveCart(cart)) showToast(`${product.nombre} agregado al carrito.`);
  }

  function productCard(product) {
    const hasDiscount = product.precioAnterior > product.precio;
    const onDemand = product.tipoVenta === 'bajo-pedido';
    const soldOut = !onDemand && Number(product.stock) <= 0;
    const badgeClass = soldOut ? 'product-tag product-tag--red' : onDemand ? 'product-tag product-tag--gold' : (/más vendido|seguridad|esencial/i.test(product.etiqueta || '') ? 'product-tag product-tag--red' : 'product-tag');
    const availability = onDemand ? 'Bajo pedido' : soldOut ? 'Agotado' : `${product.stock} disponibles`;
    const availabilityClass = onDemand ? 'product-card__availability product-card__availability--order' : soldOut ? 'product-card__availability product-card__availability--out' : 'product-card__availability';
    const actionLabel = onDemand ? 'Solicitar' : soldOut ? 'Agotado' : 'Agregar';
    return `<article class="product-card ${soldOut ? 'is-out-of-stock' : ''} ${onDemand ? 'is-on-demand' : ''}">
      <div class="product-card__media"><img src="${escapeHTML(product.imagen)}" alt="Fotografía de ${escapeHTML(product.nombre)}" loading="lazy" width="640" height="420"><span class="${badgeClass}">${escapeHTML(onDemand ? 'BAJO PEDIDO' : soldOut ? 'AGOTADO' : (product.etiqueta || 'Repuesto'))}</span></div>
      <div class="product-card__body"><div class="product-card__meta"><span class="product-card__category">${escapeHTML(product.categoria)}</span><span class="${availabilityClass}">${availability}</span></div>
      <h3 class="product-card__title">${escapeHTML(product.nombre)}</h3><p class="product-card__reference">Ref. ${escapeHTML(product.referencia)}</p>
      <div class="product-card__price-row"><strong class="product-card__price">${formatCOP(product.precio)}</strong>${hasDiscount ? `<span class="product-card__old-price">${formatCOP(product.precioAnterior)}</span>` : ''}</div>
      ${onDemand ? '<p class="product-card__note">Sujeto a confirmación de disponibilidad.</p>' : ''}
      <div class="product-card__actions"><button class="product-card__details" type="button" data-action="details" data-id="${escapeHTML(product.id)}">Ver detalles</button><button class="product-card__add" type="button" data-action="add" data-id="${escapeHTML(product.id)}" aria-label="${actionLabel} ${escapeHTML(product.nombre)}" ${soldOut ? 'disabled' : ''}>${onDemand ? '＋' : soldOut ? '×' : '+'}</button></div></div></article>`;
  }

  function getVisibleProducts() {
    let result = products.filter(product => {
      const matchesCategory = activeCategory === 'Todos' || product.categoria === activeCategory;
      const normalizedQuery = activeQuery.trim().toLocaleLowerCase('es-CO');
      const matchesSearch = !normalizedQuery || product.nombre.toLocaleLowerCase('es-CO').includes(normalizedQuery);
      return matchesCategory && matchesSearch;
    });
    switch (sortSelect?.value) {
      case 'price-asc': result = result.slice().sort((a, b) => a.precio - b.precio); break;
      case 'price-desc': result = result.slice().sort((a, b) => b.precio - a.precio); break;
      case 'name-asc': result = result.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')); break;
      default: break;
    }
    return result;
  }
  function renderProducts() {
    const visible = getVisibleProducts();
    grid.innerHTML = visible.map(productCard).join('');
    grid.hidden = visible.length === 0;
    noProducts.hidden = visible.length !== 0;
    resultsCount.textContent = String(visible.length);
    const filterDescription = activeCategory === 'Todos' ? 'todos los repuestos' : `la categoría ${activeCategory}`;
    catalogStatus.textContent = (activeQuery ? `${visible.length} resultado(s) para “${activeQuery}”` : `Mostrando ${filterDescription}`) + catalogWarning;
    grid.setAttribute('aria-busy', 'false');
  }
  function syncSearch(source, target) {
    const normalizedValue = source.value;
    activeQuery = normalizedValue;
    if (target.value !== normalizedValue) target.value = normalizedValue;
    renderProducts();
  }

  function openDetails(id) {
    const product = findProduct(id);
    if (!product || !dialog || !dialogContent) return;
    activeProduct = product;
    dialogContent.innerHTML = `<div class="dialog-product"><div class="dialog-product__image"><img src="${escapeHTML(product.imagen)}" alt="Ilustración de ${escapeHTML(product.nombre)}" width="640" height="420"></div><div class="dialog-product__copy"><p class="dialog-product__category">${escapeHTML(product.categoria)} · ${escapeHTML(product.etiqueta || 'Repuesto')}</p><h2 id="dialog-title">${escapeHTML(product.nombre)}</h2><p class="dialog-product__ref">Referencia: ${escapeHTML(product.referencia)}</p><p class="dialog-product__price">${formatCOP(product.precio)}</p><p class="dialog-product__desc">${escapeHTML(product.descripcion)}</p><ul class="dialog-specs">${product.especificaciones.map(spec => `<li>${escapeHTML(spec)}</li>`).join('')}</ul><p class="field-hint">${product.tipoVenta === 'bajo-pedido' ? 'Producto bajo pedido: disponibilidad sujeta a confirmación antes del pago.' : 'Antes de comprar, confirma el año y la referencia de tu moto.'}</p><div class="dialog-product__purchase"><div class="quantity-stepper"><button type="button" data-qty="minus" aria-label="Disminuir cantidad">−</button><input type="number" id="dialog-quantity" min="1" max="${product.tipoVenta === 'bajo-pedido' ? 99 : product.stock}" value="1" inputmode="numeric" aria-label="Cantidad"/><button type="button" data-qty="plus" aria-label="Aumentar cantidad">+</button></div><button class="button button--primary" type="button" data-action="dialog-add" data-id="${escapeHTML(product.id)}" ${product.tipoVenta !== 'bajo-pedido' && product.stock <= 0 ? 'disabled' : ''}>${product.tipoVenta === 'bajo-pedido' ? 'Solicitar bajo pedido' : 'Agregar al carrito'} <span aria-hidden="true">→</span></button></div></div></div>`;
    if (!dialog.open) dialog.showModal();
  }

  filterContainer?.addEventListener('click', event => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    activeCategory = button.dataset.category;
    $$('.category-chip', filterContainer).forEach(chip => {
      const isActive = chip === button;
      chip.classList.toggle('is-active', isActive);
      chip.setAttribute('aria-pressed', String(isActive));
    });
    renderProducts();
  });
  searchDesktop?.addEventListener('input', () => syncSearch(searchDesktop, searchMobile));
  searchMobile?.addEventListener('input', () => syncSearch(searchMobile, searchDesktop));
  $('#search-form')?.addEventListener('submit', event => event.preventDefault());
  sortSelect?.addEventListener('change', renderProducts);
  $('#clear-search')?.addEventListener('click', () => {
    activeQuery = '';
    searchDesktop.value = '';
    searchMobile.value = '';
    activeCategory = 'Todos';
    $$('.category-chip', filterContainer).forEach(chip => {
      const isActive = chip.dataset.category === 'Todos';
      chip.classList.toggle('is-active', isActive);
      chip.setAttribute('aria-pressed', String(isActive));
    });
    renderProducts();
    searchDesktop?.focus();
  });
  grid.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    if (button.dataset.action === 'add') addToCart(button.dataset.id, 1);
    if (button.dataset.action === 'details') openDetails(button.dataset.id);
  });
  dialogContent?.addEventListener('click', event => {
    const quantityButton = event.target.closest('[data-qty]');
    if (quantityButton) {
      const input = $('#dialog-quantity', dialogContent);
      if (!input || !activeProduct) return;
      const delta = quantityButton.dataset.qty === 'plus' ? 1 : -1;
      const current = Number(input.value) || 1;
      const max = activeProduct.tipoVenta === 'bajo-pedido' ? 99 : activeProduct.stock;
      input.value = String(Math.min(max, Math.max(1, current + delta)));
      return;
    }
    const addButton = event.target.closest('[data-action="dialog-add"]');
    if (addButton) {
      const quantity = Number($('#dialog-quantity', dialogContent)?.value) || 1;
      addToCart(addButton.dataset.id, quantity);
      dialog.close();
    }
  });
  $('#dialog-close')?.addEventListener('click', () => dialog.close());
  dialog?.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  window.addEventListener('storage', event => { if (event.key === CART_KEY || event.key === null) updateCartCount(); });
  window.addEventListener('ycz:cart-updated', updateCartCount);
  $('#current-year').textContent = String(new Date().getFullYear());

  function refreshCategoryFilters() {
    if (!filterContainer) return;
    const categories = [...new Set(products.map(product => product.categoria).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'es'));
    categories.forEach(category => {
      const exists = $$('[data-category]', filterContainer).some(button => button.dataset.category === category);
      if (exists) return;
      const button = document.createElement('button');
      button.className = 'category-chip';
      button.type = 'button';
      button.dataset.category = category;
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = `${escapeHTML(category)} <span class="category-chip__count" data-category-count="${escapeHTML(category)}">0</span>`;
      filterContainer.append(button);
    });
    $$('[data-category-count]', filterContainer).forEach(node => {
      const category = node.dataset.categoryCount;
      node.textContent = String(category === 'Todos' ? products.length : products.filter(product => product.categoria === category).length);
    });
  }

  async function initializeCatalog() {
    grid.setAttribute('aria-busy', 'true');
    if (window.YCZ_DB?.isConfigured) {
      try {
        const databaseProducts = await window.YCZ_DB.loadProducts();
        if (Array.isArray(databaseProducts)) products = databaseProducts;
        catalogWarning = '';
      } catch (error) {
        console.error(error);
        catalogWarning = ' · No se pudo conectar al inventario: mostrando catálogo de respaldo';
      }
    }
    refreshCategoryFilters();
    renderProducts();
    updateCartCount();
  }

  initializeCatalog();
})();
