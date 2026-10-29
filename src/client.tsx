/**
 * Client plugin for dsh-ontology-builder.
 * Registers an "Ontology Builder" panel entry in the left sidebar (between Plugins and Workspace).
 */

import { createElement as h } from 'react'

const NS = 'ontologyBuilder'
const PANEL_ID = 'ontology-builder'

/** Icon: a layered schema/graph symbol */
function OntologyIcon({ size = 16 }: { size?: number }) {
  return h('svg', {
    viewBox: '0 0 20 20',
    width: size,
    height: size,
    'aria-hidden': true,
    focusable: false,
    style: { display: 'block', flex: 'none' },
  },
  // Nodes (circles)
  h('circle', { cx: 5, cy: 5, r: 2, fill: 'currentColor' }),
  h('circle', { cx: 15, cy: 5, r: 2, fill: 'currentColor' }),
  h('circle', { cx: 10, cy: 15, r: 2, fill: 'currentColor' }),
  // Edges (lines)
  h('line', { x1: 6.5, y1: 6, x2: 9, y2: 13.5, stroke: 'currentColor', strokeWidth: 1.2 }),
  h('line', { x1: 13.5, y1: 6, x2: 11, y2: 13.5, stroke: 'currentColor', strokeWidth: 1.2 }),
  h('line', { x1: 7, y1: 5, x2: 13, y2: 5, stroke: 'currentColor', strokeWidth: 1.2 })
  )
}

/** Main panel that embeds the ontology UI in an iframe */
function OntologyPanel({ project }: { project?: string }) {
  const url = project ? `/ontology/?project=${encodeURIComponent(project)}` : '/ontology/'

  return h('div', {
    style: {
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      minWidth: 0,
      minHeight: 0,
      background: 'var(--dsw-alias-bg-base)',
    },
  },
  h('iframe', {
    src: url,
    style: {
      flex: '1',
      width: '100%',
      height: '100%',
      border: 0,
      display: 'block',
    },
    title: 'Ontology Builder',
  })
  )
}

export const name = 'ontology-builder-client'
export const inject = ['slots', 'locale']

export function apply(ctx: any) {
  // Register locale dictionaries
  ctx.effect(() => ctx.locale.register(NS, {
    zh: {
      panel: '本体构建',
    },
    en: {
      panel: 'Ontology Builder',
    },
  }), 'ontology-builder: dictionaries')

  const t = ctx.locale.bind(NS)

  // Register main panel
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
  }, OntologyPanel))

  // Register sidebar panel entry (between Plugins and Workspace)
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 15,  // Plugins=10, Automation=20, so 15 puts us in between
    locale: NS,
    label: () => t('panel'),
  }, OntologyIcon))
}
