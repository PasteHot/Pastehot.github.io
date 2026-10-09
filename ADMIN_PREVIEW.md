# Preview de mejoras del administrador

Registro de preparación del preview. La publicación fue autorizada el 2026-10-09. La migración y las funciones ya están instaladas. Consulta RELEASE_20261009.md para el estado final; las instrucciones de preparación siguientes se conservan como referencia histórica.

## Revisar las mejoras sin modificar el negocio

Abrir `admin.html?demo=1` en el Deploy Preview. El adaptador solo funciona en el hostname del preview de este proyecto (o localhost). En producción no se activa aunque se copie la URL con ese parámetro. Los datos son ficticios y las escrituras son en memoria. La prueba no manda mensajes de WhatsApp ni sube imágenes reales.

- Activar sonido. Se escucha el timbre de prueba. Usa ocho pulsos sintetizados de onda cuadrada en dos grupos, con un patrón tipo llamada, un timbre más penetrante y nivel mayor, sin descargar archivos de audio. Las notas no se superponen aunque entren varios pedidos seguidos. Silenciar, revisar la última alerta o perder acceso detiene inmediatamente el timbre. El volumen físico depende del volumen multimedia y la bocina de la tablet; la página no puede cambiar el volumen del sistema. Si hay pedidos sin revisar, repite cada 3 segundos con una pausa corta hasta pulsar Ver pedido en todos los pedidos pendientes. Silenciar conserva las alertas visuales. El navegador puede suspender el audio en segundo plano; tocar Reactivar sonido si ocurre. Se solicita mantener la pantalla encendida cuando el navegador admite Screen Wake Lock y se activa el sonido.
- Simular pedido nuevo, simular tres pedidos o simular desconexión. El último caso inserta un pedido durante la desconexión; al reconectar se incorpora a la bandeja sin duplicarse.
- Ver pedido abre el detalle y marca la alerta como revisada en ese navegador. No confirma ni cobra el pedido. Confirmar sigue siendo una acción separada.
- El selector Ver como permite probar Propietario, Empleado y Encargado. Desde Accesos, autorizar primero la computadora de prueba del encargado; así se comprueba que un tercer navegador necesita aprobación, pero no está bloqueado por un límite fijo.
- Productos: las categorías siguen el orden configurado; sus productos conservan su orden interno. Las categorías nuevas, no configuradas o vacías del producto no ocasionan pérdida de tarjetas.

El acceso habitual al preview (`admin.html` sin demo) usa el negocio existente. No usarlo para generar pedidos de prueba ni cambiar configuraciones reales durante QA. Las pruebas automatizadas usan datos ficticios.

## Activación posterior, después de aprobación

1. Guardar definición de funciones y políticas existentes antes de aplicar el SQL. La migración preserva la lógica de inventario y las funciones de zonas; solo traslada sus implementaciones a `private` y reemplaza sus comprobaciones de autorización. Se ejecuta en una transacción. No cambia productos, pedidos, precios, fotos o credenciales. Revoca el acceso público a create_order_with_inventory, un endpoint obsoleto que permitía aplicar inventario sin confirmación; el menú publicado usa create_pending_order_with_location_v2 y no depende de él.
2. Aplicar `supabase/migrations/20261009175922_admin_access_sessions.sql` al entorno autorizado. Ejecutar asesores de seguridad de Supabase y validar las funciones y políticas. No aplicar durante revisión de preview conectado a producción.
3. Desplegar `supabase/functions/pastehot-invite-staff/index.ts` cuando se autorice activar accesos. Usa los secretos propios del entorno de la función; nunca añadir la clave secreta al navegador. El endpoint verifica identidad, sesión, rol y origen. Añadir URLs exactas de redirección del administrador a Auth y configurar el correo de invitación. Verificar el envío con una cuenta de prueba autorizada antes de invitar empleados reales.
4. En el teléfono del propietario, abrir Accesos y activar la protección. Ese navegador se autoriza primero. Después la tablet solicita acceso y el propietario la aprueba. No activar primero en un navegador que se vaya a descartar.
5. Invitar al empleado con su correo propio. El empleado establece su contraseña y solicita autorización desde la tablet. Solo se le permiten pedidos de las últimas 48 horas, imprimir, confirmar y avanzar confirmado → preparando → listo → entregado. Puede cerrar y restablecer la tienda por emergencia, con motivo obligatorio y aviso de registro. No puede modificar horarios, cancelar/reactivar pedidos, editar el menú, subir/borrar fotos, acceder a clientes o gestionar accesos.

6. Para un encargado, seleccionar Encargado al invitarlo, o cambiar los permisos de una cuenta existente desde Accesos. Puede atender pedidos recientes y agregar/editar productos, precios, fotos, inventario y disponibilidad. También puede cerrar/restablecer por emergencia y consultar el historial de tienda. No puede borrar productos, cambiar categorías/configuración del negocio, consultar clientes o administrar accesos. Las fotos nuevas se suben a products/; solo puede eliminar fotos de productos sin referencias actuales, nunca imágenes de diseño. El propietario conserva todas las acciones.

## Cierres de emergencia y registro

El botón está disponible en todas las secciones del administrador para propietario, encargado y empleado. Requiere un motivo interno de 5 a 240 caracteres y advierte que se registrarán fecha, hora, cuenta y motivo. Restablecer elimina el cierre manual; nunca amplía el horario semanal. El menú recibe un mensaje genérico: el motivo interno y la identidad no son públicos. Los pedidos existentes siguen disponibles.

El RPC guarda el estado y el registro en una sola transacción. Si falla el registro, se revierte el cierre. Comprueba permisos y sesión, serializa acciones y rechaza solicitudes basadas en un estado anterior que otra persona haya cambiado. Un doble clic sobre el mismo estado no crea movimientos duplicados. Los botones antiguos de Operación también usan el RPC; el navegador del propietario no puede cambiar directamente las dos claves de cierre para eludir el registro. Durante preview conectado al backend actual, estas acciones quedan desactivadas hasta instalar las funciones; no existe fallback sin historial.

El historial es privado, sin permisos de inserción, modificación o borrado para cuentas de la aplicación. Registra identidad y rol vigentes, nombre del navegador y hora del servidor. Conserva estas instantáneas sin depender de posteriores cambios o eliminación de cuentas. Propietario y encargado pueden filtrar por día de Mérida o ver todo, y limitar a movimientos dentro del horario laboral. Se registra también fuera de horario; el horario aplicable queda guardado en cada evento. Las aperturas y cierres automáticos por horario no generan movimientos manuales.

El estado se actualiza por Realtime de settings y se reconcilia con el heartbeat de 20 segundos. El historial visible se recarga cuando cambia el último evento. El trigger de pedidos impide insertar un pedido nuevo pendiente mientras el cierre manual está activo, incluso desde una pestaña del menú que aún no recibió la actualización; la misma fila de control serializa cierre e inserción. No cancela ni modifica pedidos previos.

En la demo: Ver como Empleado, pulsar Cerrar tienda por emergencia y escribir un motivo; después Restablecer tienda con otro motivo. Cambiar a Propietario o autorizar y cambiar a Encargado, abrir Historial de tienda. Los movimientos se conservan entre roles en esa pestaña, pero se borran al recargar porque son ficticios.

## Dispositivos y revocación

No hay límite fijo de navegadores. Cada navegador requiere aprobación explícita del propietario, aunque se conozca la contraseña. No es identificación infalible de hardware. El navegador conserva una clave aleatoria de 256 bits, separada por usuario; en el servidor solo se guarda su SHA-256. Las sesiones de Auth deben existir y estar vinculadas al navegador autorizado. Al cerrar sesión y volver a entrar con el mismo navegador y su almacenamiento conservado, mantiene su autorización; una contraseña por sí sola desde otro navegador no la obtiene.

Desactivar a un empleado o encargado revoca sus navegadores. Cambiar entre Empleado y Encargado también revoca la aprobación de todos sus navegadores; el propietario debe aprobarlos nuevamente con sus nuevos permisos. El rol Propietario no puede asignarse ni alterarse desde esta interfaz. Habilitarlo después no devuelve la autorización anterior. La base de datos comprueba permisos en cada operación; un token aún no vencido no evita la desactivación. No se permite revocar el navegador propietario desde el que se está trabajando. Los puntos verdes reflejan actividad de navegadores aprobados en el último minuto, no garantizan atención humana. Una pestaña cerrada puede tardar hasta 60 segundos en apagarse.

Borrar cookies/almacenamiento, usar incógnito o cambiar navegador requiere aprobar de nuevo. Si se pierde acceso a todos los navegadores del propietario, la recuperación requiere intervención del propietario desde Supabase; no se concede aprobación automática al saber la contraseña. Recuperación controlada: revertir únicamente `private.pastehot_access_config.enforced` a false desde el proyecto autenticado y volver a activar desde el navegador legítimo; nunca ofrecer esta operación al empleado ni en el cliente.

## Pruebas

`cd tests && npm ci && npm test`

- Modelo de alertas: inicio silencioso, ráfagas, duplicados, cancelaciones, recuperación y revisión persistida.
- PostgreSQL real mediante PGlite: RLS, cuatro navegadores aprobados, aprobación obligatoria, encargado con edición de productos, limpieza de fotos sin referencias y bloqueo de imágenes de diseño, cambios de rol con nueva aprobación, empleado con permisos mínimos, datos recientes, revocación con token vigente, sesiones borradas, recuperación de navegador aprobado y rechazo de anónimos. Cierres de emergencia con auditoría atómica, fallo simulado del registro que revierte el cierre, conservación del horario y filtrado por día de Mérida, historial reservado y bloqueo de pedidos nuevos tras cerrar. La geometría se simula; las funciones espaciales no se han cambiado y no se afirma haberlas probado contra PostGIS en este entorno.
- DOM completo: arranque, agrupación, alertas, reconexión, interfaces de empleado y encargado, edición de productos, cambio de permisos y bloqueo de demo en producción.
- Endpoint de invitación con proveedor simulado: denegación a empleados, encargados, roles no permitidos y orígenes/redirecciones ajenos antes de enviar. No se enviaron invitaciones reales.
- Regresión externa `check_preview.cjs`: tickets RawBT, logo aprobado de 40 mm, QR, coordenadas y métodos de pago.

La conexión de pedidos usa Realtime existente, recuperación al reconectar/volver a la pestaña y revisión cada 30 segundos solo si falla Realtime. El primer historial se carga sin timbrar por pedidos anteriores; pendientes de las últimas 48 horas siguen visibles. No crea pedidos ni altera sus estados automáticamente.

## Reports and storage preparation

The owner uses on-demand SQL summaries and 50-row order pages with a stable created_at/id cursor. The live inbox recovers the last 48 hours on reconnect; individual realtime events update the cache directly rather than downloading the full archive. Search reaches archived orders independently of the displayed period. Summary reads use SECURITY INVOKER, check approved owner access and keep RLS. Customer rows are paginated; no materialized reports, cron or stored documents are added.

Sales reports use calendar weeks Monday–Sunday and calendar months in America/Merida, selected with a reference date, plus full history. They include zero-selling pastes, exclude drinks from the paste ranking and exclude cancelled/unconfirmed orders from sales. Total order value includes drinks and delivery; per-paste revenue uses purchase-time item values, not current prices. Reports describe recorded sales rather than verified receipts or profit. Owner-only Word DOCX, print/save-as-PDF and CSV downloads are built locally; complete order and store-history CSV backups are also owner-only and protect against spreadsheet formula injection. Failed summaries disable exports rather than showing partial totals.

Nine public JPEGs have been compressed into `prepared-photo-optimization.json`: 16,023,481 bytes become 571,654 bytes. Original SHA-256 values, source URLs and sizes are preserved in the manifest. No production files or references were changed or deleted. In Design the owner can review/download prepared versions. Apply them only with authorized publication: verify each source hash and current references, upload under a new path, update matching references, then use the existing reference-aware cleanup; never overwrite/delete a changed or still-referenced original. Preserve logos/transparency. No automatic application is attached to deployment.

Validation includes 105 archived orders, full-period summaries, tied timestamps across pages, archived search, calendar boundaries, zero-selling products, drinks and cancelled/unconfirmed exclusions, Merida day boundaries, owner/staff/anonymous access, complete CSV backup, failure export lock and native DOCX rendering over four pages with repeated table headers. Prepared backend migration remains unapplied in production.
