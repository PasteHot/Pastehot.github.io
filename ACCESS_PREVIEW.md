# Gestión de dispositivos · preview

El propietario puede renombrar cualquier navegador, incluido el actual. El servidor conserva el nombre aunque el dispositivo envíe un nombre antiguo en su heartbeat. Puede eliminar de la lista únicamente dispositivos revocados y ajenos a la sesión actual. No se eliminan cuentas Auth ni movimientos del historial de tienda. Si un navegador eliminado vuelve a entrar, aparece como solicitud pendiente y necesita una nueva aprobación.

Cambiar permisos lleva al selector de la cuenta de equipo correspondiente. Los roles pertenecen a cuentas, no a dispositivos; para mantener al propietario en el celular y un encargado/empleado en la tablet, se usan cuentas diferentes. No se puede rebajar el rol del propietario desde la aplicación.

Pruebas: PostgreSQL aislado verifica permisos del propietario, rechazo a empleados y anónimos, nombre remoto persistente frente a heartbeat antiguo, bloqueo de eliminación del navegador actual/autorizado, conservación del historial y regreso sin aprobación tras eliminar. DOM completo verifica botones, renombrado y retirada de accesos revocados. Suite completa aprobada.

La migración 20261009212843_admin_session_management.sql está preparada y NO aplicada a producción. Revisar admin.html?demo=1 en Deploy Preview antes de autorizar otra publicación. No fusionar ni publicar sin aprobación expresa.
