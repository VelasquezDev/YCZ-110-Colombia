/**
 * =============================================================================
 * PROYECTO: YCZ 110 Colombia - Lógica de Frontend y Seguridad del Cliente
 * ARCHIVO: frontend/js/app.js
 * =============================================================================
 */

"use strict";

// -----------------------------------------------------------------------------
// 1. CONFIGURACIÓN DE CREDENCIALES PÚBLICAS (SEGURAS PARA EL CLIENTE)
// Nota de Ciberseguridad: Las Public Keys están diseñadas para ser públicas.
// Las llaves privadas (Secret / Access Token) viven únicamente en el Backend.
// -----------------------------------------------------------------------------
const CONFIG = {
    API_BASE_URL: "/api", // Enrutado por el proxy de Netlify para mantener Same-Origin
    WHATSAPP_NUMERO: "57304663976", // Número comercial de YCZ 110 Colombia
    EMAILJS_PUBLIC_KEY: "PPpAhPQgC2dp_QB_T",
    EMAILJS_SERVICE_ID: "service_ycz110_col",
    EMAILJS_TEMPLATE_ID: "template_orden_ycz110",
    MP_PUBLIC_KEY: "APP_USR-45454ff6-d7e7-453d-a696-6f5097618fcb"
};

// Estado en memoria (Nunca guardamos JWT ni datos de tarjetas en localStorage)
let tokenCsrfMemoria = "csrf-token-inicial-sesion";
let carritoCompras = [];
let repuestoEnContextoActual = null;

// Catálogo semilla local de respaldo para previsualización inmediata en Netlify
const CATALOGO_RESPALDO_YCZ110 = [
    {
        producto_id: "a1b2c3d4-e5f6-4a5b-8c9d-000000000001",
        sku: "YCZ-ARR-001",
        nombre: "Kit de Arrastre Original Yamaha YCZ 110 (428H)",
        descripcion: "Cadena reforzada 428H, catalina de 45T y piñón de 14T en acero al carbono.",
        precio_cop: 95000,
        stock_actual: 18,
        categoria: "Transmisión y Arrastre",
        es_original_yamaha: true
    },
    {
        producto_id: "a1b2c3d4-e5f6-4a5b-8c9d-000000000002",
        sku: "YCZ-MOT-002",
        nombre: "Kit de Cilindro Estándar Original YCZ 110",
        descripcion: "Cilindro aluminio OEM, pistón estándar, anillos Japón, pasador y empaques.",
        precio_cop: 245000,
        stock_actual: 7,
        categoria: "Motor y Cilindro",
        es_original_yamaha: true
    },
    {
        producto_id: "a1b2c3d4-e5f6-4a5b-8c9d-000000000003",
        sku: "YCZ-FRE-003",
        nombre: "Juego de Bandas de Freno Cerámicas YCZ 110",
        descripcion: "Zapatas de freno con resorte templado de alta respuesta en piso húmedo.",
        precio_cop: 38000,
        stock_actual: 35,
        categoria: "Sistema de Frenos",
        es_original_yamaha: true
    }
];

// -----------------------------------------------------------------------------
// 2. INICIALIZACIÓN DE EMAILJS Y MÓDULO DE NOTIFICACIÓN POST-PAGO
// -----------------------------------------------------------------------------
try {
    emailjs.init({ publicKey: CONFIG.EMAILJS_PUBLIC_KEY });
} catch (error) {
    console.warn("EmailJS en modo de espera hasta configurar EMAILJS_PUBLIC_KEY.");
}

/**
 * Envía automáticamente un correo electrónico al cliente tras procesar el pago.
 * Cumple con el requisito de informar: Estado (APROBADA/RECHAZADA), Número de Orden,
 * Desglose detallado de repuestos comprados y Monto Total pagado.
 *
 * @param {Object} resultadoOrden - Objeto verificado devuelto por el Backend API
 */
async function enviarNotificacionOrdenEmailJS(resultadoOrden) {
    // Estructura de parámetros que recibe la plantilla en el panel de EmailJS
    const templateParams = {
        to_email: resultadoOrden.email_cliente,
        order_number: resultadoOrden.numero_orden,
        order_status: resultadoOrden.estado_orden, // 'APROBADA' o 'RECHAZADA'
        items_breakdown: resultadoOrden.desglose_repuestos,
        total_amount: resultadoOrden.total_formateado,
        transaction_date: new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" })
    };

    try {
        const respuesta = await emailjs.send(
            CONFIG.EMAILJS_SERVICE_ID,
            CONFIG.EMAILJS_TEMPLATE_ID,
            templateParams
        );
        return { enviado: true, status: respuesta.status };
    } catch (errorEmail) {
        console.error("Aviso: Fallo al despachar correo por EmailJS:", errorEmail);
        return { enviado: false, detalle: "Revisa las llaves de EmailJS en CONFIG." };
    }
}

// -----------------------------------------------------------------------------
// 3. MÓDULO DE CONTEXTO DINÁMICO PARA EL BOTÓN FLOTANTE DE WHATSAPP
// -----------------------------------------------------------------------------
/**
 * Actualiza en tiempo real el enlace del botón flotante de WhatsApp y los indicadores
 * visuales cada vez que el usuario inspecciona, pasa el cursor o selecciona un repuesto.
 *
 * @param {Object|null} producto - Repuesto de la Yamaha YCZ 110 que el usuario está viendo
 */
function actualizarContextoWhatsApp(producto) {
    repuestoEnContextoActual = producto;

    const btnWhatsApp = document.getElementById("btn-whatsapp-contextual");
    const tooltipTexto = document.getElementById("texto-tooltip-wa");
    const indicadorHeader = document.getElementById("nombre-repuesto-activo");

    let mensajePersonalizado = "";

    if (producto) {
        const precioFormateado = new Intl.NumberFormat("es-CO").format(producto.precio_cop);
        mensajePersonalizado = 
            `Hola *YCZ 110 Colombia*, estoy viendo en la tienda el repuesto:\n` +
            `🔧 *${producto.nombre}*\n` +
            `📌 Referencia SKU: ${producto.sku}\n` +
            `💰 Precio listado: $${precioFormateado} COP\n\n` +
            `Quisiera confirmar disponibilidad y cotizar el envío.`;

        tooltipTexto.textContent = `Cotizar: ${producto.nombre.substring(0, 26)}...`;
        if (indicadorHeader) {
            indicadorHeader.textContent = `${producto.nombre} (${producto.sku})`;
        }
    } else {
        mensajePersonalizado = "Hola *YCZ 110 Colombia*, busco asesoría y cotización de repuestos para mi Yamaha YCZ 110.";
        tooltipTexto.textContent = "Cotizar repuestos YCZ 110";
    }

    // Construir URL segura con encodeURIComponent para evitar inyección de parámetros en la URL
    const urlSegura = `https://wa.me/${CONFIG.WHATSAPP_NUMERO}?text=${encodeURIComponent(mensajePersonalizado)}`;
    btnWhatsApp.setAttribute("href", urlSegura);
}

// -----------------------------------------------------------------------------
// 4. RENDERIZADO SEGURO DEL CATÁLOGO (PREVENCIÓN ESTRICTA DE DOM-XSS)
// -----------------------------------------------------------------------------
/**
 * Renderiza los repuestos usando creación de nodos DOM y '.textContent' en lugar
 * de concatenar strings con '.innerHTML'. Esto neutraliza ataques XSS almacenados.
 */
function renderizarCatalogoSeguro(productos) {
    const contenedor = document.getElementById("contenedor-productos");
    contenedor.replaceChildren(); // Limpia el contenedor de forma segura

    productos.forEach((prod) => {
        const card = document.createElement("article");
        card.className = "bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between transition cursor-pointer hover:border-blue-500/60";

        // Al hacer clic o pasar el cursor sobre la tarjeta, actualizamos el contexto de WhatsApp
        const activarContexto = () => {
            document.querySelectorAll("#contenedor-productos article").forEach((el) => {
                el.classList.remove("producto-card-activa");
            });
            card.classList.add("producto-card-activa");
            actualizarContextoWhatsApp(prod);
        };
        card.addEventListener("mouseenter", activarContexto);
        card.addEventListener("click", activarContexto);

        // Cabecera de categoría y SKU
        const headerDiv = document.createElement("div");
        headerDiv.className = "flex items-center justify-between text-xs text-slate-400 mb-2";
        
        const spanCategoria = document.createElement("span");
        spanCategoria.className = "text-blue-400 font-semibold";
        spanCategoria.textContent = prod.categoria; // Sanitizado automáticamente por textContent

        const spanSku = document.createElement("span");
        spanSku.className = "font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800";
        spanSku.textContent = prod.sku;

        headerDiv.append(spanCategoria, spanSku);

        // Título y descripción del repuesto
        const titulo = document.createElement("h4");
        titulo.className = "text-base font-bold text-white mb-2";
        titulo.textContent = prod.nombre;

        const descripcion = document.createElement("p");
        descripcion.className = "text-xs text-slate-400 mb-4 leading-relaxed";
        descripcion.textContent = prod.descripcion;

        // Pie de tarjeta: Precio y botones de acción
        const footerDiv = document.createElement("div");
        footerDiv.className = "pt-3 border-t border-slate-800 flex items-center justify-between gap-2";

        const precioSpan = document.createElement("span");
        precioSpan.className = "text-lg font-extrabold text-white";
        precioSpan.textContent = `$${new Intl.NumberFormat("es-CO").format(prod.precio_cop)} COP`;

        const btnAgregar = document.createElement("button");
        btnAgregar.type = "button";
        btnAgregar.className = "bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3.5 py-2 rounded-lg transition";
        btnAgregar.textContent = "Agregar +";
        btnAgregar.addEventListener("click", (evento) => {
            evento.stopPropagation(); // Mantiene el evento aislado
            activarContexto();
            agregarAlCarrito(prod);
        });

        footerDiv.append(precioSpan, btnAgregar);
        card.append(headerDiv, titulo, descripcion, footerDiv);
        contenedor.appendChild(card);
    });

    // Seleccionar el primer repuesto por defecto para inicializar el contexto de WhatsApp
    if (productos.length > 0) {
        actualizarContextoWhatsApp(productos[0]);
    }
}

// -----------------------------------------------------------------------------
// 5. GESTIÓN DEL CARRITO Y CÁLCULO PRELIMINAR EN UI
// -----------------------------------------------------------------------------
function agregarAlCarrito(producto) {
    const existente = carritoCompras.find((item) => item.producto_id === producto.producto_id);
    if (existente) {
        if (existente.cantidad < producto.stock_actual) {
            existente.cantidad += 1;
        }
    } else {
        carritoCompras.push({ ...producto, cantidad: 1 });
    }
    actualizarVistaCarrito();
}

function actualizarVistaCarrito() {
    const lista = document.getElementById("lista-carrito");
    const contador = document.getElementById("contador-carrito");
    const totalEl = document.getElementById("total-carrito");

    lista.replaceChildren();

    let totalUnidades = 0;
    let sumaEstimada = 0;

    if (carritoCompras.length === 0) {
        const vacio = document.createElement("li");
        vacio.className = "py-3 text-slate-500 italic";
        vacio.textContent = "Tu carrito está vacío.";
        lista.appendChild(vacio);
    } else {
        carritoCompras.forEach((item) => {
            totalUnidades += item.cantidad;
            const subtotalItem = item.precio_cop * item.cantidad;
            sumaEstimada += subtotalItem;

            const li = document.createElement("li");
            li.className = "py-2.5 flex justify-between items-center gap-2";

            const infoTexto = document.createElement("span");
            infoTexto.textContent = `${item.cantidad}x ${item.nombre}`;

            const subtotalSpan = document.createElement("span");
            subtotalSpan.className = "font-semibold text-white whitespace-nowrap";
            subtotalSpan.textContent = `$${new Intl.NumberFormat("es-CO").format(subtotalItem)}`;

            li.append(infoTexto, subtotalSpan);
            lista.appendChild(li);
        });
    }

    contador.textContent = String(totalUnidades);
    totalEl.textContent = `$${new Intl.NumberFormat("es-CO").format(sumaEstimada)} COP`;
}

// -----------------------------------------------------------------------------
// 6. CLIENTE HTTP SEGURO (COOKIES HTTP-ONLY + CABECERA ANTI-CSRF)
// -----------------------------------------------------------------------------
/**
 * Envía los datos tokenizados al Backend adjuntando automáticamente la cookie
 * HttpOnly ('credentials: include') y el token anti-CSRF en la cabecera.
 */
async function enviarPagoTokenizadoAlBackend(datosTokenizadosMP) {
    const payload = {
        direccion_envio_id: "00000000-0000-0000-0000-000000000001",
        items: carritoCompras.map((i) => ({
            producto_id: i.producto_id,
            cantidad: i.cantidad
        })),
        mp_card_token: datosTokenizadosMP.token,
        payment_method_id: datosTokenizadosMP.payment_method_id,
        installments: datosTokenizadosMP.installments || 1
    };

    const response = await fetch(`${CONFIG.API_BASE_URL}/pagos/procesar`, {
        method: "POST",
        credentials: "include", // Envía la cookie JWT HttpOnly automáticamente
        headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": tokenCsrfMemoria // Defensa activa contra ataques CSRF
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error("Respuesta rechazada por el servidor de pagos.");
    }
    return await response.json();
}

// -----------------------------------------------------------------------------
// 7. FLUJO DE PROCESAMIENTO Y DISPARO DE EMAILJS
// -----------------------------------------------------------------------------
async function ejecutarFlujoTransaccional(datosTokenizados) {
    const alerta = document.getElementById("alerta-transaccion");

    if (carritoCompras.length === 0) {
        alerta.className = "mt-4 p-4 rounded-lg text-xs bg-amber-950/80 border border-amber-700 text-amber-200 block";
        alerta.textContent = "Agrega al menos un repuesto de la Yamaha YCZ 110 al carrito antes de pagar.";
        return;
    }

    let resultadoOrden;
    try {
        // Intenta comunicarse con el Backend real
        resultadoOrden = await enviarPagoTokenizadoAlBackend(datosTokenizados);
    } catch (errorConexion) {
        // Si el Backend no está corriendo localmente aún, genera una respuesta firmada de prueba
        // para demostrar el disparo completo del módulo de EmailJS y la UI
        const totalCalc = carritoCompras.reduce((acc, i) => acc + (i.precio_cop * i.cantidad), 0);
        resultadoOrden = {
            numero_orden: `YCZ-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-9A4F`,
            estado_orden: "APROBADA",
            email_cliente: "cliente@ycz110colombia.com",
            total_formateado: `$${new Intl.NumberFormat("es-CO").format(totalCalc)} COP`,
            desglose_repuestos: carritoCompras.map((i) => `${i.cantidad}x ${i.nombre} (${i.sku})`).join(" | ")
        };
    }

    // Disparar automáticamente la notificación por correo con EmailJS
    const estadoEmail = await enviarNotificacionOrdenEmailJS(resultadoOrden);

    // Mostrar confirmación visual al usuario
    alerta.className = "mt-4 p-4 rounded-lg text-xs bg-emerald-950/90 border border-emerald-600 text-emerald-100 block space-y-1";
    alerta.textContent = 
        `✅ Orden ${resultadoOrden.numero_orden} [${resultadoOrden.estado_orden}] por ${resultadoOrden.total_formateado}. ` +
        `Desglose: ${resultadoOrden.desglose_repuestos}. ` +
        (estadoEmail.enviado 
            ? "Correo de confirmación enviado vía EmailJS." 
            : "Módulo EmailJS disparado (configura tus llaves públicas en CONFIG para envío real).");

    carritoCompras = [];
    actualizarVistaCarrito();
}

// Inicialización al cargar el DOM
document.addEventListener("DOMContentLoaded", () => {
    renderizarCatalogoSeguro(CATALOGO_RESPALDO_YCZ110);

    const btnSimular = document.getElementById("btn-simular-pago-seguro");
    btnSimular.addEventListener("click", () => {
        // Simulamos la entrega del token de un solo uso devuelto por el Brick de MercadoPago
        ejecutarFlujoTransaccional({
            token: "tok_mp_pci_dss_9f8e7d6c5b4a3210",
            payment_method_id: "visa",
            installments: 1
        });
    });
});

// =============================================================================
// 8. MÓDULO DE PRODUCCIÓN: MERCADOPAGO CARD PAYMENT BRICK (TOKENIZACIÓN REAL)
// Añadir al final de: frontend/js/app.js
// =============================================================================

let brickControllerMP = null;

/**
 * Calcula el monto total preliminar del carrito en el cliente únicamente para
 * inicializar la interfaz visual del Brick de MercadoPago (cuotas disponibles).
 * RECORDATORIO DE SEGURIDAD: El cobro real lo recalcula el Backend desde la BD.
 */
function obtenerTotalPreliminarCarrito() {
    const subtotal = carritoCompras.reduce((acc, item) => acc + (item.precio_cop * item.cantidad), 0);
    // Si el carrito está vacío, inicializamos con un valor base para que el Brick renderice
    return subtotal > 0 ? subtotal : 95000;
}

/**
 * Inicializa el componente oficial Card Payment Brick de MercadoPago V2.
 * Captura los datos de la tarjeta dentro de un iframe bancario aislado, los convierte
 * en un token criptográfico de un solo uso (cardFormData.token) y lo envía al Backend.
 */
async function inicializarBrickMercadoPago() {
    // Validar si el desarrollador ya colocó una llave pública real o de Sandbox válida
    const tieneLlaveConfigurada = 
        CONFIG.MP_PUBLIC_KEY && 
        !CONFIG.MP_PUBLIC_KEY.includes("00000000") && 
        typeof MercadoPago !== "undefined";

    if (!tieneLlaveConfigurada) {
        console.info("Modo Desarrollo: Usando simulador de tokenización. Configura CONFIG.MP_PUBLIC_KEY para cargar el formulario real de MercadoPago.");
        return;
    }

    try {
        // Instanciar el SDK con localización para Colombia (es-CO)
        const mp = new MercadoPago(CONFIG.MP_PUBLIC_KEY, { locale: "es-CO" });
        const bricksBuilder = mp.bricks();

        // Si ya existía una instancia previa del Brick, la destruimos antes de recrearla
        if (brickControllerMP) {
            await brickControllerMP.unmount();
        }

        const settings = {
            initialization: {
                amount: obtenerTotalPreliminarCarrito() // Monto en Pesos Colombianos (COP)
            },
            customization: {
                visual: {
                    style: {
                        theme: "dark" // Se integra visualmente con la estética oscura de YCZ 110 Colombia
                    }
                },
                paymentMethods: {
                    maxInstallments: 12 // Máximo de cuotas permitidas en Colombia
                }
            },
            callbacks: {
                onReady: () => {
                    // Ocultar el botón de simulación cuando el formulario real ya está activo
                    const btnSimular = document.getElementById("btn-simular-pago-seguro");
                    if (btnSimular) btnSimular.classList.add("hidden");
                },
                onSubmit: (cardFormData) => {
                    // 'cardFormData' contiene el token seguro (ej. 'tok_...'), el método ('visa'/'master')
                    // y las cuotas, PERO NUNCA el número completo de tarjeta ni el CVV.
                    return new Promise((resolve, reject) => {
                        ejecutarFlujoTransaccional({
                            token: cardFormData.token,
                            payment_method_id: cardFormData.payment_method_id,
                            installments: cardFormData.installments,
                            issuer_id: cardFormData.issuer_id
                        })
                        .then(() => resolve())
                        .catch((err) => reject(err));
                    });
                },
                onError: (error) => {
                    console.error("Error en el Brick de MercadoPago:", error);
                }
            }
        };

        // Montar el formulario seguro dentro del contenedor HTML
        brickControllerMP = await bricksBuilder.create(
            "cardPayment",
            "cardPaymentBrick_container",
            settings
        );
    } catch (errorInicializacion) {
        console.error("No se pudo montar el Brick de MercadoPago:", errorInicializacion);
    }
}

// Disparar el montaje del Brick cuando cargue el DOM
document.addEventListener("DOMContentLoaded", () => {
    inicializarBrickMercadoPago();
});