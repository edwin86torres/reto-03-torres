# Proceso de órdenes de compra (OC) en Periferia

## Entrada
Cada solicitud llega por correo con: Excel de solicitud (normalizado como `solicitud.json`), cotización del proveedor (`cotizacion.txt`) y correo de aprobación del líder (`aprobacion.json`). En algunos casos también llega la factura (`factura.txt`).

## Maestros
- **Proveedores**: código SAP, NIT, condiciones de pago e indicador de IVA por defecto, estado activo.
- **Centros de costo**: subáreas válidas y aprobadores con su tope de aprobación.
- **Indicadores de IVA**: C0 excluido, C1 IVA 19 %, C2 IVA 5 %.
- **Condiciones de pago**: Z000 inmediato, Z015 15 días, Z030 30 días, Z060 60 días.

## Matriz de controles
| Código | Control | Efecto |
|---|---|---|
| RC1 | Proveedor existe (por NIT o nombre) y está activo | Bloqueo |
| RC2 | Hay aprobación con "Aprobado" de un aprobador del centro de costo | Bloqueo |
| RC3 | Valor total ≤ tope del aprobador en ese centro | Bloqueo |
| RC4 | La subárea pertenece al centro de costo | Bloqueo |
| RC5 | Cotización vs. solicitud con diferencia ≤ 2 %, o falta cotización | Confirmación |
| RC6 | Falta indicador de IVA → se toma el del proveedor | Confirmación + derivado |
| RC7 | Faltan condiciones de pago → se toman del proveedor | Solo se informa |
| RC8 | Factura anterior a la solicitud → OC retroactiva | Confirmación + marca en control |
| RC9 | Aprobación anterior a la solicitud | Confirmación |
| RC10 | cantidad × valor unitario = valor total (± 1) | Bloqueo |

## Acciones sugeridas típicas
- Proveedor inexistente o inactivo: Compras debe crearlo o reactivarlo en SAP antes de reprocesar.
- Aprobador sin autoridad o sin tope suficiente: pedir la aprobación a un aprobador válido del centro con tope suficiente, o escalar a la dirección financiera.
- Diferencia con la cotización: confirmar con el solicitante cuál valor es el correcto; la OC se crea por el valor de la solicitud.

## OC retroactivas
Una OC es retroactiva cuando la factura es anterior a la solicitud: la compra se hizo antes de que existiera la OC, saltándose la cotización. La dirección quiere medirlas: quedan con `retroactiva = true` en `out/control.csv`.

## Evidencias y control
- Evidencia de aprobación: `out/<caso>/aprobacion.txt` con hash SHA-256.
- Trazabilidad de cada campo de la OC: `out/<caso>/trazabilidad.json`.
- Log de control para auditoría: `out/control.csv` (un registro por intento: creada, bloqueada, pendiente, existente).
- Crear dos veces la misma solicitud devuelve la misma OC (idempotencia).
