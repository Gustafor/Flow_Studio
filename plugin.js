/**
 * Flow Studio — DAG workflow builder for Hermes Desktop.
 * Save location (already correct): <hermes home>/desktop-plugins/flow-studio/plugin.js
 *
 * What it does:
 *  - Flows: create / rename / delete; persisted (ctx.storage + localStorage fallback), survive restarts.
 *  - Steps (BPMN-style types): agent (task) / exclusive gateway (XOR) with
 *    prioritized branches / parallel gateway (AND) / output (end event).
 *  - Step fields: name, system prompt, input template with {{Step Name}} substitution,
 *    tools list (read / write / web_search), "runs after" DAG dependencies (cycles prevented).
 *  - Tabs: Editor -> Graph (auto SVG layout by DAG levels, arrows, color by type) -> JSON
 *    (copy, download as file, import by paste).
 *  - EN/RU switch in the header (default: app/browser language, choice remembered).
 *  - "Copy launch brief" button — assembles a ready-to-run task for the chat from the graph.
 *
 * Plain ESM, loaded uncompiled: UI is jsx()/jsxs() calls, no JSX syntax.
 * Only imports: @hermes/plugin-sdk, react, react/jsx-runtime.
 */

import { host, haptic, ROUTES_AREA, SIDEBAR_NAV_AREA, PALETTE_AREA } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useSyncExternalStore, useMemo, useState, useRef, useEffect } from 'react'

const ID = 'flow-studio'
const FLOW_PATH = '/flow-studio'
const TOOLS = ['read', 'write', 'web_search']
const STEP_TYPES = ['agent', 'exclusive', 'parallel', 'output']
const TYPE_COLOR = { agent: '#4f9cff', exclusive: '#f0a020', parallel: '#b18cff', output: '#3ecf8e' }
const TYPE_META = {
  agent: { icon: '▶', labelKey: 'typeAgent', descKey: 'descAgent', color: '#4f9cff' },
  exclusive: { icon: '◆', labelKey: 'typeExclusive', descKey: 'descExclusive', color: '#f0a020' },
  parallel: { icon: '⬨', labelKey: 'typeParallel', descKey: 'descParallel', color: '#b18cff' },
  output: { icon: '◉', labelKey: 'typeOutput', descKey: 'descOutput', color: '#3ecf8e' },
}

// ---------------------------------------------------------------- i18n

const STR = {
  en: {
    app: 'Flow Studio',
    tabEditor: 'Editor', tabGraph: 'Graph', tabJson: 'JSON',
    newFlow: 'New flow', flowDefault: 'New flow',
    createFlow: 'Create a flow',
    createFlowHint: 'Create a flow, add steps, wire them into a DAG, then copy the launch brief into the chat.',
    noSteps: 'No steps yet — add the first one.',
    pickStep: 'Select a step on the left to edit it.',
    stepName: 'Step name', typeLabel: 'Type',
    typeAgent: 'Agent', typeExclusive: 'Exclusive gateway', typeParallel: 'Parallel gateway', typeOutput: 'Output',
    descAgent: 'Task: an agent (LLM) works by the system prompt with the selected tools; its result is substituted into other steps as {{Step Name}}.',
    descExclusive: 'Exclusive gateway (XOR): branches are checked in priority order (top to bottom); only the first branch with a true condition runs, otherwise the default branch.',
    descParallel: 'Parallel gateway (AND): the flow splits into branches that run in parallel; it continues when all branches are done.',
    descOutput: 'End of flow: assembles the final answer from the results of previous steps — answer template, format, extra instruction, and step results attached as appendices.',
    typeHint: 'The type determines what happens when the flow reaches this step.',
    branches: 'Branches (priority order, top to bottom)',
    branchCondPh: 'Condition (yes/no, or a description)…',
    branchDefault: 'default (if none fit)',
    addBranch: 'Add branch',
    briefBranches: 'Branches (priority):',
    briefDefault: 'default',
    briefParallelRuns: 'Runs in parallel:',
    outAnswer: 'Final answer (template)',
    outAnswerPh: 'Compose the final answer, e.g.: “Result: {{Research}}”',
    outAnswerHint: '{{Step Name}} substitutes the result of another step. Leave empty — the final answer is the result of the last executed step.',
    outFormat: 'Answer format',
    outFormatMd: 'Markdown',
    outFormatPlain: 'plain text',
    outInstr: 'Extra instruction',
    outInstrPh: 'e.g.: summarize in no more than 10 bullets, in Russian',
    outAppend: 'Appendices — attach step results',
    outAppendHint: 'The full results of the selected steps are appended after the final answer.',
    briefAnswer: 'Final answer',
    briefAnswerEmpty: 'result of the last executed step',
    briefFormat: 'Format',
    briefInstr: 'Instruction',
    briefAppend: 'Appendices',
    formatMd: 'Markdown',
    formatPlain: 'plain text',
    systemPrompt: 'System prompt', systemPromptPh: 'Role and rules for this step…',
    inputTemplate: 'Input template', inputTemplatePh: 'Input for the step…',
    templateHint: 'Use {{Step Name}} to insert the result of another step.',
    roles: 'Roles', rolesHint: 'Comma-separated roles that run this step (e.g. Role 1, Role 2).', rolesPh: 'Role 1, Role 2…',
    tools: 'Tools', toolRead: 'read', toolWrite: 'write', toolSearch: 'web_search',
    dependsOn: 'Runs after (dependencies)', noDeps: 'Starts first — no dependencies.',
    addStep: 'Add step', deleteStep: 'Delete step',
    copyBrief: 'Copy launch brief',
    launch: 'Launch agent', launchSent: 'Brief sent to the agent', launchFail: 'Could not send — brief copied to clipboard',
    launchHint: 'Sends the full launch brief to the current chat as a new agent turn.',
    launching: 'Launching…', launchNoSession: 'No active chat to launch in — brief copied; paste it into the composer.',
    iterations: 'Iterations', iterationsHint: 'How many times the whole sequence runs.',
    briefCopied: 'Launch brief copied to clipboard',
    briefCopiedFail: 'Copy failed — use the JSON tab to copy manually',
    noStepsForBrief: 'Add at least one step first',
    json: 'Flow JSON',
    jsonHint: 'Copy it, download it as a file, or paste JSON below to import flows.',
    jsonCopy: 'Copy JSON', jsonDownload: 'Download .json', jsonImport: 'Import from paste',
    jsonImportPh: 'Paste flow JSON: {"name":…,"steps":{…}} — a single flow, an array of flows, or {"flows":[…]}.',
    jsonImported: n => `Imported: ${n} flow(s)`,
    jsonImportError: 'Invalid JSON — check the format',
    jsonCycleError: 'DAG cycle detected — import refused',
    briefCycle: 'DAG cycle detected — build the flow without cycles first',
    jsonNoFlows: 'No flows found in the pasted JSON',
    graphEmpty: 'The graph appears once the flow has steps.',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', zoomReset: 'Reset zoom (double-click)', resetLayout: 'Reset layout',
    stepsCount: n => `${n} step${n === 1 ? '' : 's'}`,
    briefTitle: 'Launch brief',
    briefStepsWord: 'steps', briefIterWord: 'iterations',
    launchOrder: 'Execution order (DAG levels; steps within a level run in parallel):',
    stepsHeader: 'Steps:',
    sysLabel: 'System prompt', condLabel: 'Condition', inputLabel: 'Input', toolsLabel: 'Tools', rolesLabel: 'Roles',
    briefRules: 'Rules: execute steps level by level (within a level — in parallel, e.g. via parallel sub-agents). Keep every step result under the step name and substitute it for {{Step Name}} in later steps. Final answer: the result of the "output" step.',
    briefRulesNoOutput: 'Rules: execute steps level by level (within a level — in parallel, e.g. via parallel sub-agents). Keep every step result under the step name and substitute it for {{Step Name}} in later steps. Final answer: the result of the last level.',
  },
  ru: {
    app: 'Flow Studio',
    tabEditor: 'Редактор', tabGraph: 'Граф', tabJson: 'JSON',
    newFlow: 'Новый поток', flowDefault: 'Новый поток',
    createFlow: 'Создать поток',
    createFlowHint: 'Создайте поток, добавьте шаги, свяжите их в DAG, затем скопируйте бриф запуска в чат.',
    noSteps: 'Пока нет шагов — добавьте первый.',
    pickStep: 'Выберите шаг слева, чтобы редактировать.',
    stepName: 'Имя шага', typeLabel: 'Тип',
    typeAgent: 'Агент', typeExclusive: 'Шлюз «исключительный»', typeParallel: 'Шлюз «параллельный»', typeOutput: 'Вывод',
    descAgent: 'Задача: агент (LLM) работает по системному промпту с выбранными инструментами; его результат подставляется в другие шаги как {{Имя шага}}.',
    descExclusive: 'Исключительный шлюз (XOR): ветки проверяются по приоритету сверху вниз; исполняется только первая ветка с истинным условием, иначе — ветка «по умолчанию».',
    descParallel: 'Параллельный шлюз (AND): поток разбивается на ветки, которые исполняются параллельно; дальше идёт, когда все ветки закончены.',
    descOutput: 'Финиш потока: собирает итоговый ответ из результатов предыдущих шагов — шаблон ответа, формат, доп. инструкция и приложения с результатами шагов.',
    typeHint: 'Тип определяет, что происходит, когда поток доходит до шага.',
    branches: 'Ветки (приоритет сверху вниз)',
    branchCondPh: 'Условие (да/нет или описание)…',
    branchDefault: 'по умолчанию (если ни одна не подошла)',
    addBranch: 'Добавить ветку',
    briefBranches: 'Ветки (приоритет):',
    briefDefault: 'по умолчанию',
    briefParallelRuns: 'Исполняются параллельно:',
    outAnswer: 'Финальный ответ (шаблон)',
    outAnswerPh: 'Составьте итоговый ответ, напр.: «Результат: {{Анализ}}»',
    outAnswerHint: '{{Имя шага}} подставляет результат другого шага. Пусто — финальный ответ = результат последнего выполненного шага.',
    outFormat: 'Формат ответа',
    outFormatMd: 'Markdown',
    outFormatPlain: 'простой текст',
    outInstr: 'Дополнительная инструкция',
    outInstrPh: 'напр.: сведи не более чем в 10 пунктов, на русском',
    outAppend: 'Приложения — приложить результаты шагов',
    outAppendHint: 'Полные результаты выбранных шагов добавляются после финального ответа.',
    briefAnswer: 'Финальный ответ',
    briefAnswerEmpty: 'результат последнего выполненного шага',
    briefFormat: 'Формат',
    briefInstr: 'Инструкция',
    briefAppend: 'Приложения',
    formatMd: 'Markdown',
    formatPlain: 'простой текст',
    systemPrompt: 'Системный промпт', systemPromptPh: 'Роль и правила для шага…',
    inputTemplate: 'Шаблон входа', inputTemplatePh: 'Вход для шага…',
    templateHint: '{{Имя шага}} — подставляет результат другого шага.',
    roles: 'Роли', rolesHint: 'Роли, выполняющие этот шаг, через запятую (напр. Роль 1, Роль 2).', rolesPh: 'Роль 1, Роль 2…',
    tools: 'Инструменты', toolRead: 'read', toolWrite: 'write', toolSearch: 'web_search',
    dependsOn: 'Запускается после (зависимости)', noDeps: 'Запускается первым — без зависимостей.',
    addStep: 'Добавить шаг', deleteStep: 'Удалить шаг',
    copyBrief: 'Скопировать бриф запуска',
    launch: 'Запустить агента', launchSent: 'Бриф отправлен агенту', launchFail: 'Не удалось отправить — бриф скопирован в буфер',
    launchHint: 'Отправляет полный бриф запуска в текущий чат как новый ход агента.',
    launching: 'Запуск…', launchNoSession: 'Нет активного чата для запуска — бриф скопирован; вставьте его в поле ввода.',
    iterations: 'Итерации', iterationsHint: 'Сколько раз выполняется вся последовательность.',
    briefCopied: 'Бриф запуска скопирован в буфер',
    briefCopiedFail: 'Не удалось скопировать — используйте вкладку JSON',
    noStepsForBrief: 'Сначала добавьте хотя бы один шаг',
    json: 'JSON потока',
    jsonHint: 'Копируйте, скачивайте файлом или вставьте JSON ниже для импорта.',
    jsonCopy: 'Копировать JSON', jsonDownload: 'Скачать .json', jsonImport: 'Импорт из вставки',
    jsonImportPh: 'Вставьте JSON потока: {"name":…,"steps":{…}} — один поток, массив потоков или {"flows":[…]}.',
    jsonImported: n => `Импортировано: ${n} поток(а/ов)`,
    jsonImportError: 'Некорректный JSON — проверьте формат',
    jsonCycleError: 'В DAG обнаружен цикл — импорт отклонён',
    briefCycle: 'В DAG обнаружен цикл — поправьте связи без циклов',
    jsonNoFlows: 'Во вставленном JSON не найдено потоков',
    graphEmpty: 'Граф появится, когда в потоке будут шаги.',
    zoomIn: 'Приблизить', zoomOut: 'Отдалить', zoomReset: 'Сбросить масштаб (двойной клик)', resetLayout: 'Сбросить раскладку',
    stepsCount: n => {
      const m10 = n % 10, m100 = n % 100
      const w = m10 === 1 && m100 !== 11 ? 'шаг' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'шага' : 'шагов'
      return `${n} ${w}`
    },
    briefTitle: 'Бриф запуска',
    briefStepsWord: 'шагов', briefIterWord: 'итерация',
    launchOrder: 'Порядок выполнения (уровни DAG; шаги внутри уровня параллельны):',
    stepsHeader: 'Шаги:',
    sysLabel: 'Системный промпт', condLabel: 'Условие', inputLabel: 'Вход', toolsLabel: 'Инструменты', rolesLabel: 'Роли',
    briefRules: 'Правила: выполняй шаги по уровням (внутри уровня — параллельно, например через параллельные subagents). Результат каждого шага запоминай под именем шага и подставляй в {{Имя шага}} шаблонов последующих шагов. Финальный ответ — результат шага типа «вывод».',
    briefRulesNoOutput: 'Правила: выполняй шаги по уровням (внутри уровня — параллельно, например через параллельные subagents). Результат каждого шага запоминай под именем шага и подставляй в {{Имя шага}} шаблонов последующих шагов. Финальный ответ — результат последнего уровня.',
  },
}

// ---------------------------------------------------------------- store

function createStore(initial) {
  let s = initial
  const subs = new Set()
  return {
    get: () => s,
    set: v => { s = typeof v === 'function' ? v(s) : v; subs.forEach(f => f()) },
    subscribe: f => { subs.add(f); return () => subs.delete(f) },
  }
}

const store = createStore({
  ready: false,
  lang: null,            // null = auto
  flows: [],             // [{ id, name, steps: { id: step } }]
  activeFlowId: null,
  activeStepId: null,
  tab: 'editor',         // 'editor' | 'graph' | 'json'
})
function useFS() { return useSyncExternalStore(store.subscribe, store.get) }
function set(patch) { store.set(s => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) })) }

const AUTO_LANG = (typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase().startsWith('ru')) ? 'ru' : 'en'
function effLang(s) { return s.lang || AUTO_LANG }

// ---------------------------------------------------------------- persistence

let ctxRef = null
let persist = null
const STORAGE_KEY = 'data'

function initPersist() {
  const save = v => {
    try {
      const p = ctxRef.storage.set(STORAGE_KEY, v)
      if (p && p.catch) p.catch(() => {})
    } catch (e) { /* older host — localStorage fallback below */ }
    try { window.localStorage.setItem(ID + ':' + STORAGE_KEY, JSON.stringify(v)) } catch (e) {}
  }
  const snapshot = () => {
    const s = store.get()
    return { lang: s.lang, flows: s.flows, activeFlowId: s.activeFlowId }
  }
  let timer = null
  persist = {
    schedule: () => {
      if (timer) return
      timer = setTimeout(() => { timer = null; save(snapshot()) }, 200)
    },
  }
  ;(async () => {
    let v = null
    try { v = await ctxRef.storage.get(STORAGE_KEY) } catch (e) { v = null }
    if (!v) {
      try {
        const raw = window.localStorage.getItem(ID + ':' + STORAGE_KEY)
        if (raw) v = JSON.parse(raw)
      } catch (e) { v = null }
    }
    const flows = (Array.isArray(v?.flows) ? v.flows : []).map(migrateFlow)
    store.set(s => ({
      ready: true,
      lang: v?.lang ?? null,
      flows,
      activeFlowId: v?.activeFlowId ?? flows[0]?.id ?? null,
      activeStepId: null,
    }))
  })()
}

// ---------------------------------------------------------------- flow / step mutations

let _uidSeq = 0
const uid = p => p + Date.now().toString(36) + (++_uidSeq).toString(36) + Math.random().toString(36).slice(2, 6)

// Migrate stored/imported flows from the legacy model ('condition' type) to BPMN.
function migrateFlow(f) {
  const steps = {}
  for (const [k, v] of Object.entries(f.steps || {})) {
    const id = String(v?.id ?? k)
    let type = v?.type
    if (type === 'condition') type = 'exclusive'
    if (!STEP_TYPES.includes(type)) type = 'agent'
    const s = { ...v, id, type }
    if (type === 'exclusive') {
      if (!Array.isArray(s.branches)) {
        s.branches = s.condition
          ? [{ id: uid('b'), target: null, condition: String(s.condition), isDefault: true }]
          : []
      } else {
        s.branches = s.branches.map(b => ({ id: String(b?.id ?? uid('b')), target: b?.target ? String(b.target) : null, condition: String(b?.condition ?? ''), isDefault: !!b?.isDefault }))
      }
    } else {
      s.branches = undefined
    }
    steps[id] = s
  }
  const out = { id: f.id, name: f.name, iterations: Math.max(1, Math.floor(Number(f.iterations) || 1)), steps, view: normalizeView(f.view) }
  return out
}

function addFlow() {
  const f = { id: uid('f'), name: '', steps: {}, iterations: 1 }
  set(s => ({ flows: [...s.flows, f], activeFlowId: f.id, activeStepId: null, tab: 'editor' }))
  return f.id
}
function delFlow(id) {
  set(s => {
    const flows = s.flows.filter(f => f.id !== id)
    return {
      flows,
      activeFlowId: s.activeFlowId === id ? flows[0]?.id ?? null : s.activeFlowId,
      activeStepId: s.activeFlowId === id ? null : s.activeStepId,
    }
  })
}
function updFlow(flowId, fn) {
  set(s => ({ flows: s.flows.map(f => (f.id === flowId ? fn(f) : f)) }))
}
function addStep(flowId, type) {
  const flow = store.get().flows.find(f => f.id === flowId)
  if (!flow) return
  const n = Object.keys(flow.steps).length + 1
  const prefix = { agent: 'Agent', exclusive: 'Gateway', parallel: 'Parallel', output: 'Output' }
  const step = {
    id: uid('s'), type,
    name: (prefix[type] || 'Step') + ' ' + n,
    systemPrompt: '', inputTemplate: '',
    roles: '',
    tools: type === 'agent' ? [...TOOLS] : [],
    branches: type === 'exclusive' ? [] : undefined,
    format: type === 'output' ? 'md' : undefined,
    outputInstruction: type === 'output' ? '' : undefined,
    attach: type === 'output' ? [] : undefined,
    after: [],
  }
  set(s => ({
    flows: s.flows.map(f => (f.id === flowId ? { ...f, steps: { ...f.steps, [step.id]: step } } : f)),
    activeStepId: step.id,
    tab: 'editor',
  }))
  return step.id
}
function updStep(flowId, stepId, patch) {
  updFlow(flowId, f => ({ ...f, steps: { ...f.steps, [stepId]: { ...f.steps[stepId], ...patch } } }))
}
function delStep(flowId, stepId) {
  updFlow(flowId, f => {
    const steps = { ...f.steps }
    delete steps[stepId]
    Object.values(steps).forEach(st => { st.after = (st.after || []).filter(a => a !== stepId) })
    return { ...f, steps }
  })
  set(s => (s.activeStepId === stepId ? { activeStepId: null } : {}))
}

// ---------------------------------------------------------------- DAG

// Kahn topological sort + level per node. Returns { order, level } or null on cycle.
function topo(steps) {
  const ids = Object.keys(steps)
  if (!ids.length) return { order: [], level: {} }
  const indeg = {}, adj = {}
  ids.forEach(id => { indeg[id] = 0; adj[id] = [] })
  ids.forEach(id => (steps[id].after || []).forEach(d => {
    if (steps[d] && d !== id) { indeg[id]++; adj[d].push(id) }
  }))
  const q = ids.filter(id => !indeg[id])
  const level = {}
  q.forEach(id => { level[id] = 0 })
  const order = []
  while (q.length) {
    const id = q.shift()
    order.push(id)
    for (const t of adj[id]) {
      level[t] = Math.max(level[t] ?? 0, level[id] + 1)
      if (--indeg[t] === 0) q.push(t)
    }
  }
  return order.length === ids.length ? { order, level } : null
}

// Transitive "runs after" closure of a step.
function depClosure(steps, id) {
  const out = new Set()
  const q = [...(steps[id]?.after || [])]
  while (q.length) {
    const x = q.pop()
    if (out.has(x) || !steps[x]) continue
    out.add(x)
    q.push(...(steps[x].after || []))
  }
  return out
}

// Would marking `cand` as a dependency of `from` create a cycle?
function wouldCycle(steps, fromId, candId) {
  if (candId === fromId) return true
  return depClosure(steps, candId).has(fromId)
}

// ---------------------------------------------------------------- brief

function buildBrief(flow, lang) {
  const t = STR[lang]
  const res = topo(flow.steps)
  if (!res) return t.briefCycle
  const { order, level } = res
  const levels = []
  order.forEach(id => { (levels[level[id]] = levels[level[id]] || []).push(id) })
  const name = flow.name || t.flowDefault
  const hasOutput = order.some(id => flow.steps[id].type === 'output')
  const L = []
  const iters = Math.max(1, Math.floor(Number(flow.iterations) || 1))
  L.push(`# ${t.briefTitle}: «${name}» (${order.length} ${t.briefStepsWord}${iters > 1 ? ', ' + iters + ' ' + t.briefIterWord : ''})`)
  L.push('')
  L.push(t.launchOrder)
  levels.forEach((ids, i) => L.push(`${i + 1}) ${ids.map(id => flow.steps[id].name || id).join('; ')}`))
  L.push('')
  L.push(t.stepsHeader)
  order.forEach((id, i) => {
    const st = flow.steps[id]
    const label = t[TYPE_META[st.type]?.labelKey] || st.type
    L.push(`${i + 1}. [${label}] ${st.name || id}`)
    if (st.systemPrompt && st.systemPrompt.trim()) L.push(`   ${t.sysLabel}: ${st.systemPrompt.trim()}`)
    if (st.roles && st.roles.trim()) L.push(`   ${t.rolesLabel}: ${st.roles.trim()}`)
    if (st.type === 'exclusive' && Array.isArray(st.branches)) {
      st.branches.forEach((b, bi) => {
        const tgt = b.target ? (flow.steps[b.target] ? (flow.steps[b.target].name || b.target) : b.target) : '∅'
        const cond = b.condition ? b.condition : (b.isDefault ? t.briefDefault : '—')
        L.push(`   ${t.briefBranches} ${bi + 1}. ${cond} → ${tgt}`)
      })
    }
    if (st.type === 'parallel') {
      const outs = order.filter(o2 => (flow.steps[o2].after || []).includes(st.id))
      if (outs.length) L.push(`   ${t.briefParallelRuns} ${outs.map(o2 => flow.steps[o2].name || o2).join(', ')}`)
    }
    if (st.type === 'output') {
      const ans = (st.inputTemplate || '').trim()
      L.push(`   ${t.briefAnswer}: ${ans || t.briefAnswerEmpty}`)
      L.push(`   ${t.briefFormat}: ${st.format === 'plain' ? t.formatPlain : t.formatMd}`)
      if ((st.outputInstruction || '').trim()) L.push(`   ${t.briefInstr}: ${st.outputInstruction.trim()}`)
      const att = (st.attach || []).filter(a => flow.steps[a]).map(a => flow.steps[a].name || a)
      if (att.length) L.push(`   ${t.briefAppend}: ${att.join(', ')}`)
    } else {
      if (st.inputTemplate && st.inputTemplate.trim()) L.push(`   ${t.inputLabel}: ${st.inputTemplate.trim()}`)
      if (st.type === 'agent' && st.tools && st.tools.length) L.push(`   ${t.toolsLabel}: ${st.tools.join(', ')}`)
    }
  })
  L.push('')
  L.push(hasOutput ? t.briefRules : t.briefRulesNoOutput)
  return L.join('\n')
}

// ---------------------------------------------------------------- clipboard / files

function copyText(text, okMsg, failMsg) {
  const done = ok => host.notify({ kind: 'info', message: ok ? okMsg : failMsg })
  const fallback = () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done(true)).catch(() => done(false))
    } else done(false)
  }
  try {
    const r = ctxRef?.os?.writeClipboard?.(text)
    if (r === false) { fallback(); return }
    if (r && r.then) { r.then(ok => done(ok !== false)).catch(fallback); return }
    done(true)
  } catch (e) { fallback() }
}

function downloadFile(name, text) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

const slug = s => (s || '').toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-+|-+$/g, '') || 'flow'

// ---------------------------------------------------------------- import

function normalizeFlow(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.steps !== 'object' || raw.steps === null) return null
  const steps = {}
  for (const [k, v] of Object.entries(raw.steps)) {
    if (!v || typeof v !== 'object') return null
    const id = String(v.id ?? k)
    // backward compat: old 'condition' type maps to an exclusive gateway
    let type = v.type
    if (type === 'condition') type = 'exclusive'
    if (!STEP_TYPES.includes(type)) type = 'agent'
    const branches = type === 'exclusive'
      ? (Array.isArray(v.branches) && v.branches.length
        ? v.branches.map(b => ({ id: String(b?.id ?? uid('b')), target: b?.target ? String(b.target) : null, condition: String(b?.condition ?? ''), isDefault: !!b?.isDefault }))
        : (v.condition ? [{ id: uid('b'), target: null, condition: String(v.condition), isDefault: true }] : []))
      : undefined
    steps[id] = {
      id, type,
      name: String(v.name ?? ''),
      systemPrompt: String(v.systemPrompt ?? ''),
      inputTemplate: String(v.inputTemplate ?? ''),
      roles: String(v.roles ?? ''),
      tools: Array.isArray(v.tools) ? v.tools.filter(x => TOOLS.includes(x)) : [],
      branches,
      format: type === 'output' ? (v.format === 'plain' ? 'plain' : 'md') : undefined,
      outputInstruction: type === 'output' ? String(v.outputInstruction ?? '') : undefined,
      attach: type === 'output' && Array.isArray(v.attach) ? v.attach.map(String) : (type === 'output' ? [] : undefined),
      after: Array.isArray(v.after) ? v.after.map(String) : [],
    }
  }
  Object.values(steps).forEach(st => {
    st.after = st.after.filter(a => steps[a] && a !== st.id)
    if (st.type === 'exclusive' && Array.isArray(st.branches)) {
      st.branches = st.branches.filter(b => b.target === null || steps[b.target])
    }
    if (st.type === 'output' && Array.isArray(st.attach)) {
      st.attach = st.attach.filter(a => steps[a] && a !== st.id)
    }
  })
  const f = { id: uid('f'), name: String(raw.name ?? 'Imported flow'), iterations: Math.max(1, Math.floor(Number(raw.iterations) || 1)), steps, view: normalizeView(raw.view) }
  if (!topo(f.steps)) return 'cycle'
  return f
}

function normalizeMany(obj) {
  let list
  if (Array.isArray(obj)) list = obj
  else if (obj && Array.isArray(obj.flows)) list = obj.flows
  else list = [obj]
  const out = []
  for (const raw of list) {
    const r = normalizeFlow(raw)
    if (r === 'cycle') return { error: 'cycle' }
    if (r) out.push(r)
  }
  if (!out.length) return { error: 'none' }
  return { flows: out }
}

// ---------------------------------------------------------------- tiny UI kit

const ACCENT_MIX = 'color-mix(in srgb, var(--ui-accent) 14%, transparent)'
const BORDER = { borderColor: 'var(--ui-stroke-secondary)' }
const TXT2 = { color: 'var(--ui-text-secondary)' }
const TXT3 = { color: 'var(--ui-text-tertiary)' }
const cap = s => s.charAt(0).toUpperCase() + s.slice(1)

const btnCls = 'fs-btn inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm'

// Interactive states (hover / focus / motion) live in one scoped <style> block:
// the plugin UI is raw jsx() calls with no build step, so component-level
// :hover/:focus rules can't be expressed inline. Everything is namespaced
// with .fs- so it never leaks into the host app.
const FS_CSS = `
.fs-btn { transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, transform 120ms ease, box-shadow 120ms ease; }
.fs-btn:hover:not(:disabled) { background-color: color-mix(in srgb, var(--ui-accent) 8%, transparent); }
.fs-btn:active:not(:disabled) { transform: translateY(1px); }
.fs-btn:disabled { opacity: 0.5; cursor: default; }
.fs-btn-primary { border-color: transparent !important; box-shadow: 0 1px 3px color-mix(in srgb, var(--ui-accent) 45%, transparent); }
.fs-btn-primary:hover:not(:disabled) { filter: brightness(1.12); transform: translateY(-1px); box-shadow: 0 4px 10px color-mix(in srgb, var(--ui-accent) 45%, transparent); }
.fs-btn-primary, .fs-btn-primary:hover:not(:disabled), .fs-btn-primary:active:not(:disabled) { color: #ffffff !important; }
.fs-btn-danger:hover:not(:disabled) { background-color: color-mix(in srgb, #f0605f 12%, transparent); color: #f0605f; border-color: color-mix(in srgb, #f0605f 40%, transparent); }
.fs-input { transition: border-color 120ms ease, box-shadow 120ms ease; }
.fs-input:hover { border-color: color-mix(in srgb, var(--ui-accent) 40%, var(--ui-stroke-secondary)); }
.fs-input:focus, .fs-input:focus-visible { outline: none; border-color: var(--ui-accent) !important; box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent) 22%, transparent); }
.fs-row { transition: background-color 120ms ease; }
.fs-row:hover { background-color: color-mix(in srgb, var(--ui-text-secondary) 7%, transparent); }
.fs-tab { transition: background-color 120ms ease, color 120ms ease; }
.fs-tab:hover { background-color: color-mix(in srgb, var(--ui-text-secondary) 8%, transparent); }
.fs-zoom { transition: background-color 120ms ease; }
.fs-zoom:hover { background-color: color-mix(in srgb, var(--ui-text-secondary) 10%, transparent); }
.fs-node { cursor: grab; }
.fs-node:active { cursor: grabbing; }
.fs-node .fs-node-body { transition: fill-opacity 120ms ease; }
.fs-node:hover { filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.28)); }
.fs-node:hover .fs-node-body { fill-opacity: 0.22; }
@media (prefers-reduced-motion: reduce) {
  .fs-btn, .fs-input, .fs-row, .fs-tab, .fs-zoom, .fs-node, .fs-node .fs-node-body { transition: none; }
  .fs-btn:hover:not(:disabled), .fs-btn-primary:hover:not(:disabled) { transform: none; }
}
`
function FSStyles() { return jsx('style', { children: FS_CSS }) }

function Label({ children }) {
  return jsx('div', { className: 'text-[11px] font-semibold uppercase tracking-wide', style: TXT3, children })
}

function Field({ label, hint, children }) {
  return jsxs('div', { className: 'flex flex-col gap-1.5', children: [
    jsx(Label, { children: label }),
    children,
    hint ? jsx('div', { className: 'text-xs leading-relaxed', style: { color: 'var(--ui-text-quaternary)' }, children: hint }) : null,
  ] })
}

const inputCls = 'fs-input h-8 w-full rounded-md border bg-transparent px-2.5 text-sm outline-none'
const areaCls = 'fs-input w-full rounded-md border bg-transparent p-2.5 text-sm leading-relaxed outline-none'

// ---------------------------------------------------------------- graph

const NODE_W = 200
const NODE_H = 62
const GAP_X = 84
const GAP_Y = 30
const PAD = 28

// Normalize the graph view state (node offsets / zoom / scroll) kept on a flow.
function normalizeView(v) {
  const offsets = {}
  const o = (v && v.offsets) || {}
  for (const [k, val] of Object.entries(o)) {
    const dx = Number(val && val.dx), dy = Number(val && val.dy)
    if (Number.isFinite(dx) && Number.isFinite(dy)) offsets[k] = { dx, dy }
  }
  const zoom = Math.min(2.5, Math.max(0.4, Number(v && v.zoom) || 1))
  const scX = Number(v && v.scrollX), scY = Number(v && v.scrollY)
  return {
    offsets,
    zoom,
    scrollX: Number.isFinite(scX) && scX >= 0 ? scX : 0,
    scrollY: Number.isFinite(scY) && scY >= 0 ? scY : 0,
  }
}

const typeLabel = (t, tp) => {
  const m = TYPE_META[tp]
  return m ? t[m.labelKey] : tp
}
const typeMeta = tp => TYPE_META[tp] || TYPE_META.agent

function LaunchBar({ flow, t, lang }) {
  const [busy, setBusy] = useState(false)
  const hasSteps = flow && Object.keys(flow.steps).length > 0
  const iters = Math.max(1, Math.floor(Number(flow.iterations) || 1))
  // Resolve the live session id `prompt.submit` needs. activeSessionId is the
  // runtime id of the chat the user is looking at (null only on an unsent draft).
  const activeSessionId = () => {
    try { return host.state.activeSessionId ? host.state.activeSessionId.get() : null } catch (e) { return null }
  }
  const launch = async () => {
    if (!hasSteps || busy) return
    const sid = activeSessionId()
    if (!sid) {
      // No live chat to run in: hand the brief over and point to the composer.
      copyText(buildBrief(flow, lang), t.briefCopied, t.briefCopiedFail)
      host.notify({ kind: 'warning', message: t.launchNoSession })
      return
    }
    setBusy(true)
    haptic('tap')
    const brief = buildBrief(flow, lang)
    let sent = false
    try {
      await host.request('prompt.submit', { session_id: sid, text: brief })
      sent = true
    } catch (e) { sent = false }
    setBusy(false)
    if (sent) host.notify({ kind: 'success', message: t.launchSent })
    else {
      host.notify({ kind: 'warning', message: t.launchFail })
      copyText(brief, t.briefCopied, t.briefCopiedFail)
    }
  }
  return jsxs('div', {
    className: 'flex flex-wrap items-center gap-2 border-b px-4 py-2',
    style: { borderColor: 'var(--ui-stroke-secondary)' },
    children: [
      jsxs('label', {
        className: 'flex items-center gap-1.5 text-sm',
        style: { color: 'var(--ui-text-secondary)' },
        title: t.iterationsHint,
        children: [
          t.iterations + ':',
          jsx('input', {
            type: 'number', min: 1, step: 1, value: iters,
            className: 'fs-input h-8 w-16 rounded-md border bg-transparent px-2 text-sm',
            style: { ...BORDER, color: 'var(--ui-text-secondary)' },
            onChange: e => {
              const v = Math.max(1, Math.floor(Number(e.target.value) || 1))
              updFlow(flow.id, f => ({ ...f, iterations: v }))
            },
          }),
        ],
      }),
      jsx('div', { className: 'flex-1' }),
      jsx('button', {
        type: 'button', title: t.copyBrief,
        className: 'fs-btn h-8 shrink-0 rounded-md border px-3 text-sm',
        style: BORDER, color: 'var(--ui-text-secondary)',
        onClick: () => {
          if (!hasSteps) { host.notify({ kind: 'info', message: t.noStepsForBrief }); return }
          haptic('tap')
          copyText(buildBrief(flow, lang), t.briefCopied, t.briefCopiedFail)
        },
        children: t.copyBrief,
      }),
      jsx('button', {
        type: 'button',
        disabled: !hasSteps || busy,
        title: t.launchHint,
        className: 'fs-btn fs-btn-primary h-8 shrink-0 rounded-md px-4 text-sm font-semibold',
        style: {
          background: 'var(--ui-accent)',
          color: 'var(--ui-bg, #ffffff)',
          cursor: hasSteps && !busy ? 'pointer' : 'default',
        },
        onClick: () => { void launch() },
        children: busy ? '… ' + t.launching : '▶ ' + t.launch,
      }),
    ],
  })
}

function Graph({ flow, t, onPick }) {
  // View state (block offsets, zoom, canvas scroll) is lifted onto the flow
  // (flow.view) so it survives leaving the Graph tab — this component unmounts on
  // every tab switch, so plain useState would be wiped. It is persisted with the
  // flow, so it also survives an app restart. The parent renders Graph with
  // key={flow.id}, so switching flows remounts it fresh from that flow's view.
  const view0 = normalizeView(flow.view)
  const [offsets, setOffsets] = useState(view0.offsets)
  const [zoom, setZoom] = useState(view0.zoom)
  const dragRef = useRef(null)
  const movedRef = useRef(false)
  const canvasRef = useRef(null)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const clampZoom = z => Math.min(2.5, Math.max(0.4, z))

  // Always-current view snapshot for persistence (no stale closures). Render
  // keeps offsets/zoom in local state for a smooth drag; only the flushed copy
  // is written to the store.
  const viewState = useRef({ offsets: view0.offsets, zoom: view0.zoom, scrollX: view0.scrollX, scrollY: view0.scrollY })
  viewState.current.offsets = offsets
  viewState.current.zoom = zoom

  // Throttled write of the view back onto the flow (store persist debounces I/O).
  const flushTimer = useRef(null)
  const flush = immediate => {
    if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null }
    const run = () => {
      const v = viewState.current
      updFlow(flow.id, f => ({
        ...f,
        view: { ...normalizeView(f.view), offsets: v.offsets, zoom: v.zoom, scrollX: v.scrollX, scrollY: v.scrollY },
      }))
    }
    if (immediate) run()
    else flushTimer.current = setTimeout(run, 200)
  }
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    flush(false)
  }, [offsets, zoom])

  // Restore the canvas scroll position once the SVG is laid out, keep it in sync
  // while scrolling, and flush the final position on unmount (tab/flow switch).
  useEffect(() => {
    const sc = canvasRef.current
    if (!sc) return
    sc.scrollLeft = viewState.current.scrollX
    sc.scrollTop = viewState.current.scrollY
    const onScroll = () => {
      viewState.current.scrollX = sc.scrollLeft
      viewState.current.scrollY = sc.scrollTop
      flush(false)
    }
    sc.addEventListener('scroll', onScroll)
    return () => {
      sc.removeEventListener('scroll', onScroll)
      viewState.current.scrollX = sc.scrollLeft
      viewState.current.scrollY = sc.scrollTop
      flush(true)
    }
  }, [flow.id])

  // Ctrl/Cmd + wheel = zoom; plain wheel = native scroll
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = e => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      setZoom(z => clampZoom(z * factor))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [flow.id])

  const res = topo(flow.steps)
  if (!res) return jsx('div', { className: 'p-4 text-sm', style: TXT3, children: t.briefCycle })
  const { level } = res
  const ids = Object.keys(flow.steps)
  if (!ids.length) return jsx('div', { className: 'p-6 text-sm', style: TXT3, children: t.graphEmpty })

  const off = id => offsets[id] || { dx: 0, dy: 0 }
  const nPos = id => { const p = pos[id], o = off(id); return { x: p.x + o.dx, y: p.y + o.dy } }

  // --- drag a block: the canvas grows to keep it in view, scroll follows the cursor
  const onNodeDown = (id, e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { id, sx: e.clientX, sy: e.clientY, base: { ...off(id) } }
    movedRef.current = false
    const onMove = ev => {
      if (!dragRef.current) return
      const dx = ev.clientX - dragRef.current.sx
      const dy = ev.clientY - dragRef.current.sy
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) movedRef.current = true
      if (!movedRef.current) return
      const base = dragRef.current.base
      const k = zoomRef.current
      const nid = dragRef.current.id
      const nx = base.dx + dx / k
      const ny = base.dy + dy / k
      setOffsets(o => ({ ...o, [nid]: { dx: nx, dy: ny } }))
      const sc = canvasRef.current
      if (sc) {
        const p = pos[nid]
        const right = (p.x + nx + NODE_W) * k
        const left = (p.x + nx) * k
        const bottom = (p.y + ny + NODE_H) * k
        const top = (p.y + ny) * k
        const vw = sc.clientWidth, vh = sc.clientHeight
        if (right > sc.scrollLeft + vw) sc.scrollLeft = right - vw
        else if (left < sc.scrollLeft) sc.scrollLeft = Math.max(0, left)
        if (bottom > sc.scrollTop + vh) sc.scrollTop = bottom - vh
        else if (top < sc.scrollTop) sc.scrollTop = Math.max(0, top)
      }
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const onNodeClick = (id, e) => {
    e.stopPropagation()
    if (movedRef.current) { movedRef.current = false; return }
    if (onPick) onPick(id)
  }

  // --- auto layout by DAG levels
  const cols = []
  ids.forEach(id => { (cols[level[id]] = cols[level[id]] || []).push(id) })
  const nCols = cols.length
  const maxRows = Math.max(...cols.map(c => c.length))
  const autoW = PAD * 2 + nCols * NODE_W + (nCols - 1) * GAP_X
  const autoH = PAD * 2 + maxRows * (NODE_H + GAP_Y)
  const pos = {}
  cols.forEach((col, ci) => {
    const colH = col.length * (NODE_H + GAP_Y)
    const startY = Math.max(PAD, (autoH - colH) / 2)
    col.forEach((id, ri) => { pos[id] = { x: PAD + ci * (NODE_W + GAP_X), y: startY + ri * (NODE_H + GAP_Y) } })
  })

  // canvas follows the auto layout AND any dragged block (min = auto size)
  let maxR = 0, maxB = 0
  ids.forEach(id => { const p = nPos(id); maxR = Math.max(maxR, p.x + NODE_W); maxB = Math.max(maxB, p.y + NODE_H) })
  const W = Math.ceil(Math.max(autoW, maxR + PAD))
  const H = Math.ceil(Math.max(autoH, maxB + PAD))

  const edges = []
  ids.forEach(id => (flow.steps[id].after || []).forEach(d => {
    if (flow.steps[d]) {
      const from = flow.steps[d]
      let label = null
      if (from.type === 'exclusive') {
        const br = (from.branches || []).find(b => b.target === id)
        label = br ? (br.condition || (br.isDefault ? t.briefDefault : '')) : t.briefDefault
      }
      edges.push({ from: d, to: id, key: d + '>' + id, label })
    }
  }))

  const legendTypes = STEP_TYPES.filter(tp => ids.some(id => flow.steps[id].type === tp))

  const zoomBtn = (label, action, title) => jsx('button', {
    type: 'button', title,
    className: 'fs-zoom h-7 w-7 rounded text-sm leading-none',
    style: { color: 'var(--ui-text-secondary)' },
    onClick: () => { haptic('tap'); action() },
    children: label,
  })

  return jsxs('div', { className: 'flex h-full min-h-0 flex-col', children: [
    jsx('div', { className: 'relative min-h-0 flex-1', children: [
    jsx('div', {
      ref: canvasRef,
      className: 'h-full overflow-auto',
      style: {
        backgroundImage: 'radial-gradient(color-mix(in srgb, var(--ui-text-secondary) 22%, transparent) 1px, transparent 1px)',
        backgroundSize: '22px 22px',
      },
      onDoubleClick: () => setZoom(1),
      children: jsx('svg', {
        width: Math.ceil(W * zoom), height: Math.ceil(H * zoom), className: 'block',
        children: jsx('g', {
          transform: `scale(${zoom})`,
          children: [
            jsx('defs', { children: jsx('marker', {
              id: ID + '-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5',
              markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse',
              children: jsx('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'var(--ui-text-quaternary)' }),
            }) }),
            ...edges.map(e => {
              const a = nPos(e.from), b = nPos(e.to)
              const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2
              const x2 = b.x - 3, y2 = b.y + NODE_H / 2
              const mx = (x1 + x2) / 2
              const lbl = e.label ? (e.label.length > 24 ? e.label.slice(0, 23) + '…' : e.label) : null
              return jsxs('g', { key: e.key, children: [
                jsx('path', {
                  d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
                  fill: 'none', stroke: 'var(--ui-text-quaternary)', strokeWidth: 1.4,
                  markerEnd: `url(#${ID}-arrow)`,
                }),
                lbl ? jsx('text', {
                  x: mx, y: Math.min(y1, y2) + (y1 === y2 ? -8 : -2),
                  fill: TYPE_COLOR.exclusive, fontSize: 10, textAnchor: 'middle',
                  children: lbl,
                }) : null,
              ] })
            }),
            ...ids.map(id => {
              const st = flow.steps[id]
              const { x, y } = nPos(id)
              const c = TYPE_COLOR[st.type] || TYPE_COLOR.agent
              const m = typeMeta(st.type)
              const label = st.name || typeLabel(t, st.type)
              const isGw = st.type === 'exclusive' || st.type === 'parallel'
              const gwCy = y + NODE_H / 2
              const clipId = ID + '-clip-' + id
              const clipRect = isGw
                ? { cx: x + 64, cw: NODE_W - 72 }
                : { cx: x + 10, cw: NODE_W - 20 }
              const gwChildren = isGw
                ? [
                  jsx('polygon', {
                    points: `${x + 14 + 26},${y + NODE_H / 2 - 26} ${x + 14 + 26 + 26},${y + NODE_H / 2} ${x + 14 + 26},${y + NODE_H / 2 + 26} ${x + 14},${y + NODE_H / 2}`,
                    fill: c, fillOpacity: 0.18, stroke: c, strokeWidth: 1.4,
                  }),
                  st.type === 'exclusive'
                    ? jsx('text', {
                      x: x + 40, y: gwCy + 4, fill: c, fontSize: 12, fontWeight: 700, textAnchor: 'middle',
                      children: 'X',
                    })
                    : [
                      jsx('line', { x1: x + 37, y1: gwCy - 7, x2: x + 37, y2: gwCy + 7, stroke: c, strokeWidth: 1.6 }),
                      jsx('line', { x1: x + 43, y1: gwCy - 7, x2: x + 43, y2: gwCy + 7, stroke: c, strokeWidth: 1.6 }),
                      jsx('text', {
                        x: x + 40, y: gwCy + 16, fill: c, fontSize: 7.5, fontWeight: 700, textAnchor: 'middle',
                        children: 'AND',
                      }),
                    ],
                ]
                : []
              const textX = isGw ? x + 80 : x + 12
              return jsx('g', {
                key: id, className: 'fs-node cursor-pointer',
                style: { cursor: 'grab' },
                onMouseDown: e => onNodeDown(id, e),
                onClick: e => onNodeClick(id, e),
                children: [
                  jsx('title', { children: label }),
                  jsx('clipPath', { id: clipId, children: jsx('rect', { x: clipRect.cx, y: y + 14, width: clipRect.cw, height: 36 }) }),
                  jsx('rect', {
                    className: 'fs-node-body',
                    x, y, width: NODE_W, height: NODE_H, rx: 12, fill: c, fillOpacity: 0.12,
                    stroke: c, strokeWidth: 1.2, strokeDasharray: isGw ? '4 3' : 'none',
                  }),
                  ...gwChildren,
                  jsxs('g', {
                    clipPath: `url(#${clipId})`,
                    children: [
                      jsx('text', { x: textX, y: y + 25, fill: 'var(--ui-text-secondary)', fontSize: 12.5, fontWeight: 600, children: label }),
                      jsx('text', { x: textX, y: y + 43, fill: c, fontSize: 10.5, children: m.icon + ' ' + typeLabel(t, st.type) }),
                    ],
                  }),
                ],
              })
            }),
          ],
        }),
      }),
    }),
    // floating zoom / layout toolbar
    jsxs('div', {
      className: 'absolute right-3 top-3 flex items-center gap-0.5 rounded-lg border px-1 py-0.5',
      style: { ...BORDER, background: 'var(--ui-bg, rgba(0,0,0,0.02))', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)' },
      children: [
        zoomBtn('⟲', () => {
          setOffsets({}); setZoom(1)
          viewState.current.offsets = {}; viewState.current.zoom = 1
          const sc = canvasRef.current
          if (sc) { sc.scrollLeft = 0; sc.scrollTop = 0 }
          viewState.current.scrollX = 0; viewState.current.scrollY = 0
          updFlow(flow.id, f => ({ ...f, view: normalizeView(undefined) }))
        }, t.resetLayout),
        jsx('span', { className: 'mx-0.5 h-4 w-px', style: { background: 'var(--ui-stroke-secondary)' } }),
        zoomBtn('−', () => setZoom(z => clampZoom(z / 1.15)), t.zoomOut),
        jsx('span', { className: 'min-w-[38px] text-center text-xs tabular-nums', style: { color: 'var(--ui-text-secondary)' }, children: Math.round(zoom * 100) + '%' }),
        zoomBtn('＋', () => setZoom(z => clampZoom(z * 1.15)), t.zoomIn),
        zoomBtn('1', () => setZoom(1), t.zoomReset),
      ],
    }),
    ] }),
    // legend — a fixed HTML strip below the canvas, so blocks can never overlap it
    jsxs('div', {
      className: 'shrink-0 overflow-x-auto border-t px-3 py-1.5',
      style: { borderColor: 'var(--ui-stroke-secondary)' },
      children: legendTypes.map(tp => {
        const m = TYPE_META[tp]
        const isExcl = tp === 'exclusive', isPar = tp === 'parallel'
        return jsxs('span', {
          key: tp, className: 'mr-5 inline-flex shrink-0 items-center gap-1.5 text-xs',
          style: { color: 'var(--ui-text-secondary)' },
          children: [
            tp === 'agent'
              ? jsx('span', { className: 'inline-block h-3.5 w-3.5 rounded', style: { background: m.color + '33', border: '1.5px solid ' + m.color } })
              : jsx('span', {
                className: 'inline-block h-0 w-0',
                style: { borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderTop: '8px solid ' + m.color + '55', borderImage: 'none' },
              }),
            isExcl ? jsx('span', { style: { color: m.color, fontWeight: 700 }, children: 'X' }) : null,
            isPar ? jsx('span', { style: { color: m.color, fontWeight: 700 }, children: '‖' }) : null,
            t[m.labelKey],
          ],
        })
      }),
    }),
  ] })
}

// ---------------------------------------------------------------- editor

function OutputSettings({ flow, t, step }) {
  const f = flow.id
  const others = Object.values(flow.steps).filter(s => s.id !== step.id)
  const attached = step.attach || []
  const fmt = step.format || 'md'
  return jsxs('div', { className: 'flex flex-col gap-4', children: [
    jsx(Field, {
      label: t.outAnswer, hint: t.outAnswerHint,
      children: jsx('textarea', {
        className: areaCls, style: BORDER, rows: 3,
        placeholder: t.outAnswerPh, value: step.inputTemplate,
        onChange: e => updStep(f, step.id, { inputTemplate: e.target.value }),
      }),
    }),
    jsxs('div', { className: 'flex flex-col gap-1.5', children: [
      jsx(Label, { children: t.outFormat }),
      jsxs('div', { className: 'flex gap-1.5', children: [['md', t.outFormatMd], ['plain', t.outFormatPlain]].map(([val, label]) => {
        const on = fmt === val
        return jsx('button', {
          key: val, type: 'button',
          className: 'fs-btn h-8 rounded-md border px-3 text-sm',
          style: {
            borderColor: on ? TYPE_COLOR.output : 'var(--ui-stroke-secondary)',
            background: on ? 'color-mix(in srgb, ' + TYPE_COLOR.output + ' 14%, transparent)' : 'transparent',
            color: on ? TYPE_COLOR.output : 'var(--ui-text-secondary)',
            fontWeight: on ? 600 : 400,
          },
          onClick: () => updStep(f, step.id, { format: val }),
          children: label,
        })
      }) }),
    ] }),
    jsx(Field, {
      label: t.outInstr,
      children: jsx('textarea', {
        className: areaCls, style: BORDER, rows: 2,
        placeholder: t.outInstrPh, value: step.outputInstruction || '',
        onChange: e => updStep(f, step.id, { outputInstruction: e.target.value }),
      }),
    }),
    jsxs('div', { className: 'flex flex-col gap-1.5', children: [
      jsx(Label, { children: t.outAppend }),
      others.length
        ? jsxs('div', { className: 'flex flex-col gap-1.5', children: others.map(s => {
          const on = attached.includes(s.id)
          return jsxs('label', {
            key: s.id, className: 'flex cursor-pointer items-center gap-2 text-sm', style: TXT2,
            children: [
              jsx('input', {
                type: 'checkbox',
                style: { accentColor: 'var(--ui-accent)' },
                checked: on,
                onChange: () => updStep(f, step.id, { attach: on ? attached.filter(x => x !== s.id) : [...attached, s.id] }),
              }),
              jsx('span', { className: 'h-2 w-2 shrink-0 rounded-full', style: { background: TYPE_COLOR[s.type] || TYPE_COLOR.agent } }),
              s.name || s.type,
            ],
          })
        }) })
        : jsx('div', { className: 'text-sm', style: TXT3, children: '—' }),
      jsx('div', { className: 'text-xs', style: { color: 'var(--ui-text-quaternary)' }, children: t.outAppendHint }),
    ] }),
  ] })
}

function BranchEditor({ flow, t, step }) {
  const f = flow.id
  const branches = step.branches || []
  const setBranches = list => updStep(f, step.id, { branches: list })
  const otherSteps = Object.values(flow.steps).filter(s => s.id !== step.id)
  const nameOf = id => (flow.steps[id] && (flow.steps[id].name || flow.steps[id].type)) || id
  return jsxs('div', { className: 'flex flex-col gap-1.5', children: [
    jsx(Label, { children: t.branches }),
    ...branches.map((b, i) => jsxs('div', {
      key: b.id,
      className: 'flex items-center gap-2 rounded-md border px-2 py-1.5', style: { ...BORDER, background: 'color-mix(in srgb, ' + TYPE_COLOR.exclusive + ' 5%, transparent)' },
      children: [
        jsx('span', { className: 'w-5 shrink-0 text-center text-xs font-semibold', style: { color: TYPE_COLOR.exclusive }, children: String(i + 1) }),
        jsx('input', {
          className: 'fs-input h-7 min-w-0 flex-1 rounded border bg-transparent px-2 text-sm outline-none', style: BORDER,
          placeholder: t.branchCondPh, value: b.condition,
          onChange: e => setBranches(branches.map(x => x.id === b.id ? { ...x, condition: e.target.value } : x)),
        }),
        jsx('span', { className: 'shrink-0 text-xs', style: TXT3, children: '→' }),
        jsx('select', {
          className: 'fs-input h-7 max-w-[150px] shrink-0 rounded border bg-transparent px-1.5 text-sm outline-none', style: { ...BORDER, color: 'var(--ui-text-secondary)' },
          value: b.target || '',
          onChange: e => {
            const target = e.target.value || null
            // keep the DAG consistent: the branch target runs after the gateway (unless that would make a cycle)
            if (target && !wouldCycle(flow.steps, target, step.id) && !(flow.steps[target]?.after || []).includes(step.id)) {
              updStep(f, target, { after: [...(flow.steps[target].after || []), step.id] })
            }
            if (!target && flow.steps[b.target] && (flow.steps[b.target].after || []).includes(step.id) && !branches.some(x => x.id !== b.id && x.target === b.target)) {
              updStep(f, b.target, { after: (flow.steps[b.target].after || []).filter(a => a !== step.id) })
            }
            setBranches(branches.map(x => x.id === b.id ? { ...x, target } : x))
          },
          children: [
            jsx('option', { value: '', children: '—' }),
            ...otherSteps.map(s => jsx('option', { key: s.id, value: s.id, children: s.name || s.type })),
          ],
        }),
        jsxs('label', {
          className: 'flex shrink-0 cursor-pointer items-center gap-1 text-xs', style: TXT3,
          children: [
            jsx('input', {
              type: 'checkbox', style: { accentColor: 'var(--ui-accent)' },
              checked: !!b.isDefault,
              onChange: () => setBranches(branches.map(x => ({ ...x, isDefault: x.id === b.id ? !b.isDefault : false }))),
            }),
            t.briefDefault,
          ],
        }),
        jsx('span', {
          role: 'button', title: t.deleteStep,
          className: 'fs-btn fs-btn-danger shrink-0 cursor-pointer rounded px-1 text-base leading-none', style: TXT3,
          onClick: () => setBranches(branches.filter(x => x.id !== b.id)),
          children: '×',
        }),
      ],
    })),
    jsxs('div', { className: 'flex items-center gap-2', children: [
      jsx('button', {
        type: 'button',
        className: 'fs-btn h-7 rounded-md border px-2 text-xs', style: { ...BORDER, color: 'var(--ui-text-secondary)' },
        onClick: () => setBranches([...branches, { id: uid('b'), target: null, condition: '', isDefault: false }]),
        children: '+ ' + t.addBranch,
      }),
      jsx('span', { className: 'text-xs', style: { color: 'var(--ui-text-quaternary)' }, children: '→ ' + t.dependsOn.split(' ')[0] }),
    ] }),
  ] })
}

function StepDetail({ flow, t, step }) {
  const f = flow.id
  const meta = typeMeta(step.type)
  return jsxs('div', { className: 'flex max-w-2xl flex-col gap-4', children: [
    jsxs('div', { className: 'flex flex-col gap-1.5', children: [
      jsx(Label, { children: t.stepName }),
      jsx('input', {
        className: inputCls, style: BORDER, value: step.name,
        onChange: e => updStep(f, step.id, { name: e.target.value }),
      }),
    ] }),
    jsxs('div', { className: 'flex flex-col gap-1.5', children: [
      jsx(Label, { children: t.typeLabel + ' — ' + t.typeHint }),
      jsxs('div', { className: 'flex flex-wrap gap-1.5', children: STEP_TYPES.map(tp => {
        const m = TYPE_META[tp]
        const on = step.type === tp
        return jsx('button', {
          key: tp, type: 'button',
          className: 'fs-btn h-8 rounded-md border px-3 text-sm',
          style: {
            borderColor: on ? m.color : 'var(--ui-stroke-secondary)',
            background: on ? 'color-mix(in srgb, ' + m.color + ' 14%, transparent)' : 'transparent',
            color: on ? m.color : 'var(--ui-text-secondary)',
            fontWeight: on ? 600 : 400,
          },
          onClick: () => updStep(f, step.id, { type: tp }),
          children: m.icon + '  ' + t[m.labelKey],
        })
      }) }),
      jsx('div', {
        className: 'rounded-md border p-2.5 text-xs leading-relaxed',
        style: { ...BORDER, background: 'color-mix(in srgb, ' + meta.color + ' 8%, transparent)', color: 'var(--ui-text-secondary)' },
        children: t[meta.descKey],
      }),
    ] }),
    step.type === 'agent' ? jsx(Field, {
      label: t.systemPrompt,
      children: jsx('textarea', {
        className: areaCls, style: BORDER, rows: 4,
        placeholder: t.systemPromptPh, value: step.systemPrompt,
        onChange: e => updStep(f, step.id, { systemPrompt: e.target.value }),
      }),
    }) : null,
    jsx(Field, {
      label: t.roles, hint: t.rolesHint,
      children: jsx('input', {
        className: inputCls, style: BORDER,
        placeholder: t.rolesPh, value: step.roles || '',
        onChange: e => updStep(f, step.id, { roles: e.target.value }),
      }),
    }),
    step.type === 'exclusive' ? jsx(BranchEditor, { flow, t, step }) : null,
    step.type === 'output'
      ? jsx(OutputSettings, { flow, t, step })
      : jsx(Field, {
        label: t.inputTemplate, hint: t.templateHint,
        children: jsx('textarea', {
          className: areaCls, style: BORDER, rows: 4,
          placeholder: t.inputTemplatePh, value: step.inputTemplate,
          onChange: e => updStep(f, step.id, { inputTemplate: e.target.value }),
        }),
      }),
    step.type === 'agent' ? jsxs('div', { className: 'flex flex-col gap-1.5', children: [
      jsx(Label, { children: t.tools }),
      jsxs('div', { className: 'flex flex-wrap gap-4', children: TOOLS.map(tool =>
        jsxs('label', {
          key: tool, className: 'flex cursor-pointer items-center gap-2 text-sm', style: TXT2,
          children: [
            jsx('input', {
              type: 'checkbox',
              style: { accentColor: 'var(--ui-accent)' },
              checked: (step.tools || []).includes(tool),
              onChange: () => {
                const has = (step.tools || []).includes(tool)
                updStep(f, step.id, { tools: has ? (step.tools || []).filter(x => x !== tool) : [...(step.tools || []), tool] })
              },
            }),
            jsx('span', { children: t['tool' + cap(tool === 'web_search' ? 'Search' : tool)] }),
          ],
        })
      ) }),
    ] }) : null,
    jsxs('div', { className: 'flex flex-col gap-1.5', children: [
      jsx(Label, { children: t.dependsOn }),
      (Object.keys(flow.steps).length === 1
        ? jsx('div', { className: 'text-sm', style: TXT3, children: t.noDeps })
        : jsxs('div', { className: 'flex flex-col gap-1.5', children: Object.values(flow.steps).filter(s => s.id !== step.id).map(other => {
          const blocked = wouldCycle(flow.steps, step.id, other.id)
          const checked = (step.after || []).includes(other.id)
          return jsxs('label', {
            key: other.id,
            className: 'flex items-center gap-2 text-sm',
            style: blocked ? { color: 'var(--ui-text-quaternary)', opacity: 0.55 } : TXT2,
            children: [
              jsx('input', {
                type: 'checkbox',
                disabled: blocked,
                style: { accentColor: 'var(--ui-accent)' },
                checked,
                onChange: () => {
                  const has = (step.after || []).includes(other.id)
                  updStep(f, step.id, { after: has ? (step.after || []).filter(x => x !== other.id) : [...(step.after || []), other.id] })
                },
              }),
              jsx('span', { children: other.name || other.type }),
              jsx('span', { className: 'text-xs', style: { color: TYPE_COLOR[other.type] || TYPE_COLOR.agent }, children: typeLabel(t, other.type) }),
            ],
          })
        })
        })
      )
    ] }),
    jsx('button', {
      type: 'button',
      className: 'fs-btn fs-btn-danger mt-1 h-8 self-start rounded-md border px-2.5 text-sm',
      style: { ...BORDER, color: 'var(--ui-text-secondary)' },
      onClick: () => { haptic('tap'); delStep(f, step.id) },
      children: t.deleteStep,
    }),
  ] })
}

function Editor({ flow, t }) {
  const s = useFS()
  const step = flow.steps[s.activeStepId]
  const order = Object.values(flow.steps)
  return jsxs('div', { className: 'flex h-full min-h-0', children: [
    jsx('div', {
      className: 'flex w-64 shrink-0 flex-col', style: { borderRight: '1px solid var(--ui-stroke-secondary)' },
      children: [
        jsx('div', { className: 'min-h-0 flex-1 overflow-auto p-2', children:
          order.length ? order.map(st => jsxs('div', {
            key: st.id,
            className: 'fs-row group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
            style: s.activeStepId === st.id
              ? { background: ACCENT_MIX, boxShadow: 'inset 2px 0 0 var(--ui-accent)' }
              : undefined,
            onClick: () => set({ activeStepId: st.id }),
            children: [
              jsx('span', { className: 'h-2 w-2 shrink-0 rounded-full', style: { background: TYPE_COLOR[st.type] || TYPE_COLOR.agent } }),
              jsx('span', { className: 'min-w-0 flex-1 truncate', style: s.activeStepId === st.id ? TXT2 : { ...TXT2, opacity: 0.85 }, children: st.name || st.type }),
              jsx('span', {
                role: 'button', title: t.deleteStep,
                className: 'px-1 text-base leading-none opacity-0 transition-opacity group-hover:opacity-60',
                style: TXT3,
                onClick: e => { e.stopPropagation(); delStep(flow.id, st.id) },
                children: '×',
              }),
            ],
          })) : jsx('div', { className: 'px-2 py-3 text-xs', style: TXT3, children: t.noSteps }),
        }),
        jsx('div', { className: 'flex flex-col gap-1.5 p-2', style: { borderTop: '1px solid var(--ui-stroke-secondary)' }, children:
          STEP_TYPES.map(tp => jsx('button', {
            key: tp, type: 'button',
            className: 'fs-btn flex h-8 items-center gap-2 rounded-md border px-2.5 text-sm',
            style: { ...BORDER, color: 'var(--ui-text-secondary)' },
            onClick: () => { haptic('tap'); addStep(flow.id, tp) },
            children: [
              jsx('span', { className: 'h-2 w-2 rounded-full', style: { background: TYPE_COLOR[tp] } }),
              t['type' + cap(tp)],
            ],
          }))
        }),
      ],
    }),
    jsx('div', { className: 'min-w-0 flex-1 overflow-auto p-4', children:
      step
        ? jsx(StepDetail, { flow, t, step })
        : jsx('div', { className: 'pt-10 text-sm', style: TXT3, children: t.pickStep }),
    }),
  ] })
}

// ---------------------------------------------------------------- json tab

function JsonTab({ flow, t, lang }) {
  const [importText, setImportText] = useState('')
  const [msg, setMsg] = useState(null) // { kind: 'ok'|'err', text }
  const json = useMemo(() => JSON.stringify(flow, null, 2), [flow])

  const doImport = () => {
    let obj
    try { obj = JSON.parse(importText) } catch (e) { setMsg({ kind: 'err', text: t.jsonImportError }); return }
    const r = normalizeMany(obj)
    if (r.error === 'cycle') { setMsg({ kind: 'err', text: t.jsonCycleError }); return }
    if (r.error === 'none') { setMsg({ kind: 'err', text: t.jsonNoFlows }); return }
    set(s => ({ flows: [...s.flows, ...r.flows], activeFlowId: r.flows[0].id, activeStepId: null, tab: 'editor' }))
    setImportText('')
    setMsg({ kind: 'ok', text: t.jsonImported(r.flows.length) })
  }

  return jsxs('div', { className: 'flex h-full min-h-0 flex-col gap-4 p-4', children: [
    jsxs('div', { className: 'flex flex-col gap-1.5', children: [
      jsxs('div', { className: 'flex items-center gap-2', children: [
        jsx('span', { className: 'text-sm font-medium', style: TXT2, children: t.json }),
        jsx('div', { className: 'flex-1' }),
        jsx('button', {
          type: 'button', className: btnCls, style: BORDER,
          onClick: () => copyText(json, t.briefCopied, t.briefCopiedFail),
          children: t.jsonCopy,
        }),
        jsx('button', {
          type: 'button', className: btnCls, style: BORDER,
          onClick: () => { haptic('tap'); downloadFile(slug(flow.name) + '.flow.json', json) },
          children: t.jsonDownload,
        }),
      ] }),
      jsx('div', { className: 'text-xs', style: TXT3, children: t.jsonHint }),
    ] }),
    jsx('textarea', {
      readOnly: true,
      value: json,
      className: 'fs-input min-h-0 flex-1 rounded-md border p-3 font-mono text-xs leading-relaxed outline-none',
      style: { ...BORDER, color: 'var(--ui-text-secondary)', background: 'color-mix(in srgb, var(--ui-text-secondary) 4%, transparent)' },
    }),
    jsxs('div', { className: 'flex flex-col gap-1.5', children: [
      jsx(Label, { children: t.jsonImport }),
      jsx('textarea', {
        className: areaCls, style: BORDER, rows: 4,
        placeholder: t.jsonImportPh, value: importText,
        onChange: e => setImportText(e.target.value),
      }),
      jsxs('div', { className: 'flex items-center gap-2', children: [
        jsx('button', {
          type: 'button', className: btnCls, style: BORDER,
          disabled: !importText.trim(),
          onClick: doImport,
          children: t.jsonImport,
        }),
        msg ? jsx('span', {
          className: 'text-xs',
          style: { color: msg.kind === 'ok' ? '#3ecf8e' : '#f0605f' },
          children: msg.text,
        }) : null,
      ] }),
    ] }),
  ] })
}

// ---------------------------------------------------------------- header

function Header({ s, t, flow }) {
  const lang = effLang(s)
  const tabs = [['editor', t.tabEditor], ['graph', t.tabGraph], ['json', t.tabJson]]
  return jsxs('div', { className: 'flex flex-col gap-2.5 border-b px-4 py-3', style: { borderColor: 'var(--ui-stroke-secondary)' }, children: [
    jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
      jsx('select', {
        className: 'fs-input h-8 max-w-[180px] rounded-md border bg-transparent px-2 text-sm',
        style: { ...BORDER, color: 'var(--ui-text-secondary)' },
        value: s.activeFlowId ?? '',
        onChange: e => set({ activeFlowId: e.target.value || null, activeStepId: null }),
        children: s.flows.map(f => jsx('option', { key: f.id, value: f.id, children: f.name || t.flowDefault })),
      }),
      jsx('button', {
        type: 'button', title: t.newFlow,
        className: 'fs-btn h-8 w-8 shrink-0 rounded-md border text-base leading-none',
        style: { ...BORDER, color: 'var(--ui-text-secondary)' },
        onClick: () => { haptic('tap'); addFlow() },
        children: '＋',
      }),
      flow ? jsx('input', {
        value: flow.name,
        placeholder: t.flowDefault,
        className: 'fs-input h-8 w-56 min-w-0 rounded-md border bg-transparent px-2.5 text-sm font-medium outline-none',
        style: { ...BORDER, color: 'var(--ui-text-secondary)' },
        onChange: e => updFlow(flow.id, f => ({ ...f, name: e.target.value })),
      }) : null,
      jsx('div', { className: 'text-xs', style: { color: 'var(--ui-text-quaternary)' }, children: flow ? t.stepsCount(Object.keys(flow.steps).length) : '' }),
      jsx('div', { className: 'flex-1' }),
      jsx('div', {
        className: 'flex overflow-hidden rounded-md border', style: BORDER,
        children: ['en', 'ru'].map(l => jsx('button', {
          key: l, type: 'button',
          className: 'fs-tab h-7 px-2.5 text-xs font-semibold uppercase',
          style: {
            background: lang === l ? ACCENT_MIX : 'transparent',
            color: lang === l ? 'var(--ui-accent)' : 'var(--ui-text-secondary)',
          },
          onClick: () => set({ lang: l }),
          children: l,
        })),
      }),
    ] }),
    jsxs('div', { className: 'flex gap-1', children: tabs.map(([id, label]) => jsx('button', {
      key: id, type: 'button',
      className: 'fs-tab h-8 rounded-md px-3 text-sm',
      style: s.tab === id
        ? { background: ACCENT_MIX, color: 'var(--ui-accent)', fontWeight: 600 }
        : { color: 'var(--ui-text-secondary)' },
      onClick: () => set({ tab: id }),
      children: label,
    })) }),
  ] })
}

// ---------------------------------------------------------------- page

function Page() {
  const s = useFS()
  const t = STR[effLang(s)]
  const flow = s.flows.find(f => f.id === s.activeFlowId) || null

  let body
  if (!s.ready) {
    body = jsx('div', { className: 'p-6 text-sm', style: TXT3, children: '…' })
  } else if (s.tab === 'editor') {
    body = flow
      ? jsx(Editor, { flow, t })
      : jsxs('div', { className: 'flex flex-col items-center gap-3 p-10 text-sm', style: TXT3, children: [
        t.createFlowHint,
        jsx('button', {
          type: 'button', className: 'fs-btn fs-btn-primary h-9 rounded-md px-4 text-sm font-semibold',
          style: { background: 'var(--ui-accent)', color: 'var(--ui-bg, #ffffff)', cursor: 'pointer' },
          onClick: () => { haptic('tap'); addFlow() },
          children: t.createFlow,
        }),
      ] })
  } else if (s.tab === 'graph') {
    body = flow && Object.keys(flow.steps).length
      ? jsxs('div', { className: 'flex h-full min-h-0 flex-col', children: [
        jsx(LaunchBar, { flow, t, lang: effLang(s) }),
        jsx('div', { className: 'min-h-0 flex-1', children: jsx(Graph, { key: flow.id, flow, t, onPick: id => set({ activeStepId: id, tab: 'editor' }) }) }),
      ] })
      : jsx('div', { className: 'p-6 text-sm', style: TXT3, children: t.graphEmpty })
  } else {
    body = flow ? jsx(JsonTab, { flow, t }) : jsx('div', { className: 'p-6 text-sm', style: TXT3, children: t.noSteps })
  }

  return jsxs('div', { className: 'flex h-full min-h-0 flex-col', children: [
    jsx(FSStyles, {}),
    jsx(Header, { s, t, flow }),
    jsx('div', { className: 'min-h-0 flex-1', children: body }),
  ] })
}

// ---------------------------------------------------------------- plugin

export default {
  id: ID,
  name: 'Flow Studio',
  register(ctx) {
    ctxRef = ctx
    initPersist()
    store.subscribe(() => persist && persist.schedule())

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: FLOW_PATH },
        render: () => jsx(Page, {}),
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        data: { path: FLOW_PATH, label: 'Flow Studio', codicon: 'project' },
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: ID + '.open',
          label: 'Open Flow Studio',
          keywords: ['flow', 'dag', 'workflow', 'поток', 'граф'],
          run: () => host.navigate(FLOW_PATH),
        },
      },
    ])
  },
}
