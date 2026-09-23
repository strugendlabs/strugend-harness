/** Nested organizational groups and desktop personal tools beside the existing project tree. */
import { useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { OrganizationMutation, ChatGroup, Recording, AgentOsCommand } from '@deepseek-ai/dsh-agentos-protocol'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import type { AgentOsInjected } from './agentos-controller.ts'
import { WorkspaceBrowser } from './rows/WorkspaceBrowser.tsx'
import css from './AgentOs.module.css'

type Props = WorkspaceBrowserProps & InjectFace<AgentOsInjected>
type Dialog = 'memory' | 'vault' | 'skills' | 'group' | 'organize' | null

function generatePassword(): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*'
  const limit = Math.floor(256 / alphabet.length) * alphabet.length
  let password = ''
  while (password.length < 24) {
    for (const value of crypto.getRandomValues(new Uint8Array(32))) {
      if (value < limit && password.length < 24) password += alphabet.charAt(value % alphabet.length)
    }
  }
  return password
}

/**
 * Strugend mark for the sidebar and blank conversation.
 * @param props - Slot-owned size in CSS pixels and layout class.
 * @returns The decorative Strugend ribbon mark.
 */
export function AgentOsMark({ size, className }: { size: number; className?: string | undefined } & PropsLocale<'workspace'>): ReactNode {
  return <img className={className} src="/assets/strugend/mark-512.png" width={size} height={size} alt="" draggable={false} />
}

/**
 * Render the localized two-line product wordmark.
 * @param props - Workspace locale dictionary.
 * @returns The Strugend wordmark.
 */
export function StrugendWordmark({ t }: PropsLocale<'workspace'>): ReactNode {
  return <span className={css.wordmark}><span>{t('agentos.brand')}</span><small>{t('agentos.family')}</small></span>
}

/** Adds desktop organization while preserving Harness workspaces and their existing controls. */
export function AgentOsWorkspace(props: Props): ReactNode {
  const { useAgentOs, agentOsRequest, useSessions, open, t, wide } = props
  const state = useAgentOs(value => value)
  const sessions = useSessions(value => value)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [editing, setEditing] = useState<string | undefined>()
  const [memory, setMemory] = useState('')
  const [memoryRevision, setMemoryRevision] = useState('')
  const [login, setLogin] = useState({ name: '', username: '', origin: '', password: '' })
  const [selectedRecording, setSelectedRecording] = useState<Recording | undefined>()
  const [instructions, setInstructions] = useState('')
  const [skillName, setSkillName] = useState('')
  const [query, setQuery] = useState('')
  const active = Object.values(sessions.byId).find(row => (row.retainedBy.mainView ?? 0) > 0)
  const act = async (command: AgentOsCommand): Promise<unknown> => {
    setBusy(true)
    setNotice('')
    try {
      const result = await agentOsRequest(command)
      return result
    } finally {
      setBusy(false)
    }
  }
  const perform = (command: AgentOsCommand): void => {
    void act(command).catch(() => {
      /* The controller publishes the failure for the visible alert. */
    })
  }
  const mutate = (mutation: OrganizationMutation): void => {
    perform({ type: 'organization.mutate', revision: state.organization.revision, mutation })
  }
  const show = (next: Dialog): void => {
    setNotice('')
    setDialog(next)
    if (next === 'memory') {
      setMemory(state.memory.text)
      setMemoryRevision(state.memory.revision)
    }
    if (next === 'group') {
      setName('')
      setParent('')
      setEditing(undefined)
    }
  }
  const groupDialog = (group?: ChatGroup, child = false): void => {
    setDialog('group')
    setName(child ? '' : (group?.name ?? ''))
    setParent(child ? (group?.id ?? '') : (group?.parentId ?? ''))
    setEditing(child ? undefined : group?.id)
  }
  const saveGroup = (event: FormEvent): void => {
    event.preventDefault()
    void (async () => {
      if (editing === undefined)
        await act({
          type: 'organization.mutate',
          revision: state.organization.revision,
          mutation: { kind: 'create', name, parentId: parent || null },
        })
      else {
        const renamed = (await act({
          type: 'organization.mutate',
          revision: state.organization.revision,
          mutation: { kind: 'rename', id: editing, name },
        })) as typeof state.organization
        await act({
          type: 'organization.mutate',
          revision: renamed.revision,
          mutation: { kind: 'move', id: editing, parentId: parent || null },
        })
      }
      setDialog(null)
    })().catch(() => {
      /* Keep the editing dialog open with the controller's error. */
    })
  }
  const chat = (id: string, inGroup = false): ReactNode => {
    const row = sessions.byId[id as keyof typeof sessions.byId]
    if (row === undefined || row.blank || (query && !row.displayTitle.toLowerCase().includes(query.toLowerCase())))
      return null
    return (
      <div
        key={id}
        className={`${css.chat} ${active?.id === id ? css.active : ''}`}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData('application/x-agent-os-chat', id)
        }}
      >
        <button
          type="button"
          onClick={() => {
            open(row.id)
          }}
          title={row.displayTitle}
        >
          <span>{row.displayTitle}</span>
          {row.running && <i className={css.running} aria-label={t('agentos.running')} />}
        </button>
        {inGroup && (
          <button
            type="button"
            className={css.small}
            aria-label={t('agentos.removeFromGroup')}
            onClick={() => {
              mutate({ kind: 'assign', sessionId: id, groupId: null })
            }}
          >
            ×
          </button>
        )}
      </div>
    )
  }
  const groups = (parentId: string | null, depth = 0): ReactNode =>
    state.organization.groups
      .filter(group => group.parentId === parentId)
      .sort((a, b) => a.order - b.order)
      .map(group => (
        <div key={group.id} className={css.group}>
          <div
            className={css.groupRow}
            draggable
            onDragStart={(event) => {
              event.stopPropagation()
              event.dataTransfer.setData('application/x-agent-os-group', group.id)
            }}
            onDragOver={(event) => {
              event.preventDefault()
            }}
            onDrop={(event) => {
              event.preventDefault()
              event.stopPropagation()
              const id = event.dataTransfer.getData('application/x-agent-os-chat')
              const groupId = event.dataTransfer.getData('application/x-agent-os-group')
              if (id) mutate({ kind: 'assign', sessionId: id, groupId: group.id })
              else if (groupId) mutate({ kind: 'move', id: groupId, parentId: group.id })
            }}
          >
            <button
              type="button"
              className={css.groupName}
              aria-expanded={!group.collapsed}
              onClick={() => {
                mutate({ kind: 'collapse', id: group.id, collapsed: !group.collapsed })
              }}
            >
              <span className={css.chevron}>{group.collapsed ? '›' : '⌄'}</span>
              <span className={css.folder}>▱</span>
              <span>{group.name}</span>
            </button>
            <button
              type="button"
              className={css.small}
              title={t('agentos.addSubgroup')}
              aria-label={t('agentos.addSubgroup')}
              onClick={() => {
                groupDialog(group, true)
              }}
            >
              +
            </button>
            <button
              type="button"
              className={css.small}
              title={t('agentos.editGroup')}
              aria-label={t('agentos.editGroup')}
              onClick={() => {
                groupDialog(group)
              }}
            >
              ···
            </button>
          </div>
          {!group.collapsed && (
            <div className={css.children}>
              {depth < 20 && groups(group.id, depth + 1)}
              {Object.entries(state.organization.assignments)
                .filter(([, assigned]) => assigned === group.id)
                .map(([id]) => chat(id, true))}
              {active !== undefined && (
                <button
                  className={css.addCurrent}
                  type="button"
                  onClick={() => {
                    mutate({ kind: 'assign', sessionId: active.id, groupId: group.id })
                  }}
                >
                  {t('agentos.addCurrent')}
                </button>
              )}
            </div>
          )}
        </div>
      ))

  if (!state.available) return <WorkspaceBrowser {...props} />
  return (
    <div className={css.root}>
      {wide && (
        <>
          <nav className={css.nav} aria-label={t('agentos.tools')}>
            <button
              type="button"
              onClick={() => {
                show('skills')
              }}
            >
              <span aria-hidden="true">◈</span>
              {t('agentos.skills')}
              <small>{state.recordings.length || ''}</small>
            </button>
            <button
              type="button"
              onClick={() => {
                show('memory')
              }}
            >
              <span aria-hidden="true">▤</span>
              {t('agentos.memory')}
            </button>
            <button
              type="button"
              onClick={() => {
                show('vault')
              }}
            >
              <span aria-hidden="true">♧</span>
              {t('agentos.vault')}
            </button>
            <button
              type="button"
              disabled
              title={t('agentos.comingSoon')}
            >
              <span aria-hidden="true">▷</span>
              {t('agentos.video')}<small>{t('agentos.comingSoon')}</small>
            </button>
          </nav>
          <section className={css.organization} aria-label={t('agentos.groups')}>
            <div className={css.sectionHeader}>
              <span>{t('agentos.groups')}</span>
              <button
                type="button"
                aria-label={t('agentos.organize')}
                onClick={() => {
                  show('organize')
                }}
              >
                ☷
              </button>
              <button
                type="button"
                aria-label={t('agentos.newGroup')}
                onClick={() => {
                  groupDialog()
                }}
              >
                +
              </button>
            </div>
            {state.organization.pinned.map(id => chat(id))}
            {groups(null)}
            {state.organization.groups.length === 0 && (
              <button
                type="button"
                className={css.emptyGroup}
                onClick={() => {
                  groupDialog()
                }}
              >
                {t('agentos.firstGroup')}
              </button>
            )}
          </section>
        </>
      )}
      <WorkspaceBrowser {...props} />
      {state.error && dialog === null && (
        <div className={css.inlineError} role="alert">
          {state.error}
        </div>
      )}
      {dialog !== null &&
        createPortal(
          <div
            className={css.overlay}
            data-agent-os-overlay
            onClick={(event) => {
              if (event.target === event.currentTarget) setDialog(null)
            }}
          >
            <section
              className={css.dialog}
              role="dialog"
              aria-modal="true"
              aria-label={t(`agentos.${dialog === 'group' ? 'editGroup' : dialog}`)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setDialog(null)
              }}
            >
              <header>
                <div>
                  <span className={css.eyebrow}>{t('agentos.personal')}</span>
                  <h2>{t(`agentos.${dialog === 'group' ? 'editGroup' : dialog}`)}</h2>
                </div>
                <button
                  type="button"
                  aria-label={t('agentos.close')}
                  onClick={() => {
                    setDialog(null)
                  }}
                >
                  ×
                </button>
              </header>
              {state.error && (
                <p className={css.inlineError} role="alert">
                  {state.error}
                </p>
              )}
              {notice && (
                <p className={css.notice} role="status">
                  {notice}
                </p>
              )}
              {dialog === 'group' && (
                <form onSubmit={saveGroup} className={css.form}>
                  <label>
                    {t('agentos.name')}
                    <input
                      autoFocus
                      required
                      maxLength={160}
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value)
                      }}
                    />
                  </label>
                  <label>
                    {t('agentos.parent')}
                    <select
                      value={parent}
                      onChange={(event) => {
                        setParent(event.target.value)
                      }}
                    >
                      <option value="">{t('agentos.topLevel')}</option>
                      {state.organization.groups
                        .filter(group => group.id !== editing)
                        .map(group => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <footer>
                    {editing && (
                      <button
                        type="button"
                        className={css.danger}
                        onClick={() => {
                          mutate({ kind: 'delete', id: editing })
                          setDialog(null)
                        }}
                      >
                        {t('agentos.deleteGroup')}
                      </button>
                    )}
                    <button className={css.primary} disabled={busy} type="submit">
                      {t('agentos.save')}
                    </button>
                  </footer>
                  {editing && <p className={css.hint}>{t('agentos.deleteHint')}</p>}
                </form>
              )}
              {dialog === 'memory' && (
                <div className={css.form}>
                  <p className={css.hint}>{t('agentos.memoryHint')}</p>
                  <textarea
                    className={css.memory}
                    spellCheck={false}
                    value={memory}
                    onChange={(event) => {
                      setMemory(event.target.value)
                    }}
                    aria-label={t('agentos.memory')}
                  />
                  <footer>
                    <button
                      className={css.primary}
                      disabled={busy}
                      onClick={() => {
                        void act({ type: 'memory.write', text: memory, revision: memoryRevision })
                          .then((value) => {
                            setMemoryRevision((value as typeof state.memory).revision)
                            setNotice(t('agentos.saved'))
                          })
                          .catch(() => {
                            /* Keep unsaved draft for conflict recovery. */
                          })
                      }}
                    >
                      {t('agentos.save')}
                    </button>
                  </footer>
                </div>
              )}
              {dialog === 'vault' && (
                <div className={css.form}>
                  <p className={css.hint}>{t('agentos.vaultHint')}</p>
                  <div className={css.inventory}>
                    {state.vault.map(item => (
                      <div key={item.id} className={css.inventoryRow}>
                        <div>
                          <strong>{item.name}</strong>
                          <small>
                            {item.username} · {item.origin}
                          </small>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            perform({ type: 'vault.copy', id: item.id })
                            setNotice(t('agentos.copied'))
                          }}
                        >
                          {t('agentos.copy')}
                        </button>
                        <button
                          type="button"
                          disabled={active === undefined}
                          onClick={() => {
                            if (active === undefined) return
                            void act({ type: 'browser.list', sessionId: active.id })
                              .then(async (value) => {
                                const tabs = value as Array<{ tabId: string; url: string }>
                                const target = tabs.find((tab) => {
                                  try {
                                    return new URL(tab.url).origin === item.origin
                                  } catch {
                                    return false
                                  }
                                })
                                if (!target) {
                                  setNotice(t('agentos.openLogin'))
                                  return
                                }
                                await act({
                                  type: 'vault.fill',
                                  id: item.id,
                                  sessionId: active.id,
                                  tabId: target.tabId,
                                })
                                setNotice(t('agentos.filled'))
                              })
                              .catch(() => {
                                /* Controller displays operation failure. */
                              })
                          }}
                        >
                          {t('agentos.fill')}
                        </button>
                        <button
                          type="button"
                          className={css.danger}
                          aria-label={t('agentos.delete')}
                          onClick={() => {
                            perform({ type: 'vault.remove', id: item.id })
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      void act({ type: 'vault.save', entry: login })
                        .then(() => {
                          setLogin({ name: '', username: '', origin: '', password: '' })
                          setNotice(t('agentos.saved'))
                        })
                        .catch(() => {
                          /* Retain the input after a failed save. */
                        })
                    }}
                  >
                    <div className={css.grid}>
                      {(['name', 'origin', 'username', 'password'] as const).map(key => (
                        <label key={key}>
                          {t(`agentos.${key}`)}
                          <input
                            required={key !== 'username'}
                            autoComplete="off"
                            type={key === 'password' ? 'password' : 'text'}
                            value={login[key]}
                            onChange={(event) => {
                              setLogin({ ...login, [key]: event.target.value })
                            }}
                          />
                        </label>
                      ))}
                    </div>
                    <footer>
                      <button
                        type="button"
                        onClick={() => {
                          setLogin({ ...login, password: generatePassword() })
                        }}
                      >
                        {t('agentos.generate')}
                      </button>
                      <button className={css.primary} disabled={busy} type="submit">
                        {t('agentos.saveLogin')}
                      </button>
                    </footer>
                  </form>
                </div>
              )}
              {dialog === 'skills' && (
                <div className={css.form}>
                  <p className={css.hint}>{t('agentos.skillHint')}</p>
                  <div className={css.inventory}>
                    {state.recordings.map(recording => (
                      <button
                        className={css.recording}
                        type="button"
                        key={recording.id}
                        onClick={() => {
                          setSelectedRecording(recording)
                          setSkillName('')
                          setInstructions(
                            recording.steps
                              .map(
                                (step, index) =>
                                  `${index + 1}. ${step.action}: ${step.target ?? step.url}${step.value ? ` — ${step.value}` : ''}`,
                              )
                              .join('\n'),
                          )
                        }}
                      >
                        <span>{recording.title}</span>
                        <small>
                          {recording.steps.length} ·{' '}
                          {recording.skillPath ? t('agentos.skillSaved') : t('agentos.review')}
                        </small>
                      </button>
                    ))}
                  </div>
                  {selectedRecording && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault()
                        void act({
                          type: 'recording.saveSkill',
                          id: selectedRecording.id,
                          name: skillName,
                          instructions,
                        })
                          .then(() => {
                            setNotice(t('agentos.skillSaved'))
                            setSelectedRecording(undefined)
                          })
                          .catch(() => {
                            /* Keep the reviewed skill text. */
                          })
                      }}
                    >
                      <label>
                        {t('agentos.skillName')}
                        <input
                          required
                          pattern="[a-z0-9]+(-[a-z0-9]+)*"
                          value={skillName}
                          onChange={(event) => {
                            setSkillName(event.target.value)
                          }}
                        />
                      </label>
                      <label>
                        {t('agentos.instructions')}
                        <textarea
                          className={css.memory}
                          value={instructions}
                          onChange={(event) => {
                            setInstructions(event.target.value)
                          }}
                        />
                      </label>
                      <footer>
                        <button className={css.primary} disabled={busy} type="submit">
                          {t('agentos.saveSkill')}
                        </button>
                      </footer>
                    </form>
                  )}
                </div>
              )}
              {dialog === 'organize' && (
                <div className={css.form}>
                  <input
                    autoFocus
                    placeholder={t('agentos.search')}
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value)
                    }}
                    aria-label={t('agentos.search')}
                  />
                  <div className={css.inventory}>
                    {sessions.ids
                      .map(id => sessions.byId[id])
                      .filter(
                        (row): row is NonNullable<typeof row> =>
                          row !== undefined &&
                          !row.blank &&
                          row.displayTitle.toLowerCase().includes(query.toLowerCase()),
                      )
                      .map(row => (
                        <div key={row.id} className={css.inventoryRow}>
                          <span>{row.displayTitle}</span>
                          <button
                            type="button"
                            aria-pressed={state.organization.pinned.includes(row.id)}
                            onClick={() => {
                              mutate({
                                kind: 'pin',
                                sessionId: row.id,
                                pinned: !state.organization.pinned.includes(row.id),
                              })
                            }}
                          >
                            {t(state.organization.pinned.includes(row.id) ? 'agentos.unpin' : 'agentos.pin')}
                          </button>
                          <select
                            aria-label={t('agentos.groups')}
                            value={state.organization.assignments[row.id] ?? ''}
                            onChange={(event) => {
                              mutate({ kind: 'assign', sessionId: row.id, groupId: event.target.value || null })
                            }}
                          >
                            <option value="">{t('agentos.ungrouped')}</option>
                            {state.organization.groups.map(group => (
                              <option key={group.id} value={group.id}>
                                {group.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </section>
          </div>,
          document.body,
        )}
    </div>
  )
}
