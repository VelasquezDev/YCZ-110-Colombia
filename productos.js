/* Catálogo demostrativo YCZ 110. Ajusta precios, stock y referencias antes de publicar. */
window.PRODUCTOS = [
  {
    id: "kit-arrastre-ycz110", nombre: "Kit de arrastre YCZ 110", categoria: "Transmisión",
    precio: 89900, precioAnterior: 104900, tipoVenta: "stock", stock: 8, referencia: "9V4201442YCZ", etiqueta: "Más vendido",
    imagen: "assets/kit-arrastre.svg",
    descripcion: "Conjunto de transmisión secundaria para el mantenimiento del sistema de arrastre. Verifica paso, medidas y referencia de tu motocicleta antes de comprar.",
    especificaciones: ["Aplicación: Yamaha YCZ 110 (verificar año)", "Sistema: cadena, piñón y corona", "Referencia de referencia: 9V4201442YCZ"]
  },
  {
    id: "filtro-aire-ycz110", nombre: "Filtro de aire YCZ 110", categoria: "Motor",
    precio: 59900, precioAnterior: 0, tipoVenta: "stock", stock: 12, referencia: "YCZ-FIA-110", etiqueta: "Mantenimiento",
    imagen: "assets/filtro-aire.svg",
    descripcion: "Elemento filtrante para el sistema de admisión. Un filtro limpio y correctamente instalado ayuda a proteger el motor del polvo.",
    especificaciones: ["Sistema: admisión de aire", "Repuesto de mantenimiento periódico", "Confirma forma y año del conjunto"]
  },
  {
    id: "disco-freno-delantero", nombre: "Disco de freno delantero", categoria: "Frenos",
    precio: 112900, precioAnterior: 129900, tipoVenta: "stock", stock: 5, referencia: "YCZ-FRD-01", etiqueta: "Seguridad",
    imagen: "assets/disco-freno.svg",
    descripcion: "Disco de freno delantero de referencia para cotización. La medida y el patrón de fijación deben coincidir con la pieza instalada.",
    especificaciones: ["Ubicación: freno delantero de disco", "Verificar diámetro y anclajes", "Instalación recomendada por técnico"]
  },
  {
    id: "zapatas-freno-trasero", nombre: "Zapatas de freno trasero", categoria: "Frenos",
    precio: 38900, precioAnterior: 0, tipoVenta: "stock", stock: 10, referencia: "YCZ-FRT-02", etiqueta: "Esencial",
    imagen: "assets/zapatas-freno.svg",
    descripcion: "Juego de zapatas para sistema de freno trasero de tambor. Confirma diámetro y referencia antes de instalar.",
    especificaciones: ["Ubicación: rueda trasera", "Sistema: tambor", "Revisar desgaste y compatibilidad"]
  },
  {
    id: "bombillo-farola-35-35", nombre: "Bombillo para farola 12V 35/35W", categoria: "Eléctricos",
    precio: 27900, precioAnterior: 0, tipoVenta: "stock", stock: 15, referencia: "YCZ-LUZ-3535", etiqueta: "Iluminación",
    imagen: "assets/farola.svg",
    descripcion: "Bombillo halógeno para iluminación principal. Comprueba el tipo de base y la especificación del bombillo retirado.",
    especificaciones: ["Especificación referencial: 12V 35/35W", "Tipo: halógeno", "Validar base y conectores"]
  },
  {
    id: "direccionales-par", nombre: "Juego de direccionales (par)", categoria: "Eléctricos",
    precio: 45900, precioAnterior: 52900, tipoVenta: "stock", stock: 7, referencia: "YCZ-DIR-PAIR", etiqueta: "Repuesto eléctrico",
    imagen: "assets/direccionales.svg",
    descripcion: "Par de direccionales para reemplazo o reparación. Revisa conectores, fijaciones y ubicación antes de confirmar la compra.",
    especificaciones: ["Contenido: 2 unidades", "Verificar conectores y anclaje", "El diseño puede variar por año"]
  },
  {
    id: "guaya-acelerador", nombre: "Guaya de acelerador", categoria: "Mandos",
    precio: 32900, precioAnterior: 0, tipoVenta: "stock", stock: 9, referencia: "YCZ-GUA-ACC", etiqueta: "Control",
    imagen: "assets/guaya-acelerador.svg",
    descripcion: "Cable de accionamiento para el acelerador. Compara longitud, terminales y recorrido con la pieza original.",
    especificaciones: ["Sistema: acelerador", "Comprobar longitud y terminales", "Instalación y ajuste adecuados son importantes"]
  },
  {
    id: "manigueta-clutch", nombre: "Manigueta de clutch YCZ 110", categoria: "Mandos",
    precio: 25900, precioAnterior: 0, tipoVenta: "stock", stock: 11, referencia: "YCZ-MAN-CL", etiqueta: "Mando",
    imagen: "assets/manigueta-clutch.svg",
    descripcion: "Manigueta de reemplazo para el mando de embrague. Comprueba el soporte, diámetro del pivote y referencia de tu modelo.",
    especificaciones: ["Mando: embrague", "Verificar soporte y pivote", "Acabado metálico referencial"]
  },
  {
    id: "bujia-encendido", nombre: "Bujía de encendido", categoria: "Motor",
    precio: 18900, precioAnterior: 0, tipoVenta: "stock", stock: 14, referencia: "YCZ-BUJ-01", etiqueta: "Mantenimiento",
    imagen: "assets/bujia.svg",
    descripcion: "Bujía para mantenimiento del sistema de encendido. Verifica código térmico, rosca y luz de electrodo recomendados para tu año.",
    especificaciones: ["Sistema: encendido", "Validar código de referencia", "Consultar especificación del fabricante"]
  }
  ,
  {
    id: "farola-completa-original", nombre: "Conjunto de farola original YCZ 110", categoria: "Eléctricos",
    precio: 145000, precioAnterior: 0, tipoVenta: "bajo-pedido", stock: null, referencia: "YCZ-FAR-ORI",
    etiqueta: "Bajo pedido", imagen: "assets/farola.svg",
    descripcion: "Conjunto de farola ofrecido bajo pedido. La disponibilidad, año y referencia deben confirmarse antes de aceptar el pago.",
    especificaciones: ["Modalidad: bajo pedido", "Disponibilidad sujeta a proveedor", "Confirmar año, conectores y referencia"]
  },
  {
    id: "tapa-lateral-original", nombre: "Juego de tapas laterales originales", categoria: "Carrocería",
    precio: 185000, precioAnterior: 0, tipoVenta: "bajo-pedido", stock: null, referencia: "YCZ-TAP-LAT",
    etiqueta: "Bajo pedido", imagen: "assets/manigueta-clutch.svg",
    descripcion: "Juego de tapas laterales solicitado bajo pedido. Color, acabado y disponibilidad se confirman con el proveedor.",
    especificaciones: ["Modalidad: bajo pedido", "Color sujeto a disponibilidad", "Confirmar compatibilidad por año"]
  },
  {
    id: "asiento-completo", nombre: "Asiento completo YCZ 110", categoria: "Carrocería",
    precio: 210000, precioAnterior: 0, tipoVenta: "bajo-pedido", stock: null, referencia: "YCZ-ASI-110",
    etiqueta: "Bajo pedido", imagen: "assets/zapatas-freno.svg",
    descripcion: "Asiento completo disponible mediante solicitud. Se debe confirmar existencia y compatibilidad antes de continuar con el pago.",
    especificaciones: ["Modalidad: bajo pedido", "Sujeto a disponibilidad", "Verificar forma y anclajes"]
  }
];
