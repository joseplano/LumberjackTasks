# Ticket Sync — sincronización automática con el sistema de tickets

Configuración para que Claude Code sepa, en cada sesión de cualquier repo donde el plugin `lumberjack-tasks` esté instalado, que el trabajo se registra en el sistema de tickets Lumberjack Tasks vía MCP: crear el proyecto si no existe (preguntando antes), resolver o crear labels, agrupar bajo una fase cuando el trabajo lo amerita, crear los tickets antes de codear y moverlos por el tablero a medida que avanza.

Todo lo que sigue vive en `plugin/` de este repo y se distribuye como plugin de Claude Code (ver `README.md` para el flujo de instalación). El plugin se instala **una vez por máquina** — `/plugin install lumberjack-tasks@lumberjack-tasks` — y a partir de ahí aplica a todos los repos que abras, no solo a este. Lo único que sigue siendo por-repo es el opt-in: ningún repo queda "enganchado" al sistema de tickets hasta que corrés `/ticket-init` en él.

## Las tres piezas y por qué cada una

### 1. `.claude/ticket-project.json` — el mapeo (la memoria durable, y lo único que vive en cada repo)

```json
{
  "projectId": "5bf75684-....",
  "projectName": "Test Kanban",
  "standardLabels": { "feature": "#2563eb", "bug": "#dc2626", "...": "..." }
}
```

**Por qué un archivo:** el vínculo repo → proyecto de tickets tiene que sobrevivir a cada sesión y viajar con el repo (se commitea a git, así todo el equipo comparte el mismo proyecto). La memoria interna de Claude es personal y no versionada; un archivo en el repo es la única fuente de verdad compartida.

**Por qué es lo único por-repo:** la skill, el hook y el script de tokens son código genérico — no cambian de un repo a otro, así que viven una sola vez en el plugin. Lo que sí es específico de cada repo es a qué proyecto de tickets está enganchado, y eso es exactamente lo que guarda este archivo. Lo escribe `/ticket-init` (comando del plugin) la primera vez; nadie lo copia a mano.

### 2. La skill `lumberjack-tasks:ticket-sync` — el cerebro del workflow

Vive en `plugin/skills/ticket-sync/SKILL.md` y se instala junto con el resto del plugin. Contiene el procedimiento completo: verificar el mapeo, buscar el proyecto con `list_projects`, **preguntar al usuario** antes de crear proyecto o labels, resolver la fase (opcional) del trabajo, crear ticket padre + subtickets antes de implementar, y mover subtickets antes que el padre. Las herramientas MCP que usa quedan namespaced por el plugin: `mcp__plugin_lumberjack-tasks_lumberjack-tasks__*`.

**Por qué una skill y no un hook:** el workflow necesita razonamiento (¿este proyecto existente matchea?, ¿qué label aplica?, ¿qué complejidad?, ¿esto amerita agruparse bajo una fase?) e interacción con el usuario (¿creo el proyecto?, ¿con qué nombre?). Un hook es un script determinístico sin LLM: no puede decidir ni preguntar. La skill sí, y además se dispara sola cuando la tarea coincide con su descripción.

**Por qué no un subagente:** los subagentes no pueden hacerle preguntas al usuario a mitad de ejecución — y preguntar antes de crear proyectos/labels es un requisito. Las decisiones quedan en el loop principal; si algún día crear muchos tickets consume demasiado contexto, la skill puede delegar solo la parte mecánica a un subagente.

### 3. Hook `SessionStart` (provisto por el plugin) — el recordatorio (la garantía)

El plugin declara un hook `SessionStart` (`plugin/hooks/hooks.json`) que ejecuta `plugin/scripts/ticket-project-context.mjs` al inicio de cada sesión, en **cualquier repo**. El script busca `.claude/ticket-project.json` en el repo actual:

- **No existe** (el repo nunca hizo `/ticket-init`): el hook no imprime nada y no escribe nada. Esto es intencional — el plugin se instala una sola vez y se abre en decenas de repos; la mayoría no usan tickets, y el hook tiene que ser invisible en ellos.
- **Existe**: inyecta una línea de contexto ("este repo usa el proyecto X, usá ticket-sync") y, además, el comando exacto y absoluto para medir tokens reales (ver más abajo) — así la skill nunca tiene que adivinar dónde vive el script.

**Por qué el hook:** la skill es inteligente pero su activación depende de que el modelo la relacione con la tarea. El hook es determinístico: corre *siempre*, en cada sesión, sin depender de la memoria ni del criterio del modelo. Es la pieza que resuelve el problema real ("que no se olvide nunca"). No duplica lógica: solo apunta a la skill.

**Por qué silencioso por defecto:** antes, este hook se copiaba a mano en cada repo que lo quería, así que "estar presente" ya implicaba "opt-in". Ahora que el plugin es una instalación única y global, esa señal desaparece — el hook corre en todos lados. La única forma de que un repo no-enganchado quede intacto es que el hook chequee el mapeo y, si no está, no toque nada (ni imprima contexto ni escriba archivos).

### Jerarquía: Fase → Ticket → Subtarea

Para trabajo que abarca varios tickets (una feature grande, por ejemplo), la skill los agrupa bajo una **fase** con la herramienta `manage_phases` (acciones `list | create | update | reorder | delete`). Las fases son **opcionales**: tareas chicas o de un solo ticket no necesitan una.

- El `phaseId` se pasa en `create_ticket` / `update_ticket`, y solo en el ticket padre (el nivel "Ticket" de la jerarquía).
- `create_subticket` / `update_subticket` (nivel "Subtarea") **nunca** reciben `phaseId` — el backend lo rechaza con `400 SUBTASK_PHASE`. Las subtareas heredan la fase de su ticket padre.
- Borrar una fase que todavía tiene tickets requiere `force=true`; forzar **desasigna** los tickets de la fase, nunca los borra.

## Uso

- **Automático:** no hay que hacer nada. Al iniciar sesión el hook inyecta el contexto y, cuando pidas trabajo nuevo, Claude usa la skill: crea los tickets antes de codear y los va moviendo (In development → In testing → In Human review → Done → Committed).
- **Manual:** decile "usá ticket-sync" o "creá los tickets de esto" para forzarlo.
- **Repo nuevo sin mapeo:** corré `/ticket-init` (comando del plugin) para optar el repo. Lista los proyectos existentes, y si ninguno matchea te pregunta si crea uno y con qué nombre — nunca crea proyectos ni labels sin tu confirmación. Escribe `.claude/ticket-project.json` y agrega las dos entradas de `.gitignore`; el mapeo queda activo desde la próxima sesión. Sin este paso, el hook se queda callado y la skill no tiene con qué engancharse — es el opt-in explícito del repo.
- **Optar por no usarlo:** si en una tarea decís explícitamente "sin tickets", Claude lo saltea para esa tarea.
- **Trabajo grande, varios tickets:** Claude ofrece agruparlos bajo una fase (`manage_phases`) antes de crearlos. Para una tarea chica y puntual no hace falta — las fases son opcionales.

## Cómo llevarlo a otro repo

Ya no hay nada que copiar a mano. El plugin se instala una vez por máquina y aplica a todos los repos:

```
/plugin marketplace add <tu-usuario>/lumberjack-tasks
/plugin install lumberjack-tasks@lumberjack-tasks
```

Eso trae la skill, el hook `SessionStart` y el registro del servidor MCP. Después, en **cada** repo que quieras trackear (incluido el primer repo donde instalaste el plugin):

```
/ticket-init
```

Ese comando escribe `.claude/ticket-project.json` y agrega al `.gitignore` del repo los dos archivos de estado por máquina (`.claude/.session-state.json`, `.claude/.session-tokens-state.json`). Es el único archivo que sigue siendo por-repo — ver la sección de arriba sobre por qué.

Requisito: que el stack esté levantado (`docker compose up -d` en este repo) y que el MCP responda en la URL que el plugin usa por defecto (`http://127.0.0.1:5000/mcp`); para un stack hosteado en otro lado, `export LUMBERJACK_TASKS_MCP_URL=...` antes de abrir Claude Code (ver `README.md`).

## Cómo está armado el plugin, y las cuatro trampas

Todo esto está verificado experimentalmente, y ninguna de las cuatro está documentada por Claude Code. Las tres primeras fallan **en silencio**: no hay error, simplemente algo deja de existir.

### 1. El manifiesto declara SOLO `mcpServers`

`plugin/.claude-plugin/plugin.json` no debe declarar `"hooks"` ni `"skills"`. Esas rutas (`hooks/hooks.json`, `skills/`) se cargan **solas**; declararlas produce `Duplicate hooks file detected` → `hook-load-failed`, y el efecto colateral —que no tiene ninguna relación aparente con la causa— es que **se deshabilita el servidor MCP del plugin**. Los tickets dejan de funcionar y el mensaje de error habla de hooks.

Nos pasó: en el primer intento el MCP no cargaba y casi le echamos la culpa al transporte HTTP, que era inocente.

### 2. El `bin/` del plugin NO se agrega al PATH

Por eso `session-tokens.mjs` no se expone como ejecutable. La ruta llega por otro lado: el hook `SessionStart`, que sí conoce su propia ubicación vía `${CLAUDE_PLUGIN_ROOT}`, **imprime el comando completo y absoluto** en el contexto, y la skill lo corre textual. Es también la razón por la que la skill tiene prohibido armar la ruta a mano: `${CLAUDE_PLUGIN_ROOT}` está garantizada en hooks y en la config del MCP, pero **no** dentro de una llamada Bash que hace el modelo.

### 3. Un MCP registrado a mano tapa al del plugin

Claude Code deduplica **por URL**: si existe un servidor configurado manualmente apuntando a la misma URL que el del plugin, suprime el del plugin (`Suppressing plugin MCP server ...: duplicates manually-configured ...`). Sus tools siguen apareciendo con los nombres viejos sin prefijo, que no son los que la skill espera. Si venís de la época en que el MCP se registraba a mano, borralo por el nombre con el que lo hayas registrado — antes del rename del producto era `claude-ticket`: `claude mcp remove claude-ticket`.

### 4. Los nombres cambian al empaquetar

| Pieza | Suelta | Dentro del plugin |
|---|---|---|
| Tools del MCP | `mcp__lumberjack-tasks__<tool>` | `mcp__plugin_lumberjack-tasks_lumberjack-tasks__<tool>` |
| Skill | `ticket-sync` | `lumberjack-tasks:ticket-sync` |
| Comando | `/ticket-init` | `/lumberjack-tasks:ticket-init` |

La skill y `/ticket-init` referencian esos nombres por texto, así que un rename del plugin o del servidor MCP obliga a actualizarlos.

### Tests

```bash
node --test plugin/tests/*.test.mjs
```

Con el glob, no con la forma de directorio (`node --test plugin/tests` falla con `MODULE_NOT_FOUND` en Windows/Git Bash). El plugin se copia tal cual a la máquina del usuario, así que **no puede tener dependencias ni `node_modules`**: los tests usan el runner nativo de Node.

## Medición real de tokens por ticket

Los campos `tokensConsumed`/`llmName` de los tickets no se llenan solos: alguien tiene que reportarlos. La pieza que lo automatiza es `plugin/scripts/session-tokens.mjs`, que lee el **transcript real de la sesión** de Claude Code (el JSONL en `~/.claude/projects/<repo>/` donde queda registrado el `usage` exacto de cada llamada a la API) y suma por modelo.

- **Qué cuenta:** input + creación de caché + output ("tokens nuevos"). Excluye las relecturas de caché, que repiten el mismo contexto en cada turno e inflarían el número (en una sesión típica son >30x los tokens nuevos).
- **`--consume`:** devuelve el delta desde el último checkpoint y lo reinicia — es lo que la skill usa como `tokensDelta` al mover un ticket, así cada gasto se registra exactamente una vez.
- **`--since` / `--until`:** suma solo una ventana temporal, sin tocar el checkpoint — sirve para atribuir retroactivamente trabajo pasado con `update_ticket`.
- **`--project-dir`:** el script vive en el plugin (una sola copia, compartida por todos los repos), no en el repo donde se está trabajando — así que el repo hay que pasárselo explícitamente. Sin este flag, el checkpoint y el estado de sesión terminarían escribiéndose dentro del propio plugin y mezclando el consumo de todos los repos en un solo lugar. Es justo el bug que este esquema evita: no hay forma de "adivinar mal" el repo porque nunca se infiere de `import.meta.url`.
- **Cómo sabe cuál es el transcript:** el hook `SessionStart` recibe `transcript_path` por stdin y lo guarda en `<repo>/.claude/.session-state.json` (gitignoreado, por máquina). Sin ese archivo, cae al `.jsonl` más reciente del proyecto.
- **No hace falta memorizar la ruta del script:** el hook `SessionStart`, cuando el repo está mapeado, imprime el comando completo y absoluto (con `--project-dir` ya resuelto al repo actual) como parte de su contexto. La skill corre ese comando tal cual, textual — nunca arma la ruta a mano.

**Por qué así y no de otra forma:** el modelo no ve su propio consumo desde adentro de la conversación, así que cualquier número que "recuerde" sería un invento. El transcript es la fuente de verdad que Claude Code ya escribe solo; leerlo da números exactos sin instrumentación extra (la alternativa industrial sería OpenTelemetry, que Claude Code también soporta, pero requiere infraestructura de métricas).

### Uso

Todos los comandos necesitan `--project-dir <repo>` cuando se corren a mano (la skill ya lo recibe resuelto del hook). La salida siempre es JSON con el total, el modelo dominante y el desglose por modelo:

```bash
# ¿Cuántos tokens lleva gastados esta sesión, en este repo?
node <ruta-al-plugin>/scripts/session-tokens.mjs --project-dir /ruta/absoluta/al/repo
```

```json
{
  "tokens": 315486,
  "llmName": "claude-fable-5",
  "perModel": {
    "claude-fable-5": {
      "tokens": 315486,      // input + cacheCreation + output
      "input": 9875,
      "cacheCreation": 225123,
      "cacheRead": 11684258,  // informativo; NO cuenta en "tokens"
      "output": 80488,
      "messages": 92
    }
  },
  "transcript": "<home>/.claude/projects/<repo-slug>/<sesión>.jsonl"
}
```

```bash
# Delta desde el último registro, y resetea el checkpoint (registrar UNA vez por gasto)
node <ruta-al-plugin>/scripts/session-tokens.mjs --project-dir /ruta/absoluta/al/repo --consume

# Solo una ventana temporal (UTC), sin tocar el checkpoint
node <ruta-al-plugin>/scripts/session-tokens.mjs --project-dir /ruta/absoluta/al/repo --since 2026-07-03T13:00:00Z --until 2026-07-03T14:00:00Z

# Un transcript específico (p.ej. una sesión vieja)
node <ruta-al-plugin>/scripts/session-tokens.mjs --project-dir /ruta/absoluta/al/repo --transcript "C:/Users/<usuario>/.claude/projects/<repo>/<id>.jsonl"
```

### Los tres flujos típicos

1. **Automático (lo normal):** no hacés nada. La skill ticket-sync corre `--consume` justo antes de mover un ticket y pasa el resultado como `tokensDelta` + `llmName` en el `move_ticket`. El total queda acumulado en el ticket y visible en los reportes del proyecto.
2. **Consulta manual:** corré el script solo con `--project-dir` cuando quieras saber cuánto lleva la sesión. No afecta ningún registro.
3. **Atribución retroactiva:** trabajo viejo sin tokens cargados → identificá la ventana horaria (los tickets tienen `createdAt`/`updatedAt` como referencia), corré `--since/--until`, y cargá el resultado con `update_ticket` (o pedíselo a Claude: "cargale al ticket #N los tokens reales de tal a tal hora").

### Problemas comunes

| Síntoma | Causa y solución |
|---|---|
| `No transcripts found` | El fallback busca en `~/.claude/projects/<slug-del-repo>/`; si el repo se movió de carpeta el slug cambia. Pasá el transcript a mano con `--transcript`. |
| Delta de `--consume` enorme | Primer uso en una sesión: el delta es toda la sesión (no había checkpoint). Es correcto; los usos siguientes ya son incrementales. |
| Delta de `--consume` da 0 | Ya se consumió todo en un registro anterior (el checkpoint está al día). No es un error. |
| Tokens de otro trabajo mezclados | El checkpoint es por sesión, no por ticket: si en una misma sesión se trabajaron dos tareas sin `--consume` entre medio, el delta las junta. Separá con `--since/--until`. |
| El número no incluye los últimos mensajes | Inherente: lo gastado *después* de medir cae en el próximo registro. |
| El `transcript` devuelto no es el de tu sesión | Correr `claude -p` (headless) dentro de un repo mapeado dispara su propio `SessionStart`, que **pisa** `.claude/.session-state.json` con el transcript de esa sesión efímera. El siguiente `--consume` mide la sesión headless, no la tuya. Pasá tu transcript con `--transcript` (mirá el campo `transcript` de la salida para confirmar cuál usó). |
| No aparece ninguna tool de tickets en la sesión | O el stack estaba caído al arrancar Claude (reconectá con `/mcp`; los MCP se conectan al inicio de sesión), o hay un MCP registrado a mano tapando al del plugin (trampa 3 más arriba). |

## Notas

- Un `/ticket-init` recién corrido se activa en la **próxima sesión** (o abriendo `/hooks` en la actual): la configuración de hooks se carga al inicio.
- `/plugin update lumberjack-tasks@lumberjack-tasks` actualiza la skill, el hook y el script de tokens en un solo lugar — todos los repos que usan el plugin ven la nueva versión de una, no hace falta re-copiar nada en cada uno.
- Si el servidor MCP está caído, la skill no bloquea el trabajo de código: lo avisa y deja listadas las operaciones de tickets pendientes.
- Labels estándar sugeridas: `feature` azul, `bug` rojo, `refactor` violeta, `docs` verde, `test` naranja, `infra` gris. La skill crea solo la que necesita cada tarea, no todo el set de una.
