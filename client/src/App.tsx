import { useEffect, useState } from 'react'
import { type Overview, type Project } from './api'
import { RevisionContext, useApi, useRevision } from './hooks'
import { LangProvider, useLang, useT } from './i18n'
import { Loading, WithCode } from './ui'
import { SchemaView } from './views/SchemaView'
import { ExploreView } from './views/ExploreView'
import { ReviewView } from './views/ReviewView'
import { MaterialView } from './views/MaterialView'
import { QualityView } from './views/QualityView'

const TABS = ['schema', 'explore', 'review', 'materials', 'quality'] as const
export type Tab = typeof TABS[number]

/** Where to jump: a tab plus an optional item or material focus. */
export interface Nav { tab: Tab; item?: string; material?: string; evidence?: string }
export type Navigate = (nav: Nav) => void

function readUrl(): { project?: string } & Nav {
  const p = new URLSearchParams(location.search)
  const tab = TABS.includes(p.get('tab') as Tab) ? (p.get('tab') as Tab) : 'schema'
  return { project: p.get('project') ?? undefined, tab, item: p.get('item') ?? undefined, material: p.get('material') ?? undefined, evidence: p.get('evidence') ?? undefined }
}

export function App() {
  return (
    <LangProvider>
      <AppBody />
    </LangProvider>
  )
}

function AppBody() {
  const initial = readUrl()
  const projects = useApi<Project[]>('projects', {})
  const [project, setProject] = useState<string | undefined>(initial.project)
  const [nav, setNav] = useState<Nav>(initial)
  const revision = useRevision(project)

  useEffect(() => {
    if (!project && projects.data?.length) setProject(projects.data[0].name)
  }, [project, projects.data])

  // Keep the address shareable and the back button meaningful.
  useEffect(() => {
    if (!project) return
    const p = new URLSearchParams({ project, tab: nav.tab })
    for (const k of ['item', 'material', 'evidence'] as const) if (nav[k]) p.set(k, nav[k]!)
    const next = `?${p}`
    if (next !== location.search) history.pushState(null, '', next)
  }, [project, nav])
  useEffect(() => {
    const onPop = () => {
      const u = readUrl()
      setProject(u.project)
      setNav(u)
    }
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])

  const t = useT()
  return (
    <RevisionContext.Provider value={revision}>
      <header className="top">
        <h1>{t('title')}</h1>
        <label>
          <span className="sr-only">{t('project')}</span>
          <select value={project ?? ''} onChange={e => { setProject(e.target.value); setNav({ tab: nav.tab }) }}>
            {projects.data?.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        </label>
        <nav aria-label={t('viewsNavLabel')}>
          {TABS.map(tab => (
            <button key={tab} type="button" aria-current={nav.tab === tab ? 'page' : undefined} onClick={() => setNav({ tab })}>{t.tab[tab]}</button>
          ))}
        </nav>
        {project && <Summary project={project} />}
        <LangToggle />
      </header>
      <main>
        <Loading {...projects} loading={projects.loading && !projects.data} />
        {projects.data && !projects.data.length && <p className="empty"><WithCode text={t('noProjects')} /></p>}
        {project && <Body key={project} project={project} nav={nav} navigate={setNav} />}
      </main>
    </RevisionContext.Provider>
  )
}

function LangToggle() {
  const [lang, setLang] = useLang()
  return (
    <button type="button" className="lang-toggle" onClick={() => setLang(lang === 'en' ? 'zh' : 'en')} aria-label="Switch language / 切换语言">
      {lang === 'en' ? '中文' : 'EN'}
    </button>
  )
}

function Summary({ project }: { project: string }) {
  const t = useT()
  const { data } = useApi<Overview>('overview', { project })
  if (!data) return null
  const v = data.versions.at(-1)
  return (
    <p className="summary" aria-live="polite">
      {v ? `schema v${v.version}` : t('schemaNotPublished')} · {t('summary', {
        confirmed: data.objects.confirmed, candidate: data.objects.candidate,
        linksConfirmed: data.links.confirmed, linksCandidate: data.links.candidate, materials: data.materials
      })}
    </p>
  )
}

function Body({ project, nav, navigate }: { project: string; nav: Nav; navigate: Navigate }) {
  switch (nav.tab) {
    case 'schema': return <SchemaView project={project} />
    case 'explore': return <ExploreView project={project} focus={nav.item} navigate={navigate} />
    case 'review': return <ReviewView project={project} selected={nav.item} navigate={navigate} />
    case 'materials': return <MaterialView project={project} materialId={nav.material} evidenceId={nav.evidence} navigate={navigate} />
    case 'quality': return <QualityView project={project} />
  }
}
