# Pedidos y sonido — preview del 10 de octubre de 2026

Sin publicación en el dominio del negocio. Las nuevas API son adicionales: los endpoints usados por la versión publicada no se han sustituido.

- Recoger: corregido el acceso a la variable de zona sin inicializar. Ahora usa una fila tipada y la selección completa de la zona. Efectivo y transferencia sin GPS ni costo de envío.
- Estados: empleado y encargado pueden cancelar pedidos activos y pasar pedidos a domicilio listos a En reparto, y luego Entregado. No pueden reactivar cancelados ni modificar pedidos antiguos o entregados. El propietario conserva la reactivación con comprobación de existencias.
- Inventario: bloqueo de fila del pedido y control de devolución única, incluso con cambios repetidos.
- WhatsApp: mensaje distinto por estado; ventana preparada durante el gesto, redirección después de guardar, cierre en error y enlace alternativo si el navegador bloquea la ventana. El operador debe pulsar Enviar en WhatsApp. No hay envío automático mediante API de WhatsApp.
- Sonido: habilitado por defecto, preferencia de silencio guardada por cuenta y navegador. Recuperación al volver a la página y con cualquier toque o tecla cuando el navegador necesita un gesto. No se puede garantizar audio con volumen del dispositivo silenciado, pestaña suspendida o permisos denegados.

Validación: suite completa de PostgreSQL/PGlite, DOM/JSDOM, reportes y permisos. Se reproduce el fallo original de recoger y se verifica la corrección, tarifas de domicilio, errores sin pedido creado, devolución y reserva idempotentes, permisos de empleado, cuentas desactivadas, bloqueo anónimo, WhatsApp después del guardado y recuperación del audio respetando silencio.

APIs de preview: `create_pending_order_with_location_v3` y `update_order_status_with_inventory_v2`; migración `20261010015600_order_pickup_status_preview.sql`.
