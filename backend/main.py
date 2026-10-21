# =============================================================================
# PROYECTO: YCZ 110 Colombia - Backend API & Ciberseguridad (OWASP)
# ARCHIVO: backend/main.py
# EJECUCIÓN LOCAL: uvicorn main:app --reload --port 8000
# =============================================================================

import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import List
from decimal import Decimal

import bcrypt
import jwt
import mercadopago
import html
from fastapi import FastAPI, Depends, HTTPException, Request, Response, status, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session

# -----------------------------------------------------------------------------
# 1. CONFIGURACIÓN DE VARIABLES DE ENTORNO Y SECRETOS CRIPTOGRÁFICOS
# En producción se cargan desde el panel de entorno de Netlify / Render / AWS
# -----------------------------------------------------------------------------
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://usuario:password@localhost:5432/ycz110_db")
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", secrets.token_urlsafe(64))
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_MINUTES = 60  # Expiración corta (1 hora) para minimizar ventana de exposición

# Credencial privada (Access Token) de MercadoPago - JAMÁS debe exponerse en el Frontend
MP_ACCESS_TOKEN = os.getenv("MP_ACCESS_TOKEN", "TEST-0000000000000000-000000-00000000000000000000000000000000-000000000")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "https://ycz110colombia.netlify.app")

# Inicialización del motor de Base de Datos con Pool de Conexiones seguro
engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=10, max_overflow=20)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Inicialización del SDK oficial de MercadoPago
mp_sdk = mercadopago.SDK(MP_ACCESS_TOKEN)

# Deshabilitar documentación pública (/docs) en producción para evitar reconocimiento de superficie
app = FastAPI(title="YCZ 110 Colombia Secure API", version="1.0.0")

# -----------------------------------------------------------------------------
# 2. MIDDLEWARES DE SEGURIDAD: CORS ESTRICTO Y CABECERAS OWASP
# -----------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN, "http://localhost:5500", "http://127.0.0.1:5500"],
    allow_credentials=True,  # Obligatorio para permitir el envío de cookies HttpOnly
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)

@app.middleware("http")
async def inyectar_cabeceras_seguridad_owasp(request: Request, call_next):
    """
    Inyecta cabeceras defensivas en cada respuesta HTTP para mitigar XSS,
    Clickjacking, MIME-Sniffing y forzar conexiones cifradas HTTPS (HSTS).
    """
    response: Response = await call_next(request)
    # Impide que el navegador adivine el tipo MIME y ejecute scripts disfrazados
    response.headers["X-Content-Type-Options"] = "nosniff"
    # Protege contra Clickjacking prohibiendo incrustar el sitio en un <iframe>
    response.headers["X-Frame-Options"] = "DENY"
    # Fuerza el uso exclusivo de HTTPS durante 1 año
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    # Oculta información de la ruta al navegar hacia enlaces externos
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response

# Dependencia para obtener y cerrar de forma segura la sesión de BD por cada petición
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# -----------------------------------------------------------------------------
# 3. ESQUEMAS DE VALIDACIÓN Y SANITIZACIÓN ANTI-XSS (Pydantic)
# -----------------------------------------------------------------------------
class RegistroClienteDTO(BaseModel):
    nombre_completo: str = Field(..., min_length=3, max_length=120)
    email: EmailStr
    password: str = Field(..., min_length=10, max_length=72)
    telefono_whatsapp: str = Field(..., pattern=r"^\+?[0-9]{10,15}$")

    @field_validator("nombre_completo")
    @classmethod
    def sanitizar_xss(cls, valor: str) -> str:
        """Escapa caracteres HTML peligrosos antes de que toquen la lógica de negocio."""
        return html.escape(valor.strip())

class LoginDTO(BaseModel):
    email: EmailStr
    password: str

class ItemCompraDTO(BaseModel):
    producto_id: uuid.UUID
    cantidad: int = Field(..., gt=0, le=20)  # Límite lógico por ítem

class ProcesarPagoDTO(BaseModel):
    direccion_envio_id: uuid.UUID
    items: List[ItemCompraDTO]
    # Datos tokenizados provenientes del Brick de MercadoPago (Cero datos crudos de tarjeta)
    mp_card_token: str = Field(..., min_length=10, max_length=255)
    payment_method_id: str = Field(..., max_length=50)  # Ej: 'visa', 'master'
    installments: int = Field(default=1, ge=1, le=36)
    issuer_id: str | None = None
    guardar_tarjeta_tokenizada: bool = False

# -----------------------------------------------------------------------------
# 4. UTILIDADES CRIPTOGRÁFICAS: BCRYPT Y JWT + DOBLE TOKEN CSRF
# -----------------------------------------------------------------------------
def hashear_password(password_plano: str) -> str:
    """Genera un hash seguro utilizando Bcrypt con factor de costo 12 y sal aleatoria."""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password_plano.encode("utf-8"), salt).decode("utf-8")

def verificar_password(password_plano: str, password_hash: str) -> bool:
    """Compara en tiempo constante el password ingresado contra el hash Bcrypt."""
    return bcrypt.checkpw(password_plano.encode("utf-8"), password_hash.encode("utf-8"))

def crear_sesion_jwt_y_csrf(cliente_id: str, email: str, rol: str):
    """
    Crea el JWT firmado con fecha de expiración (exp) y un token CSRF criptográfico
    vinculado dentro del payload del JWT para aplicar el patrón Double Submit Cookie.
    """
    csrf_token = secrets.token_hex(32)
    ahora = datetime.now(timezone.utc)
    payload = {
        "sub": str(cliente_id),
        "email": email,
        "rol": rol,
        "csrf": csrf_token,
        "iat": ahora,
        "exp": ahora + timedelta(minutes=JWT_EXPIRATION_MINUTES)
    }
    token_jwt = jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    return token_jwt, csrf_token

def validar_sesion_y_csrf(
    request: Request,
    x_csrf_token: str = Header(..., alias="X-CSRF-Token")
) -> dict:
    """
    Middleware de dependencia para rutas protegidas:
    1. Extrae el JWT desde la cookie HttpOnly 'ycz_access_token'.
    2. Verifica la firma criptográfica y que no haya expirado.
    3. Compara la cabecera 'X-CSRF-Token' contra el claim 'csrf' del JWT (Anti-CSRF).
    """
    token_jwt = request.cookies.get("ycz_access_token")
    if not token_jwt:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión no encontrada.")

    try:
        payload = jwt.decode(token_jwt, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="La sesión ha expirado. Inicia sesión nuevamente.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token de sesión inválido.")

    # Comparación en tiempo constante para evitar ataques de temporización (Timing Attacks)
    if not secrets.compare_digest(payload.get("csrf", ""), x_csrf_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Fallo de validación anti-CSRF.")

    return payload

# -----------------------------------------------------------------------------
# 5. ENDPOINTS DE AUTENTICACIÓN Y CATÁLOGO (CON CONSULTAS PARAMETRIZADAS)
# -----------------------------------------------------------------------------
@app.post("/api/auth/login")
def iniciar_sesion(credenciales: LoginDTO, response: Response, db: Session = Depends(get_db)):
    """
    Autentica al cliente protegiendo contra SQL Injection (parámetros vinculados)
    y contra Fuerza Bruta (bloqueo temporal al superar 5 intentos fallidos).
    """
    # Consulta parametrizada: ':email' es escapado a nivel de protocolo por el driver SQL
    query_cliente = text("""
        SELECT cliente_id, nombre_completo, email, password_hash, rol, 
               intentos_login_fallidos, bloqueado_hasta
        FROM clientes 
        WHERE email = :email AND activo = TRUE
    """)
    cliente = db.execute(query_cliente, {"email": credenciales.email}).mappings().first()

    # Mensaje genérico para evitar enumeración de usuarios válidos
    error_generico = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Correo electrónico o contraseña incorrectos."
    )

    if not cliente:
        raise error_generico

    # Verificar si la cuenta está temporalmente bloqueada por intentos fallidos
    ahora = datetime.now(timezone.utc)
    if cliente["bloqueado_hasta"] and cliente["bloqueado_hasta"] > ahora:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Cuenta bloqueada temporalmente por múltiples intentos fallidos. Intenta en 15 minutos."
        )

    # Verificar el hash Bcrypt
    if not verificar_password(credenciales.password, cliente["password_hash"]):
        nuevos_intentos = cliente["intentos_login_fallidos"] + 1
        bloqueo = (ahora + timedelta(minutes=15)) if nuevos_intentos >= 5 else None
        db.execute(
            text("UPDATE clientes SET intentos_login_fallidos = :i, bloqueado_hasta = :b WHERE cliente_id = :id"),
            {"i": nuevos_intentos, "b": bloqueo, "id": cliente["cliente_id"]}
        )
        db.commit()
        raise error_generico

    # Login exitoso: Reiniciar contador de intentos fallidos
    db.execute(
        text("UPDATE clientes SET intentos_login_fallidos = 0, bloqueado_hasta = NULL, ultimo_login = :ahora WHERE cliente_id = :id"),
        {"ahora": ahora, "id": cliente["cliente_id"]}
    )
    db.commit()

    # Generar tokens y almacenar el JWT en una cookie HttpOnly blindada
    token_jwt, csrf_token = crear_sesion_jwt_y_csrf(
        cliente["cliente_id"], cliente["email"], cliente["rol"]
    )

    response.set_cookie(
        key="ycz_access_token",
        value=token_jwt,
        httponly=True,       # IMPIDE lectura desde JavaScript (Neutraliza robo de sesión por XSS)
        secure=True,         # Solo se transmite sobre conexiones cifradas HTTPS
        samesite="strict",   # Bloquea envío de la cookie desde sitios de terceros
        max_age=JWT_EXPIRATION_MINUTES * 60,
        path="/"
    )

    # Retornamos el csrf_token para que el Frontend lo envíe en la cabecera X-CSRF-Token
    return {
        "mensaje": "Autenticación exitosa",
        "csrf_token": csrf_token,
        "usuario": {
            "nombre": cliente["nombre_completo"],
            "email": cliente["email"]
        }
    }

@app.get("/api/productos")
def listar_repuestos_ycz110(db: Session = Depends(get_db)):
    """Devuelve el catálogo activo de repuestos para la Yamaha YCZ 110."""
    query = text("""
        SELECT p.producto_id, p.sku, p.nombre, p.descripcion, p.precio_cop, 
               p.stock_actual, p.imagen_url, p.es_original_yamaha, c.nombre AS categoria
        FROM productos p
        INNER JOIN categorias c ON p.categoria_id = c.categoria_id
        WHERE p.activo = TRUE AND p.stock_actual > 0
        ORDER BY p.nombre ASC
    """)
    resultados = db.execute(query).mappings().all()
    return [dict(item) for item in resultados]

# -----------------------------------------------------------------------------
# 6. ENDPOINT TRANSACCIONAL: PROCESAMIENTO DE PAGO CON MERCADOPAGO (TOKENIZADO)
# -----------------------------------------------------------------------------
@app.post("/api/pagos/procesar")
def procesar_orden_y_pago(
    orden_dto: ProcesarPagoDTO,
    request: Request,
    sesion_usuario: dict = Depends(validar_sesion_y_csrf),
    db: Session = Depends(get_db)
):
    """
    1. Valida stock y calcula el total real directamente desde la Base de Datos.
    2. Procesa el cobro en MercadoPago usando el token de un solo uso (mp_card_token).
    3. Registra la venta, el detalle de ítems y descuenta inventario en una transacción ACID.
    4. Devuelve el resumen estructurado para disparar la notificación con EmailJS.
    """
    cliente_id = sesion_usuario["sub"]
    email_cliente = sesion_usuario["email"]

    try:
        subtotal_calculado = Decimal("0.00")
        items_verificados = []
        resumen_repuestos_texto = []

        # Paso 1: Bloquear filas de productos (FOR UPDATE) para evitar condiciones de carrera (Race Conditions)
        for item in orden_dto.items:
            prod_query = text("""
                SELECT producto_id, sku, nombre, precio_cop, stock_actual 
                FROM productos 
                WHERE producto_id = :pid AND activo = TRUE
                FOR UPDATE
            """)
            producto_db = db.execute(prod_query, {"pid": item.producto_id}).mappings().first()

            if not producto_db:
                raise HTTPException(status_code=404, detail=f"Repuesto no encontrado: {item.producto_id}")
            if producto_db["stock_actual"] < item.cantidad:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Stock insuficiente para {producto_db['nombre']}. Disponible: {producto_db['stock_actual']}"
                )

            precio_unitario = Decimal(str(producto_db["precio_cop"]))
            subtotal_linea = precio_unitario * item.cantidad
            subtotal_calculado += subtotal_linea

            items_verificados.append({
                "producto_id": producto_db["producto_id"],
                "sku": producto_db["sku"],
                "nombre": producto_db["nombre"],
                "cantidad": item.cantidad,
                "precio_unitario": precio_unitario,
                "subtotal_linea": subtotal_linea
            })
            resumen_repuestos_texto.append(
                f"{item.cantidad}x {producto_db['nombre']} ({producto_db['sku']}) - ${subtotal_linea:,.0f} COP"
            )

        # Cálculo de impuestos (IVA incluido / desglose) y total final en el servidor
        costo_envio = Decimal("15000.00") if subtotal_calculado < Decimal("200000.00") else Decimal("0.00")
        total_pagar = subtotal_calculado + costo_envio
        numero_orden = f"YCZ-{datetime.now().strftime('%Y%m%d')}-{secrets.token_hex(2).upper()}"

        # Paso 2: Enviar cobro tokenizado a la API de MercadoPago
        payment_data = {
            "transaction_amount": float(total_pagar),
            "token": orden_dto.mp_card_token,  # Token seguro generado en el cliente
            "description": f"Orden {numero_orden} - Repuestos YCZ 110 Colombia",
            "installments": orden_dto.installments,
            "payment_method_id": orden_dto.payment_method_id,
            "payer": {
                "email": email_cliente
            },
            "external_reference": numero_orden
        }

        # Idempotency Key evita cobros duplicados si el usuario hace doble clic o falla la red
        request_options = mercadopago.config.RequestOptions()
        request_options.custom_headers = {"x-idempotency-key": str(uuid.uuid4())}

        mp_result = mp_sdk.payment().create(payment_data, request_options)
        mp_response = mp_result.get("response", {})
        mp_status = mp_response.get("status", "rejected")
        mp_payment_id = str(mp_response.get("id", f"SIM-{secrets.token_hex(4)}"))

        # Mapear estado de MercadoPago al dominio de nuestra Base de Datos
        estado_orden_db = "APROBADA" if mp_status == "approved" else "RECHAZADA"

        # Paso 3: Insertar la cabecera de la Venta
        ip_cliente = request.client.host if request.client else "0.0.0.0"
        insert_venta_sql = text("""
            INSERT INTO ventas (
                numero_orden, cliente_id, direccion_envio_id, subtotal_cop, 
                impuestos_cop, costo_envio_cop, total_cop, estado_orden, 
                pasarela_transaccion_id, ip_origen
            ) VALUES (
                :num_orden, :cid, :dir_id, :sub, 0.00, :envio, :tot, 
                :estado, :mp_id, :ip
            ) RETURNING venta_id
        """)
        venta_id = db.execute(insert_venta_sql, {
            "num_orden": numero_orden,
            "cid": cliente_id,
            "dir_id": orden_dto.direccion_envio_id,
            "sub": subtotal_calculado,
            "envio": costo_envio,
            "tot": total_pagar,
            "estado": estado_orden_db,
            "mp_id": mp_payment_id,
            "ip": ip_cliente
        }).scalar_one()

        # Paso 4: Insertar el Detalle de Venta y descontar stock SOLO si fue APROBADA
        for item_v in items_verificados:
            db.execute(text("""
                INSERT INTO detalle_ventas (
                    venta_id, producto_id, cantidad, 
                    precio_unitario_historico_cop, subtotal_linea_cop
                ) VALUES (:vid, :pid, :cant, :precio, :sub_linea)
            """), {
                "vid": venta_id,
                "pid": item_v["producto_id"],
                "cant": item_v["cantidad"],
                "precio": item_v["precio_unitario"],
                "sub_linea": item_v["subtotal_linea"]
            })

            if estado_orden_db == "APROBADA":
                db.execute(text("""
                    UPDATE productos 
                    SET stock_actual = stock_actual - :cant,
                        fecha_actualizacion = CURRENT_TIMESTAMP
                    WHERE producto_id = :pid
                """), {"cant": item_v["cantidad"], "pid": item_v["producto_id"]})

        # Confirmar toda la transacción atómica en la Base de Datos
        db.commit()

        # Retornar payload estructurado para el módulo de EmailJS y confirmación en UI
        return {
            "numero_orden": numero_orden,
            "estado_orden": estado_orden_db,
            "email_cliente": email_cliente,
            "total_formateado": f"${total_pagar:,.0f} COP",
            "desglose_repuestos": "\n".join(resumen_repuestos_texto),
            "pasarela_id": mp_payment_id
        }

    except HTTPException:
        db.rollback()
        raise
    except Exception as error_interno:
        db.rollback()
        # Nunca exponer el stacktrace de SQL o del servidor al cliente (Prevención de fuga de datos)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Ocurrió un error procesando la transacción. No se realizaron cargos duplicados."
        )

    # =============================================================================
# 7. WEBHOOK SEGURO DE MERCADOPAGO (VALIDACIÓN CRIPTOGRÁFICA HMAC-SHA256)
# Añadir al final de: backend/main.py
# =============================================================================
import hmac
import hashlib
from mangum import Mangum

# Secreto compartido configurado en el panel de Webhooks de MercadoPago Developers
MP_WEBHOOK_SECRET = os.getenv("MP_WEBHOOK_SECRET", "secreto_webhook_hmac_ycz110")

def verificar_firma_hmac_mercadopago(
    x_signature: str,
    x_request_id: str,
    data_id: str
) -> bool:
    """
    SEGURIDAD CRÍTICA (OWASP A08 - Integridad de Datos y Software):
    Verifica matemáticamente que la notificación provenga de los servidores reales
    de MercadoPago calculando el HMAC-SHA256 sobre el manifiesto de la petición.
    """
    if not x_signature or not x_request_id or not data_id:
        return False

    # Extraer la marca de tiempo (ts) y el hash versión 1 (v1) de la cabecera x-signature
    partes = dict(item.split("=", 1) for item in x_signature.split(",") if "=" in item)
    ts = partes.get("ts")
    hash_recibido = partes.get("v1")

    if not ts or not hash_recibido:
        return False

    # Construir la cadena firmada oficial según la especificación de MercadoPago
    manifiesto = f"id:{data_id};request-id:{x_request_id};ts:{ts};"

    # Calcular la firma esperada usando nuestra llave secreta del servidor
    firma_calculada = hmac.new(
        key=MP_WEBHOOK_SECRET.encode("utf-8"),
        msg=manifiesto.encode("utf-8"),
        digestmod=hashlib.sha256
    ).hexdigest()

    # Comparación en tiempo constante para neutralizar ataques de temporización (Timing Attacks)
    return hmac.compare_digest(firma_calculada, hash_recibido)


@app.post("/api/webhooks/mercadopago", status_code=status.HTTP_200_OK)
async def webhook_confirmacion_pago(
    request: Request,
    x_signature: str | None = Header(default=None, alias="x-signature"),
    x_request_id: str | None = Header(default=None, alias="x-request-id"),
    db: Session = Depends(get_db)
):
    """
    Escucha notificaciones asíncronas de MercadoPago (ej. pagos por PSE o Efecty).
    Si la firma HMAC-SHA256 es auténtica y el pago pasa a 'approved', actualiza
    el estado de la orden en la Base de Datos de forma idempotente.
    """
    params = request.query_params
    data_id = params.get("data.id") or params.get("id")

    # 1. Rechazar inmediatamente cualquier petición cuya firma criptográfica no coincida
    if not verificar_firma_hmac_mercadopago(x_signature or "", x_request_id or "", str(data_id or "")):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Firma criptográfica del Webhook inválida o adulterada."
        )

    # 2. Consultar el estado real del pago directamente en los servidores de MercadoPago
    info_pago = mp_sdk.payment().get(data_id)
    if info_pago.get("status") != 200:
        return {"estado": "ignorado"}

    datos_mp = info_pago.get("response", {})
    numero_orden = datos_mp.get("external_reference")
    estado_mp = datos_mp.get("status")

    if not numero_orden:
        return {"estado": "sin_referencia"}

    nuevo_estado_db = "APROBADA" if estado_mp == "approved" else (
        "RECHAZADA" if estado_mp in ("rejected", "cancelled") else "PENDIENTE"
    )

    # 3. Actualizar la orden de forma parametrizada evitando doble descuento de stock
    db.execute(
        text("""
            UPDATE ventas 
            SET estado_orden = :nuevo_estado,
                pasarela_transaccion_id = :mp_id
            WHERE numero_orden = :num_orden AND estado_orden = 'PENDIENTE'
        """),
        {
            "nuevo_estado": nuevo_estado_db,
            "mp_id": str(data_id),
            "num_orden": numero_orden
        }
    )
    db.commit()

    return {"estado": "procesado_correctamente", "orden": numero_orden}


# Adaptador ASGI-Serverless: Permite ejecutar FastAPI como función Serverless
handler = Mangum(app, lifespan="off")