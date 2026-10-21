> MERGED into cv.md on 2026-10-22 (facts without [confirmar] markers and Part B). Items still marked [confirmar] were left out of the knowledge base until confirmed.

# Borrador: profundidad técnica y opiniones de diseño

Este archivo NO se indexa. Es una propuesta de contenido para pasar a `cv.md` una vez revisada.
Todo lo marcado con **[confirmar]** es una suposición razonable que debes validar, corregir o borrar.
Lo que no lleve marca sale de tu CV actual. Las secciones de "Cómo diseñaría" son opinión en tu voz.

---

## Parte A · Profundidad técnica de las historias

### A1. El modelo que mintió (SmartCoach) · honesty invariant

**Qué pasó.** Un usuario pidió guardar un plan de entrenamiento. El modelo respondió "listo, guardado" sin haber
llamado a la tool `save_workout_plan`. El plan nunca se escribió. **[confirmar: nombre real de la tool y modelo que
lo hizo; sospecho que fue Claude Haiku 4.5 o DeepSeek en el bake-off]**

**Cómo detecta hoy una afirmación sin respaldo.**
- Después de cada turno, el servidor compara el texto final con el registro de tool calls del turno.
- Un clasificador ligero marca frases de "acción completada" (guardado, actualizado, eliminado, programado) en
  español e inglés. **[confirmar: ¿regex + lista de verbos, o una llamada a un modelo barato?]**
- Si hay una frase de acción y no existe una tool call exitosa del tipo correspondiente en ese turno, el servidor
  reescribe la respuesta con una corrección ("Todavía no he guardado el plan. ¿Quieres que lo guarde ahora?") y
  no descuenta cuota al usuario. **[confirmar: ¿se reescribe o se añade una nota?]**

**Falsos positivos que tuvo y cómo los manejas.**
- Frases condicionales o de futuro ("cuando lo confirmes lo guardo") disparaban el detector. Solución: excluir
  modo futuro/condicional y frases que mencionan la confirmación. **[confirmar]**
- Resúmenes de acciones de turnos anteriores ("ya guardamos tu plan ayer") se marcaban como no respaldadas.
  Solución: ventana de verificación acotada al turno actual, con la lista de acciones de la sesión como contexto.
  **[confirmar]**

**Qué mide.** Tasa de "claims sin respaldo" por modelo en el harness de evals (12 flujos / 24 turnos). Antes de la
corrección: X % en DeepSeek V4 Flash, Y % en Haiku 4.5. Después: 0 en ambos. **[confirmar cifras o quitar]**

**Por qué es agnóstico de modelo.** Vive en el servidor y trabaja sobre el trace de tool calls, no sobre el
prompt. Cambiar de modelo no exige reescribirlo; solo recalibrar la lista de verbos. **[confirmar]**

### A2. 87 % menos coste · el bake-off y sus casos fallidos

- Golden set: 17 casos que cubren onboarding, generación de plan de comidas, plan de entrenamiento, modificación
  en sitio, confirmación y undo. **[confirmar: qué categorías]**
- Resultado: Haiku 4.5 17/17 **[confirmar]**, GLM-4.6 N/17, Kimi K2.6 N/17, DeepSeek V4 Flash 15/17.
- Los dos fallos de DeepSeek: (1) **[confirmar: p. ej. argumentos de tool con unidades incorrectas]**; (2)
  **[confirmar: p. ej. cerrar el turno sin llamar a la tool de confirmación]**.
- Inestabilidad: al repetir el set, DeepSeek variaba entre 13 y 15 aciertos. Por eso el harness sucesor corre cada
  flujo N veces contra una base de datos desechable en Docker y puntúa sobre las trazas de API, no sobre el texto.
  **[confirmar N]**
- Migración con red: fallback automático a Haiku 4.5 cuando DeepSeek devuelve un tool call inválido o un
  timeout; Gemini 2.5 Flash para fotos y audio. Coste medido: ≤ 2 USD por usuario Premium activo al mes.

### A3. Prompt caching y atribución de coste (AiKit)

- Breakpoints de caché: uno al final del system prompt (reglas + catálogo de herramientas) y otro al final del
  contexto de conocimiento recuperado; el historial de la conversación queda fuera para que el prefijo sea estable.
  **[confirmar: dónde están exactamente los `cache_control`]**
- Caché "rolling": en cada turno se mueve el breakpoint al último mensaje confirmado, de modo que el turno siguiente
  reutiliza todo el prefijo. Aplicado a todos los modelos de Anthropic del catálogo.
- Fórmula de coste por turno: `input_no_cacheado × p_in + cache_write × p_write + cache_read × p_read + output × p_out`,
  con precios por modelo desde el catálogo. Los tokens de escritura de caché se registran aparte porque son más
  caros que la entrada normal y antes se contabilizaban como entrada. **[confirmar]**
- Atribución: cada petición lleva org, usuario, hilo y modelo; el coste se agrega por organización para el panel de
  uso y los planes. En failover a otro proveedor, el coste se atribuye al proveedor que realmente respondió, no al
  solicitado. **[confirmar failover]**

### A4. Auditoría de seguridad del backend (AiKit)

- Método: revisión manual de rutas y hooks de Payload CMS, pruebas con dos usuarios de organizaciones distintas y
  scripts de reproducción por hallazgo; 30+ tickets en Linear con severidad y prueba de regresión. **[confirmar]**
- Hallazgos y arreglos, en orden de severidad:
  1. Colecciones REST modificables por su propietario saltándose los handlers (campos sensibles): política de
     acceso por campo y validación en hooks `beforeChange`. **[confirmar detalle]**
  2. Fallo "fail-open" en autenticación: un error en la comprobación dejaba pasar la petición; ahora cualquier
     error cierra. **[confirmar]**
  3. Sesiones no revocadas al cambiar contraseña o email: versión de sesión en el usuario y revocación global.
  4. Verificación de cambio de email y protección de "olvidé mi contraseña" contra abuso (límite y token de un uso).
  5. CORS por subcadena ("ejemplo.com" aceptaba "ejemplo.com.evil"): lista exacta de orígenes.
  6. URLs firmadas de archivos sin comprobar el propietario: firma con el id del propietario.
  7. Lost updates en rutas read-merge-write: actualizaciones atómicas o versión optimista. **[confirmar]**
- Sin tiempo de inactividad: despliegues por fases con feature flags por organización.
- Además se retiraron ~8.500 líneas de código muerto.

### A5. Walmart · del bot de DialogFlow al RAG

- 2021: DialogFlow para intents de onboarding de vendedores + NestJS como backend + Infobip para WhatsApp.
- 2024: asistente de RR. HH. con RAG. Ingesta de PDFs y HTML a LanceDB, chunking por secciones de N tokens
  **[confirmar tamaño]**, embeddings **[confirmar modelo]**, top-k con umbral y respuesta con citas. Métrica: tasa de
  consultas sin respuesta antes/después **[confirmar cifras o describir cualitativamente]**.

---

## Parte B · "Cómo diseñaría…" (opinión en tu voz)

> Marcar en cv.md como "Opiniones de diseño (escritas por Cristhian)". El verificador debe tratarlas como opinión.

### B1. RAG a escala (millones de documentos)
Empezaría por el problema de recuperación, no por el modelo. Ingesta incremental con deduplicación por hash,
chunking por estructura del documento (no por tamaño fijo) y metadatos de origen y fecha. Búsqueda híbrida
(BM25 + vectores) con fusión de rangos y un reranker ligero solo sobre el top-50. Índice vectorial en Postgres con
pgvector mientras quepa en una instancia; pasar a un servicio dedicado solo cuando la latencia p95 lo exija.
Caché de embeddings de consultas y de respuestas por tenant. Evaluación continua con recall@k sobre un conjunto
dorado de preguntas con sus chunks esperados, y "faithfulness" juzgada por un modelo sobre una muestra diaria.
La lección de Walmart y AiKit: la mayoría de los fallos de RAG son de recuperación o de chunking, no del LLM.

### B2. Un agente que opera un ERP sin riesgo
Nunca escritura directa. Tres capas: (1) tools de lectura amplias y tools de escritura mínimas y tipadas con Zod;
(2) patrón vista previa / confirmación: la tool de escritura genera un borrador que el humano aprueba, como hice con
las facturas de proveedor en Odoo y con los planes de SmartCoach; (3) invariantes en el servidor: deduplicación por
clave natural, idempotencia por id de operación, límites por rol y registro de auditoría con el prompt, el tool call
y el resultado. Y un conjunto de evals con intentos de abuso (inyección en documentos, instrucciones en correos)
que corre antes de cada despliegue.

### B3. Qué haría distinto en SmartCoach
Empezar con el harness de evals desde el primer mes, no después del incidente. Menos tools más generales (27 es
demasiado para mantener) con un router de intención más estricto. Streaming de UI estructurada en lugar de texto
desde el día uno. Y medir coste por usuario desde la primera semana, que fue lo que al final decidió el modelo.

### B4. Riesgos de DeepSeek (o cualquier modelo barato) en producción
Residencia de datos y cumplimiento (dónde se procesan los prompts), estabilidad entre versiones del modelo,
variabilidad entre ejecuciones y soporte desigual de tool calling. Mi regla: nunca un solo proveedor en producción.
Catálogo con fallback automático, evals que corren contra cada modelo nuevo antes de habilitarlo, y atribución de
coste y calidad por modelo para poder revertir con datos.

### B5. Cómo evalúo la calidad de un sistema LLM
Tres niveles: tests deterministas sobre tool calls (argumentos, orden, idempotencia), métricas de recuperación
(recall@k, MRR) con conjuntos dorados, y jueces LLM con rúbrica para fundamentación y utilidad, calibrados contra
etiquetas humanas en una muestra. Todo con coste y latencia por caso, porque una mejora de calidad que duplica el
coste es una decisión de producto, no de ingeniería.

---

## Sugerencias "muy PRO" para el sitio y la candidatura

1. **Publica el harness de evals de SmartCoach con datos sintéticos** como repo público y enlázalo desde el chat.
   Es la prueba más fuerte de tu diferencial y hoy es invisible.
2. **Un post técnico del bake-off** (los 15/17, la inestabilidad, el harness repetible) en LinkedIn y enlazado
   desde la story. El sugeridor puede proponer "¿dónde leo más?" y el bot enlazarlo.
3. **Historias con números verificables**: cada story con 2 o 3 métricas (antes/después, p95, coste). El
   verificador podrá contrastarlas y el entrevistador las recordará.
4. **Sección "Opiniones de diseño"** (Parte B) para que el bot razone en tu voz en lugar de decir "pregúntale".
5. **Caso de uso de MCP en vivo**: un vídeo de 60 segundos de Claude Desktop usando tu CV por MCP, embebido en la
   ventana MCP. Para un hiring manager técnico es lo más memorable.
6. **Evals persistidos con juez** (siguiente paso acordado): el informe de bake-off entre modelos visible sin
   ejecutar nada, con fecha y rúbrica.
7. **Changelog público del sitio** ("qué cambió esta semana") al pie de la home: demuestra cadencia de entrega.
8. **Un modo "entrevista de 5 minutos"**: botón que lanza en secuencia las cuatro preguntas que más venden
   (resumen, logro mayor, historia del modelo que mintió, encaje para el puesto X) y acaba en la tarjeta de contacto.
