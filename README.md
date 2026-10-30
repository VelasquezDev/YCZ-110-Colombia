# YCZ 110 Colombia — tienda + base de datos (Supabase y Netlify)

Proyecto Mobile-First para vender repuestos Yamaha YCZ 110. La web se publica en Netlify; **Supabase PostgreSQL** guarda el inventario, los clientes y las órdenes. El navegador lee únicamente el catálogo público. La creación de órdenes pasa por una función de Netlify, que conserva la clave secreta fuera de los archivos públicos.

## 1. Qué incluye esta integración

- **Productos/inventario:** nombre, categoría, precio, referencia, fotografía, estado activo, tipo de venta y existencias.
- **Clientes:** datos de contacto y dirección. Si vuelve a comprar con el mismo correo, se actualiza su registro en lugar de duplicarlo.
- **Órdenes:** número secuencial único generado en la base de datos, estado, entrega, envío, subtotal, total, fecha y una copia de los datos de envío usados en esa compra.
- **Detalle de orden:** copia del nombre, referencia, precio y cantidad de cada repuesto para conservar el historial aunque después edites el catálogo.
- **Stock seguro:** la base bloquea y valida las unidades antes de descontarlas. Si dos personas intentan comprar la última unidad, solo una podrá completar el pedido.
- **Bajo pedido:** no descuenta existencias y genera el estado `Pendiente de confirmar disponibilidad`.
- **Cancelación:** una función devuelve al stock las unidades reservadas de una orden pendiente, sin permitir que la misma orden se devuelva dos veces.

No se incluye un panel de administración hecho a medida: al principio puedes controlar el catálogo y revisar las ventas desde el panel gratuito de Supabase.

## 2. Estructura nueva

```text
ycz110-colombia/
├── index.html
├── carrito.html
├── styles.css
├── productos.js                 # catálogo de respaldo para pruebas
├── app.js                       # catálogo conectado a Supabase
├── checkout.js                  # checkout y EmailJS
├── emailjs-template.html        # plantilla lista para el editor de EmailJS
├── supabase-config.js           # URL y clave pública
├── supabase-client.js           # lectura de productos y API de checkout
├── netlify.toml                 # configuración de Netlify Functions
├── netlify/
│   └── functions/
│       └── create-order.mjs     # endpoint privado para crear órdenes
├── supabase/
│   └── schema.sql               # tablas, permisos, funciones y productos iniciales
└── assets/
```

## 3. Crear la base de datos gratuita

### Paso 1 — Crear una cuenta y proyecto

1. Entra en [supabase.com](https://supabase.com/) y crea una cuenta.
2. Pulsa **New project**.
3. Ponle un nombre, por ejemplo `ycz110-colombia`.
4. Define una contraseña segura para la base de datos y guárdala en un lugar privado.
5. Selecciona una región cercana a tus compradores, si está disponible.
6. Crea el proyecto y espera a que termine de inicializarse.

El plan Free es suficiente para iniciar un pequeño catálogo: actualmente incluye una base de datos de 500 MB y 5 GB de transferencia de salida. Ten presente que los proyectos gratuitos con poca actividad pueden pausarse después de 7 días; puedes reactivarlos desde el panel. Revisa siempre los límites vigentes en [precios de Supabase](https://supabase.com/pricing) y [pausa por inactividad](https://supabase.com/docs/guides/platform/free-project-pausing).

### Paso 2 — Crear tablas y cargar los productos

1. Abre tu proyecto de Supabase.
2. En el menú izquierdo entra en **SQL Editor**.
3. Pulsa **New query**.
4. Abre el archivo `supabase/schema.sql` de este proyecto.
5. Copia todo su contenido, pégalo en el editor SQL y pulsa **Run**.
6. Espera el mensaje de ejecución correcta.

Ese archivo crea las cuatro tablas (`products`, `customers`, `orders`, `order_items`), aplica permisos, configura las funciones para crear/cancelar órdenes y carga 12 productos de demostración. Si vuelves a ejecutar el archivo, los productos de ejemplo existentes no se sobrescriben.

### Paso 3 — Copiar la URL y la clave pública

1. En Supabase abre **Connect** o entra en **Project Settings → API Keys**.
2. Copia el **Project URL**.
3. Copia la **Publishable key**, que normalmente empieza por `sb_publishable_`.
4. Abre el archivo `supabase-config.js` en este proyecto y reemplaza los marcadores:

```js
window.YCZ_SUPABASE_CONFIG = {
  url: 'https://drejpjtetautlzzxluzr.supabase.co',
  publishableKey: 'sb_publishable_REEMPLAZAR_CON_TU_CLAVE'
};
```

Pega tus dos valores reales. La Publishable key está diseñada para estar en una web pública, pero solo es segura porque el SQL limita los permisos del navegador y activa RLS.

**Nunca pegues una Secret key o `service_role` en `supabase-config.js`, `productos.js`, `app.js`, `checkout.js` ni en ningún archivo que se descargue al navegador.** Las claves secretas permiten acceso elevado y omiten RLS. Consulta [API keys de Supabase](https://supabase.com/docs/guides/getting-started/api-keys).

### Paso 4 — Configurar la clave secreta en Netlify

La función `netlify/functions/create-order.mjs` es la única pieza que necesita permisos para escribir órdenes y descontar inventario.

1. En Supabase entra en **Project Settings → API Keys**.
2. Copia la **Secret key**, que normalmente empieza por `sb_secret_`.
3. Entra a tu sitio en Netlify.
4. Abre **Project configuration → Environment variables**.
5. Crea estas dos variables exactamente con estos nombres:

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | El Project URL de Supabase |
| `SUPABASE_SECRET_KEY` | La Secret key de Supabase (`sb_secret_...`) |

6. Guarda los cambios.

La Secret key debe quedarse en Netlify; no la agregues al repositorio. Netlify permite acceder a estas variables desde las Functions mediante `process.env`. Consulta [variables de entorno de Netlify](https://docs.netlify.com/build/functions/environment-variables/).

### Paso 5 — Publicar correctamente en Netlify

Como ahora el proyecto tiene una Netlify Function, no basta con subir únicamente los HTML/CSS/JS como sitio estático. Debes desplegar también la carpeta `netlify/functions`.

La opción sencilla es conectar el proyecto con GitHub:

1. Crea un repositorio en GitHub.
2. Sube **todo el contenido** de la carpeta `ycz110-colombia` a la raíz del repositorio, incluyendo `netlify.toml`, `netlify/` y `supabase/`.
3. En Netlify elige **Add new project → Import an existing project**.
4. Conecta GitHub y selecciona el repositorio.
5. Netlify detectará `netlify.toml`. Deja el directorio de publicación como `.` y no necesitas comando de build para este proyecto.
6. Pulsa **Deploy**.
7. Si agregaste o cambiaste variables de entorno después del primer despliegue, inicia un nuevo deploy para que la Function las reciba.

También puedes desplegar con Netlify CLI usando `netlify deploy --prod` desde la carpeta del proyecto.

### Probar localmente (opcional)

1. Instala Node.js LTS y Netlify CLI: `npm install -g netlify-cli`.
2. Copia `.env.example` como `.env` y coloca tus valores reales en `SUPABASE_URL` y `SUPABASE_SECRET_KEY`.
3. Desde la carpeta del proyecto ejecuta `netlify dev`.
4. Abre la dirección local que muestra la terminal (normalmente `http://localhost:8888`).
5. No subas el archivo `.env` a GitHub; `.gitignore` ya lo excluye.

Documentación: [Netlify Functions](https://docs.netlify.com/build/functions/).

## 4. Cómo administrar tu tienda día a día

En Supabase abre **Table Editor → products**. Esa tabla es tu inventario y catálogo.

| Lo que necesitas hacer | Qué modificar en `products` |
|---|---|
| Cambiar precio | `price` |
| Cambiar precio anterior | `previous_price` |
| Añadir existencias | `stock` |
| Agotar un repuesto | `stock = 0` |
| Marcar como bajo pedido | `sale_type = bajo-pedido` y `stock = NULL` |
| Volver a vender normalmente | `sale_type = stock` y asignar un número a `stock` |
| Ocultar un producto | `is_active = false` |
| Volver a mostrarlo | `is_active = true` |
| Cambiar fotografía | `image` |
| Cambiar nombre/categoría | `name` / `category` |

Después de guardar los cambios, recarga el catálogo web para que consulte los valores nuevos. Los productos con `stock = 0` aparecerán agotados; los de bajo pedido mostrarán el aviso de confirmación.

### Añadir un producto nuevo

1. Copia la fotografía a la carpeta `assets` del proyecto y súbela en el siguiente despliegue.
2. Abre **Table Editor → products → Insert row**.
3. Completa `id` (único, sin espacios), `name`, `category`, `price`, `previous_price`, `sale_type`, `stock`, `reference`, `tag`, `image`, `description`, `specifications` e `is_active`.
4. En `image`, escribe la ruta relativa del recurso, por ejemplo `assets/pastillas-freno.webp`.
5. Para un producto normal usa `sale_type = stock` y `stock = número`.
6. Para bajo pedido usa `sale_type = bajo-pedido` y deja `stock` como `NULL`.
7. Guarda y recarga la tienda.

`specifications` debe ser un arreglo JSON, por ejemplo:

```json
["Aplicación: Yamaha YCZ 110", "Verificar año y referencia"]
```

No borres físicamente productos que ya tengan ventas. Es mejor establecer `is_active = false`: las órdenes antiguas conservarán sus datos.

## 5. Consultar clientes y ventas

- **Clientes:** `Table Editor → customers`. Un correo identifica al cliente; al realizar otra compra con el mismo correo, se actualizan los datos del registro.
- **Órdenes/ventas:** `Table Editor → orders`. Aquí verás número, fecha, estado, cliente, entrega, envío, subtotal y total. La columna `payment_status` empieza en `Pendiente`; cuando confirmes el comprobante de transferencia, puedes cambiarla a `Verificado`. También puedes usar `Rechazado` o `Reembolsado` cuando corresponda.
- **Productos de una orden:** `Table Editor → order_items`. Cada línea guarda una copia del nombre, referencia y precio de venta en el momento de la compra. La orden también conserva una copia de nombre, correo, teléfono y dirección, aunque luego se actualice la ficha del cliente.

Para consultar las ventas cuyo pago ya verificaste, puedes ejecutar esta consulta en SQL Editor:

```sql
select
  date_trunc('month', created_at)::date as mes,
  count(*) as pedidos_pagados,
  sum(total) as total_recaudado
from public.orders
where payment_status = 'Verificado'
group by 1
order by 1 desc;
```

Para ver los productos de una orden, busca su `id` en `orders` y filtra `order_items` por ese `order_id`.

### Estados automáticos

- Pedido solo con productos de inventario: `Esperando pago`.
- Pedido con al menos un producto bajo pedido: `Pendiente de confirmar disponibilidad`.

Las unidades normales se reservan/descuentan cuando se registra la orden. Los productos bajo pedido no afectan el stock.

### Cancelar una orden pendiente y devolver existencias

No cambies manualmente el estado a `Cancelada`, porque eso no devuelve el stock. En **SQL Editor → New query**, ejecuta, reemplazando el número por la orden real:

```sql
select public.cancel_order_and_restore_stock('YCZ-123456');
```

La función solo permite cancelar órdenes pendientes y devuelve al inventario las cantidades reservadas de productos normales. Si ya fue cancelada, no vuelve a sumar las existencias.

## 6. Cómo funciona la compra

1. El catálogo consulta los productos activos de Supabase usando la Publishable key.
2. El carrito permanece en `localStorage` del navegador del cliente; no es un inventario ni una orden confirmada.
3. Al pulsar **Confirmar pedido**, `checkout.js` envía cliente, identificadores de productos, cantidades y método de entrega a `/.netlify/functions/create-order`.
4. Netlify usa `SUPABASE_SECRET_KEY` en el servidor y llama a `create_order` en PostgreSQL.
5. PostgreSQL vuelve a consultar los precios reales y el stock, bloquea las filas, registra cliente/orden/detalle y descuenta inventario en una sola transacción.
6. La base devuelve un número de orden único. Solo entonces se abre WhatsApp y se solicita el envío del correo por EmailJS.
7. Si WhatsApp se abre, el carrito se limpia. Si el navegador bloquea la ventana, se muestra el enlace alternativo y el cliente puede abrirlo manualmente.

Los precios y existencias que aparecen en el navegador no se consideran confiables al registrar la orden: el servidor obtiene los importes desde Supabase. Los costos de entrega se validan también en la función SQL: metropolitana `$15.000`, nacional `$25.000`, recoger `$0`.

## 7. Prueba antes de empezar a vender

1. Comprueba que el catálogo carga desde Supabase.
2. En Table Editor cambia el stock de un producto de prueba a `1` y guarda.
3. Añade esa unidad al carrito y termina un pedido de prueba.
4. Revisa `orders` y `order_items`: debe aparecer la orden.
5. Vuelve a `products`: el stock debe quedar en `0`.
6. Recarga el catálogo: el producto debe aparecer agotado.
7. Intenta comprarlo desde otro navegador o dispositivo: el servidor debe rechazar la orden porque no hay existencias.
8. Prueba un producto bajo pedido: la orden debe quedar `Pendiente de confirmar disponibilidad` y ese producto no debe descontar stock.
9. Prueba la función de cancelación con una orden de prueba pendiente.

## 8. Ajustes que aún debes completar

- En `supabase-config.js`: Project URL y Publishable key.
- En Netlify Environment variables: `SUPABASE_URL` y `SUPABASE_SECRET_KEY`.
- En `checkout.js`: número comercial de WhatsApp y credenciales de EmailJS. Pega el contenido de `emailjs-template.html` en el editor HTML de EmailJS y configura `{{to_email}}` como destinatario.
- En ambos HTML: URL pública real para canonical/Open Graph.
- En `products`: precios, stock, fotografías y referencias reales. Los registros incluidos son demostrativos; confirma compatibilidad por año y versión antes de vender.

## 9. Límites y recomendaciones

- No hay todavía un panel administrativo privado dentro de la tienda; se administra desde Supabase.
- No hay integración con una pasarela de pago: la transferencia se verifica manualmente.
- La tienda no usa autenticación de clientes; los formularios registran las compras y el historial queda privado en las tablas mediante RLS. La función de pedido es pública para poder comprar sin cuenta, por lo que conviene añadir protección antispam/CAPTCHA cuando aumente el tráfico.
- Los cambios de inventario aparecen al volver a cargar el catálogo. No se ha activado actualización en vivo por Realtime para mantener la configuración inicial simple.
- La reserva de existencias se hace al crear la orden, antes del pago. Cancela las órdenes pendientes que no se concreten y usa la función de devolución para restaurar el stock.
- Conserva una copia periódica de tus datos. El plan gratuito tiene límites y no debe ser tu única copia de seguridad.

## Enlaces oficiales

- [Supabase: crear un proyecto](https://supabase.com/dashboard)
- [Supabase: API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase: funciones PostgreSQL/RPC](https://supabase.com/docs/guides/database/functions)
- [Netlify: Functions](https://docs.netlify.com/build/functions/)
- [Netlify: variables de entorno](https://docs.netlify.com/build/functions/environment-variables/)
