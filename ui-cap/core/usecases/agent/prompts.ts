/**
 * What Cap is told about itself before every conversation.
 *
 * The prompt is short on purpose: a 24B model running on a box in the corner
 * follows a handful of firm rules far better than a page of nuance.
 */

export interface PromptContext {
  /** Human-readable current date and time, in the robot's timezone. */
  now: string
  /** Name or email of the paired account, when there is one. */
  user?: string | null
  flotsAvailable: boolean
  /** Parts of the body that are missing, e.g. "caméra". */
  missing?: string[]
}

export function buildSystemPrompt(context: PromptContext): string {
  const lines = [
    "Tu es Cap, l'assistant de Flots, incarné dans un petit robot posé sur un bureau.",
    `Nous sommes ${context.now}.`,
    '',
    'Règles :',
    "- Tes réponses sont prononcées à voix haute : une ou deux phrases, jamais de listes à puces, jamais de Markdown.",
    '- Tu parles français, sur un ton direct et chaleureux.',
    "- Pour toute question d'heure, de date ou d'échéance, appelle get_current_datetime plutôt que de deviner.",
    "- Quand on te demande d'agir, agis avec un outil, puis confirme en une phrase ce que tu as fait.",
    "- Si une action échoue, dis-le simplement et explique en une phrase ce qui bloque.",
    "- N'invente jamais le contenu d'une tâche ou d'une note : si l'information manque, pose une question courte.",
  ]

  if (context.flotsAvailable) {
    lines.push(
      `- Le compte Flots${context.user ? ` de ${context.user}` : ''} est connecté : tu peux consulter et créer tâches et notes.`,
    )
  } else {
    lines.push(
      "- Le robot n'est pas connecté à Flots : tu ne peux ni lire ni créer de tâches ou de notes. Dis-le et propose d'aller dans les réglages pour l'appairer.",
    )
  }

  if (context.missing?.length) {
    lines.push(`- Matériel indisponible : ${context.missing.join(', ')}.`)
  }

  return lines.join('\n')
}

/**
 * What the screen says while a tool runs.
 *
 * The user is watching a progress overlay, so each step is phrased as
 * something Cap is doing rather than as the tool's name.
 */
const TOOL_LABELS: Record<string, string> = {
  get_current_datetime: 'Je regarde l’heure…',
  set_alarm: 'Je programme l’alarme…',
  list_alarms: 'Je regarde tes alarmes…',
  delete_alarm: 'Je supprime l’alarme…',
  speak: 'Je réponds…',
  show_notification: 'J’affiche une notification…',
  set_expression: 'Je change d’expression…',
  create_task: 'Je crée la tâche…',
  update_task: 'Je mets la tâche à jour…',
  complete_task: 'Je termine la tâche…',
  list_tasks: 'Je regarde tes tâches…',
  search_tasks: 'Je cherche dans tes tâches…',
  get_task: 'Je regarde la tâche…',
  list_projects: 'Je regarde tes projets…',
  list_project_tasks: 'Je regarde les tâches du projet…',
  create_project: 'Je crée le projet…',
  list_categories: 'Je regarde tes catégories…',
  create_note: 'J’enregistre la note…',
  update_note: 'Je mets la note à jour…',
  list_notes: 'Je regarde tes notes…',
  search_notes: 'Je cherche dans tes notes…',
  get_note: 'Je relis la note…',
  get_day_summary: 'Je regarde ta journée…',
}

/** Friendly French label for a tool call, with a sane fallback. */
export function describeToolCall(name: string): string {
  return TOOL_LABELS[name] ?? 'Je m’en occupe…'
}
