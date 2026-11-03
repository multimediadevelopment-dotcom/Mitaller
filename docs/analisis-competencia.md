# Análisis de Competencia y Aplicaciones de Referencia (DEV-21)

**Fecha de verificación:** 03/11/2026  
**Objetivo:** Analizar aplicaciones de gestión de talleres mecánicos y de chapa y pintura existentes en el mercado para identificar patrones de experiencia de usuario, organización de módulos y mejoras aplicables a **MiTallerApp / Crash Solution**, sin copiar código, activos gráficos, marcas ni diseños protegidos.

---

## 1. Estado de Acceso a las Fuentes

Las cuatro referencias solicitadas fueron consultadas directamente (respuesta `HTTP 200 OK` en todos los casos) y contrastadas con su documentación pública:

| Fuente | URL | Estado HTTP | Nombre Comercial / Autor |
| :--- | :--- | :--- | :--- |
| **Referencia 1** | `https://apps.apple.com/us/app/mitaller/id6751720739` | `200 OK` | **MiTaller** (App Store iOS · Desarrollador: Santiago Prado) |
| **Referencia 2** | `https://tallerpro.com.ar/` | `200 OK` | **TallerPro** (SaaS Web Argentina) |
| **Referencia 3** | `https://proyectonube.com/software-taller-mecanico/` | `200 OK` | **AppTaller** por Proyecto Nube (SaaS Web) |
| **Referencia 4** | `https://www.mitaller.app/` | `200 OK` | **Mi Taller** (`mitaller.app` · SaaS Web y Móvil Latinoamérica) |

> **Nota de alcance verificable:** En las aplicaciones SaaS (`tallerpro.com.ar`, `proyectonube.com`, `mitaller.app`) y la ficha de App Store (`id6751720739`), el análisis se basa estrictamente en la información técnica y funcional públicamente verificable en sus sitios oficiales y fichas de producto, sin acceder a entornos privados de clientes.

---

## 2. Análisis Individual por Plataforma

### 2.1. MiTaller (App Store — `id6751720739`)
- **Enfoque principal:** Aplicación móvil nativa para iOS orientada a talleres de chapa, pintura y reparación automotriz.
- **Organización de módulos:** Estructura compacta centrada en 4 pilares: Clientes/Vehículos, Presupuestos, Catálogo de tareas/repuestos frecuentes e Historial.
- **Experiencia de usuario (UX):** Diseñada para uso con una sola mano en teléfono móvil, reduciendo la escritura manual mediante listas preconfiguradas de piezas y trabajos habituales.
- **Gestión de clientes y vehículos:** Asociación directa 1-a-N entre cliente y vehículos con historial de intervenciones.
- **Presupuestos:** Generación de documentos PDF personalizados con logotipo del taller, desglose de tareas y repuestos, cálculo automático de totales y firma.
- **Inventario:** No expone un sistema ERP complejo de almacén, sino **listas personalizables de repuestos y tareas habituales** con precios de referencia para cotizar rápido.
- **Uso desde celulares:** Nativo en iOS (iPhone/iPad), priorizando velocidad de carga en recepción del vehículo.

### 2.2. TallerPro (`https://tallerpro.com.ar/`)
- **Enfoque principal:** Plataforma SaaS integral para talleres mecánicos en Argentina.
- **Organización de módulos:** Panel administrativo completo dividido en Órdenes de Trabajo (OT), Clientes y Cuentas Corrientes, Vehículos, Control de Stock/Proveedores, Facturación/Pagos (integración local en ARS / ARCA-AFIP / Mercado Pago) y Portal Público del Taller.
- **Experiencia de usuario (UX):** Orientada a escritorio y tablet con vistas adaptables a móvil; flujo formal de Orden de Trabajo con estados bien definidos.
- **Gestión de clientes y vehículos:** Ficha centralizada por patente/dominio con historial clínico del vehículo y estado de cuenta corriente.
- **Presupuestos:** Cálculo combinado de mano de obra + repuestos + impuestos, envío directo de avisos y presupuestos por WhatsApp.
- **Inventario:** Control de stock con descuento por orden de reparación, alertas de stock mínimo y gestión de proveedores.
- **Uso desde celulares:** Web responsive multi-dispositivo con permisos diferenciados por rol (administrador vs. mecánico).

### 2.3. AppTaller — Proyecto Nube (`https://proyectonube.com/software-taller-mecanico/`)
- **Enfoque principal:** Software en la nube simplificado para digitalizar talleres pequeños y medianos.
- **Organización de módulos:** Clientes, Vehículos, Órdenes de Trabajo, Presupuestos, Pagos/Recibos y Seguimiento por enlace/QR.
- **Experiencia de usuario (UX):** Interfaz limpia enfocada en reemplazar planillas de papel/Excel sin curva de aprendizaje elevada.
- **Gestión de clientes y vehículos:** Búsqueda rápida por placa/patente o nombre del propietario, vinculando historial de reparaciones previas.
- **Presupuestos:** Emisión de cotizaciones vinculadas a la orden de ingreso y conversión posterior en recibos de pago.
- **Inventario:** Enfoque básico en cargos de repuestos dentro de la orden; en el ecosistema Proyecto Nube el inventario comercial avanzado se delega o complementa con módulos específicos.
- **Uso desde celulares:** Aplicación web accesible desde navegador móvil sin requerir instalación nativa, destacando el uso de códigos QR para seguimiento.

### 2.4. Mi Taller (`https://www.mitaller.app/`)
- **Enfoque principal:** Plataforma moderna para talleres mecánicos, de motos y de chapa y pintura en Latinoamérica.
- **Organización de módulos:** Recepción Digital por Zonas, Órdenes de Trabajo, Presupuestos, Inventario/Repuestos, Finanzas/Caja, Agenda de Turnos y Sitio Web del Taller.
- **Experiencia de usuario (UX):** Flujo guiado paso a paso desde que entra el vehículo (inspección visual por zonas exterior/interior/motor, kilometraje, fotografías y firma) hasta la entrega.
- **Gestión de clientes y vehículos:** Historial completo por vehículo e interfaz de seguimiento para el cliente vía WhatsApp (sin mostrar costos internos).
- **Presupuestos:** Presupuestos digitales en PDF y enlaces compartibles por WhatsApp; conversión de ítems inspeccionados a líneas cotizadas.
- **Inventario:** Control de stock con alertas de stock mínimo y descuento automático de repuestos al utilizarlos en una orden de trabajo.
- **Uso desde celulares:** Fuerte enfoque *mobile-first* pensado para que el mecánico tome fotografías y registre daños al lado del vehículo.

---

## 3. Matriz Comparativa de los 7 Ejes Solicitados

| Criterio | MiTaller iOS (`id6751720739`) | TallerPro (`tallerpro.com.ar`) | AppTaller (`proyectonube.com`) | Mi Taller (`mitaller.app`) | **MiTallerApp / Crash Solution (Objetivo)** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Organización de módulos** | 4 módulos ligeros (Clientes, Vehículos, Presupuestos, Catálogo). | ERP completo (OT, Stock, Caja, Facturación, Portal). | 5 módulos operativos (Clientes, Vehículos, OT, Presupuestos, Pagos). | Suite modular (Recepción, OT, Stock, Finanzas, Turnos). | **Flujo ágil de 3 pasos (Ingreso → Revisión → Presupuesto) + Stock + Perfil + Admin.** |
| **2. Experiencia de usuario** | Rápida, táctil, listas predefinidas. | Administrativa, orientada a gestión diaria completa. | Sencilla, baja fricción para dejar el papel. | Guiada por zonas del vehículo y estados visuales. | **Esquema visual interactivo por carrocería + controles táctiles grandes (>=44px).** |
| **3. Gestión de clientes** | Agenda vinculada a vehículos. | Base de clientes con cuenta corriente y WhatsApp. | Ficha de cliente con historial de órdenes. | Ficha de cliente con notificaciones por WhatsApp. | **Autocompletado inteligente por patente + contacto directo por WhatsApp.** |
| **4. Gestión de vehículos** | Ficha básica + historial de presupuestos. | Historial por patente, kilometraje y síntomas. | Búsqueda por patente e historial de servicios. | Recepción por zonas, fotos, kilometraje y carrocería. | **4 siluetas de carrocería (Sedán, Coupé, Pickup, Van), 11 zonas y fotos comprimidas.** |
| **5. Presupuestos** | PDF con logo, ítems y totales automáticos. | Mano de obra + repuestos + impuestos, envío WhatsApp. | Presupuesto imprimible y seguimiento por QR/link. | PDF profesional + resumen por WhatsApp. | **Doble vía: Texto estructurado en WhatsApp + PDF profesional con Logo/CUIT/Datos del taller.** |
| **6. Inventario** | Catálogo de precios de tareas/repuestos. | Stock general con alertas de mínimo y proveedores. | Cargos básicos en orden de trabajo. | Stock con alertas de mínimo y vínculo con órdenes. | **Stock especializado para taller (pinturas, insumos, repuestos con compatibilidad Marca/Modelo/Año/Lado) y movimientos auditados.** |
| **7. Uso desde celulares** | App nativa iOS. | Web responsive en la nube. | Web responsive en la nube. | Web mobile-first adaptable. | **PWA instalable con soporte Offline (IndexedDB + Service Worker + Cola de sincronización).** |

---

## 4. Mejoras Concretas Detectadas e Incorporadas a MiTallerApp / Crash Solution

A partir del estudio comparativo, se identifican las siguientes mejoras de alto impacto para nuestro proyecto:

1. **Identidad fiscal y comercial completa en el PDF (inspirado en buenas prácticas del sector — DEV-19 y DEV-25):**
   - Los talleres en Argentina necesitan que el presupuesto en PDF incluya **Logo del taller, Nombre comercial, Razón social, CUIT, Teléfono, WhatsApp, Correo, Dirección y datos de contacto**, diferenciando claramente que es un presupuesto no válido como factura fiscal.
2. **Compatibilidad vehicular en el inventario de repuestos (diferenciador clave para DEV-22):**
   - Mientras que los sistemas genéricos manejan el inventario solo por código y nombre, en un taller de chapa, pintura y mecánica es crítico filtrar repuestos por **Marca, Modelo, Rango de años y Posición/Lado** (ej. *Espejo derecho*, *Guardabarros delantero izquierdo*), además de controlar unidades de medida para insumos y pinturas (`litros`, `ml`, `kg`, `unidades`, `paquetes`).
3. **Inserción rápida desde Stock hacia el Presupuesto (sinergia DEV-22 + DEV-25):**
   - Permitir que al armar un presupuesto el taller pueda tanto escribir ítems libres como **seleccionar productos o repuestos existentes de su inventario** con su precio de venta actualizado.
4. **Doble modalidad de envío por WhatsApp transparente para el usuario (DEV-25):**
   - Separar claramente la **Opción A (Mensaje de texto formateado listo para enviar por `wa.me`)** de la **Opción B (Generación de archivo PDF real descargable o compartible mediante `navigator.share` en celulares)**, informando con precisión qué acción se realizó sin simular envíos automáticos silenciosos.
5. **Operación continua en zonas del taller sin señal Wi-Fi/4G (diferenciador técnico — DEV-26):**
   - A diferencia de los SaaS puramente online que fallan dentro de galpones o subsuelos sin cobertura, implementar persistencia local en **IndexedDB** + **Cola de sincronización idempotente** hacia Supabase al recuperar conexión.
