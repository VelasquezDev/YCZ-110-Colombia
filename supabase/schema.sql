-- YCZ 110 Colombia | Esquema inicial Supabase / PostgreSQL
-- Ejecuta TODO este archivo una sola vez en Supabase > SQL Editor > New query.
-- Las órdenes se crean únicamente desde la Netlify Function con la clave secreta.

create extension if not exists pgcrypto;
create sequence if not exists public.order_number_seq start 1;

-- 1) CATÁLOGO E INVENTARIO ----------------------------------------------------
create table if not exists public.products (
  id text primary key,
  name text not null,
  category text not null,
  price integer not null check (price >= 0),
  previous_price integer not null default 0 check (previous_price >= 0),
  sale_type text not null default 'stock' check (sale_type in ('stock', 'bajo-pedido')),
  stock integer,
  reference text not null,
  tag text not null default '',
  image text not null,
  description text not null default '',
  specifications jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_stock_by_sale_type check (
    (sale_type = 'stock' and stock is not null and stock >= 0)
    or (sale_type = 'bajo-pedido' and stock is null)
  )
);

create index if not exists products_active_category_idx
  on public.products (is_active, category);

-- 2) CLIENTES -----------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text not null unique,
  phone text not null,
  department text not null,
  city text not null,
  address text not null,
  address_details text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customers_phone_idx on public.customers (phone);

-- 3) ÓRDENES ------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references public.customers(id),
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  shipping_department text not null,
  shipping_city text not null,
  shipping_address text not null,
  shipping_details text not null default '',
  status text not null check (status in (
    'Esperando pago',
    'Pendiente de confirmar disponibilidad',
    'En preparación',
    'Enviado',
    'Entregado',
    'Cancelada'
  )),
  delivery_method text not null,
  shipping_cost integer not null default 0 check (shipping_cost >= 0),
  subtotal integer not null check (subtotal >= 0),
  total integer not null check (total >= 0),
  payment_method text not null default 'Transferencia bancaria directa',
  payment_status text not null default 'Pendiente' check (payment_status in ('Pendiente', 'Verificado', 'Rechazado', 'Reembolsado')),
  notes text not null default '',
  requires_availability boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_payment_status_idx on public.orders (payment_status);
create index if not exists orders_customer_idx on public.orders (customer_id);

-- 4) DETALLE DE CADA ORDEN ----------------------------------------------------
-- Conservamos nombre, referencia y precio como fotografía histórica del pedido.
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  product_name text not null,
  product_reference text not null,
  sale_type text not null check (sale_type in ('stock', 'bajo-pedido')),
  unit_price integer not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  line_total integer not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_idx on public.order_items (order_id);

-- Mantener updated_at al día cuando se modifica inventario, clientes u órdenes.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

drop trigger if exists customers_touch_updated_at on public.customers;
create trigger customers_touch_updated_at
  before update on public.customers
  for each row execute function public.touch_updated_at();

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function public.touch_updated_at();
revoke all on function public.touch_updated_at() from public, anon, authenticated;
grant execute on function public.touch_updated_at() to service_role;

-- 5) SEGURIDAD: el navegador solo puede leer productos activos ---------------
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Retirar permisos generales y conceder exclusivamente lectura pública del catálogo.
grant usage on schema public to anon, authenticated, service_role;
revoke all on table public.products from anon, authenticated;
revoke all on table public.customers from anon, authenticated;
revoke all on table public.orders from anon, authenticated;
revoke all on table public.order_items from anon, authenticated;

grant select on table public.products to anon, authenticated;
grant all on table public.products to service_role;
grant all on table public.customers to service_role;
grant all on table public.orders to service_role;
grant all on table public.order_items to service_role;

drop policy if exists "Public can read active products" on public.products;
create policy "Public can read active products"
  on public.products for select
  to anon, authenticated
  using (is_active = true);

-- Las tablas de clientes y órdenes no tienen políticas públicas: nadie puede
-- consultarlas desde el navegador. Solo las funciones del servidor acceden a ellas.

-- 6) FUNCIÓN TRANSACCIONAL PARA CREAR UNA ORDEN ------------------------------
-- Bloquea las filas de inventario mientras valida y descuenta las unidades.
-- Si alguna validación falla, PostgreSQL revierte todo: no deja stock parcial.
create or replace function public.create_order(
  p_customer jsonb,
  p_items jsonb,
  p_delivery_method text,
  p_order_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_first_name text;
  v_last_name text;
  v_email text;
  v_phone text;
  v_department text;
  v_city text;
  v_address text;
  v_address_details text;
  v_shipping_cost integer;
  v_delivery_label text;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_status text;
  v_requires_availability boolean := false;
  v_subtotal integer := 0;
  v_item jsonb;
  v_saved_item jsonb;
  v_product public.products%rowtype;
  v_product_id text;
  v_quantity integer;
  v_line_total integer;
  v_validated_items jsonb := '[]'::jsonb;
begin
  if p_customer is null or jsonb_typeof(p_customer) <> 'object' then
    raise exception 'Datos del cliente inválidos';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then
    raise exception 'El pedido debe contener entre 1 y 30 líneas de productos';
  end if;

  v_first_name := btrim(coalesce(p_customer->>'nombre', ''));
  v_last_name := btrim(coalesce(p_customer->>'apellidos', ''));
  v_email := lower(btrim(coalesce(p_customer->>'correo', '')));
  v_phone := btrim(coalesce(p_customer->>'telefono', ''));
  v_department := btrim(coalesce(p_customer->>'departamento', ''));
  v_city := btrim(coalesce(p_customer->>'ciudad', ''));
  v_address := btrim(coalesce(p_customer->>'direccion', ''));
  v_address_details := btrim(coalesce(p_customer->>'detallesDireccion', ''));

  if v_first_name = '' or v_last_name = '' or v_email = '' or v_phone = ''
     or v_department = '' or v_city = '' or v_address = '' then
    raise exception 'Completa todos los datos obligatorios del cliente';
  end if;
  if v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    raise exception 'El correo electrónico no es válido';
  end if;
  if v_phone !~ '^[0-9]{7,15}$' then
    raise exception 'El teléfono debe contener entre 7 y 15 dígitos';
  end if;

  case p_delivery_method
    when 'metropolitana' then
      v_shipping_cost := 15000;
      v_delivery_label := 'Domicilio área metropolitana';
    when 'nacional' then
      v_shipping_cost := 25000;
      v_delivery_label := 'Envío nacional';
    when 'recoger' then
      v_shipping_cost := 0;
      v_delivery_label := 'Recoger en tienda';
    else
      raise exception 'Método de entrega no válido';
  end case;

  -- Validar y reservar cada producto con bloqueo de fila para evitar sobreventa.
  for v_item in select value from jsonb_array_elements(p_items) as item(value) loop
    v_product_id := btrim(coalesce(v_item->>'id', ''));
    begin
      v_quantity := (v_item->>'quantity')::integer;
    exception when others then
      raise exception 'Cantidad inválida para uno de los productos';
    end;
    if v_product_id = '' or v_quantity is null or v_quantity < 1 or v_quantity > 99 then
      raise exception 'Producto o cantidad no válidos';
    end if;

    select * into v_product
      from public.products
      where id = v_product_id and is_active = true
      for update;

    if not found then
      raise exception 'El producto % ya no está disponible', v_product_id;
    end if;

    if v_product.sale_type = 'stock' then
      if v_product.stock < v_quantity then
        raise exception using message = format(
          'OUT_OF_STOCK|%s|%s', v_product.name, v_product.stock
        );
      end if;
      update public.products
        set stock = stock - v_quantity, updated_at = now()
        where id = v_product.id;
    else
      v_requires_availability := true;
    end if;

    v_line_total := v_product.price * v_quantity;
    v_subtotal := v_subtotal + v_line_total;
    v_validated_items := v_validated_items || jsonb_build_array(jsonb_build_object(
      'id', v_product.id,
      'name', v_product.name,
      'reference', v_product.reference,
      'sale_type', v_product.sale_type,
      'unit_price', v_product.price,
      'quantity', v_quantity,
      'line_total', v_line_total
    ));
  end loop;

  -- Reutilizar el registro del cliente al comprar con el mismo correo.
  insert into public.customers (
    first_name, last_name, email, phone, department, city, address, address_details
  ) values (
    v_first_name, v_last_name, v_email, v_phone, v_department, v_city, v_address, v_address_details
  )
  on conflict (email) do update set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    phone = excluded.phone,
    department = excluded.department,
    city = excluded.city,
    address = excluded.address,
    address_details = excluded.address_details,
    updated_at = now()
  returning id into v_customer_id;

  v_status := case when v_requires_availability
    then 'Pendiente de confirmar disponibilidad'
    else 'Esperando pago' end;

  -- Secuencia central de PostgreSQL: número distinto incluso entre compras simultáneas.
  v_order_number := 'YCZ-' || lpad(nextval('public.order_number_seq')::text, 6, '0');

  insert into public.orders (
    order_number, customer_id, customer_name, customer_email, customer_phone,
    shipping_department, shipping_city, shipping_address, shipping_details,
    status, delivery_method, shipping_cost, subtotal, total, payment_method,
    notes, requires_availability
  ) values (
    v_order_number, v_customer_id, v_first_name || ' ' || v_last_name, v_email, v_phone,
    v_department, v_city, v_address, v_address_details,
    v_status, v_delivery_label, v_shipping_cost, v_subtotal,
    v_subtotal + v_shipping_cost, 'Transferencia bancaria directa',
    left(coalesce(p_order_notes, ''), 500), v_requires_availability
  ) returning id into v_order_id;

  for v_saved_item in select value from jsonb_array_elements(v_validated_items) as saved(value) loop
    insert into public.order_items (
      order_id, product_id, product_name, product_reference, sale_type,
      unit_price, quantity, line_total
    ) values (
      v_order_id, v_saved_item->>'id', v_saved_item->>'name',
      v_saved_item->>'reference', v_saved_item->>'sale_type',
      (v_saved_item->>'unit_price')::integer,
      (v_saved_item->>'quantity')::integer,
      (v_saved_item->>'line_total')::integer
    );
  end loop;

  return jsonb_build_object(
    'id', v_order_id,
    'order_number', v_order_number,
    'status', v_status,
    'requires_availability', v_requires_availability,
    'delivery_method', v_delivery_label,
    'shipping_cost', v_shipping_cost,
    'subtotal', v_subtotal,
    'total', v_subtotal + v_shipping_cost,
    'created_at', now(),
    'items', v_validated_items
  );
end;
$$;

revoke all on function public.create_order(jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.create_order(jsonb, jsonb, text, text) to service_role;

-- 7) CANCELAR Y DEVOLVER STOCK ------------------------------------------------
-- Úsala desde el SQL Editor únicamente cuando confirmes que debes cancelar.
-- Solo permite cancelar una orden abierta y nunca duplica la devolución.
create or replace function public.cancel_order_and_restore_stock(p_order_number text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_line public.order_items%rowtype;
begin
  select * into v_order
    from public.orders
    where order_number = p_order_number
    for update;
  if not found then
    raise exception 'No existe la orden %', p_order_number;
  end if;
  if v_order.status = 'Cancelada' then
    raise exception 'La orden ya está cancelada; no se debe devolver stock otra vez';
  end if;
  if v_order.status not in ('Esperando pago', 'Pendiente de confirmar disponibilidad') then
    raise exception 'Solo se pueden cancelar órdenes pendientes';
  end if;

  for v_line in select * from public.order_items where order_id = v_order.id loop
    if v_line.sale_type = 'stock' and v_line.product_id is not null then
      update public.products
        set stock = stock + v_line.quantity, updated_at = now()
        where id = v_line.product_id and sale_type = 'stock';
    end if;
  end loop;

  update public.orders
    set status = 'Cancelada', updated_at = now()
    where id = v_order.id;

  return jsonb_build_object('order_number', p_order_number, 'status', 'Cancelada', 'stock_restored', true);
end;
$$;

revoke all on function public.cancel_order_and_restore_stock(text) from public, anon, authenticated;
grant execute on function public.cancel_order_and_restore_stock(text) to service_role;

-- 8) CATÁLOGO DE EJEMPLO ------------------------------------------------------
-- Los precios y existencias son demostrativos. Edita estos datos en Table Editor.
insert into public.products (
  id, name, category, price, previous_price, sale_type, stock,
  reference, tag, image, description, specifications, is_active
) values
(
  'kit-arrastre-ycz110', 'Kit de arrastre YCZ 110', 'Transmisión', 89900, 104900, 'stock', 8,
  '9V4201442YCZ', 'Más vendido', 'assets/kit-arrastre.svg',
  'Conjunto de transmisión secundaria para el mantenimiento del sistema de arrastre. Verifica paso, medidas y referencia de tu motocicleta antes de comprar.',
  '["Aplicación: Yamaha YCZ 110 (verificar año)","Sistema: cadena, piñón y corona","Referencia de referencia: 9V4201442YCZ"]'::jsonb, true
),
(
  'filtro-aire-ycz110', 'Filtro de aire YCZ 110', 'Motor', 59900, 0, 'stock', 12,
  'YCZ-FIA-110', 'Mantenimiento', 'assets/filtro-aire.svg',
  'Elemento filtrante para el sistema de admisión. Un filtro limpio y correctamente instalado ayuda a proteger el motor del polvo.',
  '["Sistema: admisión de aire","Repuesto de mantenimiento periódico","Confirma forma y año del conjunto"]'::jsonb, true
),
(
  'disco-freno-delantero', 'Disco de freno delantero', 'Frenos', 112900, 129900, 'stock', 5,
  'YCZ-FRD-01', 'Seguridad', 'assets/disco-freno.svg',
  'Disco de freno delantero de referencia para cotización. La medida y el patrón de fijación deben coincidir con la pieza instalada.',
  '["Ubicación: freno delantero de disco","Verificar diámetro y anclajes","Instalación recomendada por técnico"]'::jsonb, true
),
(
  'zapatas-freno-trasero', 'Zapatas de freno trasero', 'Frenos', 38900, 0, 'stock', 10,
  'YCZ-FRT-02', 'Esencial', 'assets/zapatas-freno.svg',
  'Juego de zapatas para sistema de freno trasero de tambor. Confirma diámetro y referencia antes de instalar.',
  '["Ubicación: rueda trasera","Sistema: tambor","Revisar desgaste y compatibilidad"]'::jsonb, true
),
(
  'bombillo-farola-35-35', 'Bombillo para farola 12V 35/35W', 'Eléctricos', 27900, 0, 'stock', 15,
  'YCZ-LUZ-3535', 'Iluminación', 'assets/farola.svg',
  'Bombillo halógeno para iluminación principal. Comprueba el tipo de base y la especificación del bombillo retirado.',
  '["Especificación referencial: 12V 35/35W","Tipo: halógeno","Validar base y conectores"]'::jsonb, true
),
(
  'direccionales-par', 'Juego de direccionales (par)', 'Eléctricos', 45900, 52900, 'stock', 7,
  'YCZ-DIR-PAIR', 'Repuesto eléctrico', 'assets/direccionales.svg',
  'Par de direccionales para reemplazo o reparación. Revisa conectores, fijaciones y ubicación antes de confirmar la compra.',
  '["Contenido: 2 unidades","Verificar conectores y anclaje","El diseño puede variar por año"]'::jsonb, true
),
(
  'guaya-acelerador', 'Guaya de acelerador', 'Mandos', 32900, 0, 'stock', 9,
  'YCZ-GUA-ACC', 'Control', 'assets/guaya-acelerador.svg',
  'Cable de accionamiento para el acelerador. Compara longitud, terminales y recorrido con la pieza original.',
  '["Sistema: acelerador","Comprobar longitud y terminales","Instalación y ajuste adecuados son importantes"]'::jsonb, true
),
(
  'manigueta-clutch', 'Manigueta de clutch YCZ 110', 'Mandos', 25900, 0, 'stock', 11,
  'YCZ-MAN-CL', 'Mando', 'assets/manigueta-clutch.svg',
  'Manigueta de reemplazo para el mando de embrague. Comprueba el soporte, diámetro del pivote y referencia de tu modelo.',
  '["Mando: embrague","Verificar soporte y pivote","Acabado metálico referencial"]'::jsonb, true
),
(
  'bujia-encendido', 'Bujía de encendido', 'Motor', 18900, 0, 'stock', 14,
  'YCZ-BUJ-01', 'Mantenimiento', 'assets/bujia.svg',
  'Bujía para mantenimiento del sistema de encendido. Verifica código térmico, rosca y luz de electrodo recomendados para tu año.',
  '["Sistema: encendido","Validar código de referencia","Consultar especificación del fabricante"]'::jsonb, true
),
(
  'farola-original-ycz110', 'Farola original Yamaha YCZ 110', 'Eléctricos', 145000, 0, 'bajo-pedido', null,
  'YCZ-FAR-ORI', 'Bajo pedido', 'assets/farola.svg',
  'Repuesto original bajo pedido. Sujeto a confirmación de disponibilidad con el proveedor antes del pago.',
  '["Tipo: repuesto original","Bajo pedido","Confirmar disponibilidad y referencia antes del pago"]'::jsonb, true
),
(
  'tapas-laterales-ycz110', 'Juego de tapas laterales YCZ 110', 'Carrocería', 185000, 0, 'bajo-pedido', null,
  'YCZ-TAP-LAT', 'Bajo pedido', 'assets/manigueta-clutch.svg',
  'Juego de tapas laterales bajo pedido. Color y compatibilidad sujetos a confirmación con el proveedor.',
  '["Tipo: carenado lateral","Bajo pedido","Confirmar color y disponibilidad antes del pago"]'::jsonb, true
),
(
  'asiento-ycz110', 'Asiento completo YCZ 110', 'Carrocería', 210000, 0, 'bajo-pedido', null,
  'YCZ-ASI-110', 'Bajo pedido', 'assets/kit-arrastre.svg',
  'Asiento completo solicitado al proveedor. Sujeto a confirmación de disponibilidad y versión de motocicleta.',
  '["Tipo: asiento completo","Bajo pedido","Confirmar año y disponibilidad antes del pago"]'::jsonb, true
)
on conflict (id) do nothing;

-- FIN. Para añadir nuevos repuestos utiliza Table Editor > products.
